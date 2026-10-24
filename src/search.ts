import { connect } from "./db.ts";
import { embed } from "./ollama.ts";

// Stage 5: run the same query twice, through the HNSW index (approximate) and
// as an exact brute-force scan, and compare plans, latency and results.
// Usage: npm run search -- "<question>" [k] [ef_search]   (default k 5)

const query = process.argv[2];
const k = Number(process.argv[3] ?? 5);
const efSearch = process.argv[4];

if (!query) {
  console.error('Usage: npm run search -- "<question>" [k] [ef_search]');
  process.exit(1);
}

// The same SQL runs several times: the first run pays one-time costs (new
// backend, planning, loading pages), the next ones show the steady-state cost.
// The median of the warm runs is the number to compare.
const RUNS = 5;

const embedStart = performance.now();
const [embedding] = await embed([`search_query: ${query}`]);
const embedMs = performance.now() - embedStart;
const vector = JSON.stringify(embedding);

const db = await connect();

// ef_search: how many candidates HNSW keeps while walking the graph (pgvector
// default 40). Higher = closer to exact, slower. It also caps the number of
// rows one index scan returns, so keep it >= k.
if (efSearch) {
  await db.query("SELECT set_config('hnsw.ef_search', $1, false)", [efSearch]);
}

// <=> is cosine distance (1 - cosine similarity): smaller is closer.
// ORDER BY distance ASC + LIMIT is the shape the HNSW index can serve.
const sql = `
  SELECT c.id, a.title, a.url, c.content, c.embedding <=> $1::vector AS distance
  FROM chunks c
  JOIN articles a ON a.id = c.article_id
  WHERE c.embedding IS NOT NULL
  ORDER BY distance
  LIMIT $2
`;

type Result = {
  id: number;
  title: string;
  url: string;
  content: string;
  distance: number;
};

// EXPLAIN without ANALYZE: the plan Postgres picks, without running it.
async function plan() {
  const { rows } = await db.query<{ "QUERY PLAN": string }>(`EXPLAIN ${sql}`, [
    vector,
    k,
  ]);

  // The query vector is printed as 768 numbers: shorten it.
  return rows
    .map((row) => row["QUERY PLAN"].replace(/'\[[^\]]*\]'::vector/, "$1"))
    .join("\n");
}

async function measure() {
  const timings: number[] = [];
  let results: Result[] = [];

  for (let run = 0; run < RUNS; run++) {
    const start = performance.now();
    const { rows } = await db.query<Result>(sql, [vector, k]);
    timings.push(performance.now() - start);
    results = rows;
  }

  // Median of the warm runs (all but the first).
  const warm = timings.slice(1).sort((a, b) => a - b);
  const median = warm[Math.floor(warm.length / 2)] ?? 0;
  return { results, timings, median };
}

// With an index on chunks.embedding, the planner picks it on its own.
const hnswPlan = await plan();
const hnsw = await measure();

// Exact: forbid index scans for the rest of this session, so Postgres has to
// compute the distance to every chunk and sort (the stage 4 plan).
await db.query("SET enable_indexscan = off");
const exactPlan = await plan();
const exact = await measure();

const { rows } = await db.query(`
  SELECT
    (SELECT count(*) FROM chunks WHERE embedding IS NOT NULL) AS chunks,
    current_setting('hnsw.ef_search', true) AS ef_search
`);

const { chunks, ef_search } = rows[0];
await db.end();

for (const [i, { title, url, content, distance }] of hnsw.results.entries()) {
  // Skip the "Title\n\n" prefix and show the start of the chunk on one line.
  const snippet = content
    .slice(title.length)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

  console.log(
    `${i + 1}. ${title}  (similarity ${(1 - distance).toFixed(3)})\n   ${url}\n   ${snippet}…\n`,
  );
}

console.log(`HNSW plan:\n${hnswPlan}\n`);
console.log(`Exact plan:\n${exactPlan}\n`);

// Which database answered: DB=db2 picks 5433, otherwise 5432.
console.log(`Searched ${chunks} chunks on ${db.host}:${db.port}, top ${k}`);
console.log(`  embed query: ${embedMs.toFixed(0)} ms`);

console.log(
  `  HNSW (ef_search ${ef_search ?? "default"}): ${hnsw.timings.map((ms) => ms.toFixed(0)).join(", ")} ms  (median ${hnsw.median.toFixed(1)} ms)`,
);

console.log(
  `  exact: ${exact.timings.map((ms) => ms.toFixed(0)).join(", ")} ms  (median ${exact.median.toFixed(1)} ms)`,
);

// Same chunks as the exact top k? A first look at recall (stage 6 measures it
// properly over many queries).
const exactIds = new Set(exact.results.map((result) => result.id));
const found = hnsw.results.filter((result) => exactIds.has(result.id)).length;
console.log(
  `  HNSW returned ${found}/${exact.results.length} of the exact top ${k}`,
);
