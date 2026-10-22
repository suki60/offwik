import { connect } from "./db.ts";
import { embed } from "./ollama.ts";

// Stage 4: exact (brute-force) search. There is no vector index: Postgres
// computes the cosine distance to every chunk, sorts, and keeps the top k.
// Usage: npm run search -- "<question>" [k]   (default k 5)

const query = process.argv[2];
const k = Number(process.argv[3] ?? 5);

if (!query) {
  console.error('Usage: npm run search -- "<question>" [k]');
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

// <=> is cosine distance (1 - cosine similarity): smaller is closer.
// ORDER BY distance ASC + LIMIT is also the shape an HNSW index can serve (stage 5).
async function search() {
  const { rows } = await db.query<{
    title: string;
    url: string;
    content: string;
    distance: number;
  }>(
    `SELECT a.title, a.url, c.content, c.embedding <=> $1::vector AS distance
     FROM chunks c
     JOIN articles a ON a.id = c.article_id
     WHERE c.embedding IS NOT NULL
     ORDER BY distance
     LIMIT $2`,
    [vector, k],
  );

  return rows;
}

const timings: number[] = [];
let results: Awaited<ReturnType<typeof search>> = [];

for (let run = 0; run < RUNS; run++) {
  const start = performance.now();
  results = await search();
  timings.push(performance.now() - start);
}

const { rows } = await db.query(
  "SELECT count(*) AS chunks FROM chunks WHERE embedding IS NOT NULL",
);

const { chunks } = rows[0];
await db.end();

for (const [i, { title, url, content, distance }] of results.entries()) {
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

// Median of the warm runs (all but the first).
const warm = timings.slice(1).sort((a, b) => a - b);
const median = warm[Math.floor(warm.length / 2)] ?? 0;

// Which database answered: DATABASE_URL picks it (5432 = db, 5433 = db2).
console.log(`Searched ${chunks} chunks on ${db.host}:${db.port}, top ${k}`);
console.log(`  embed query: ${embedMs.toFixed(0)} ms`);

console.log(
  `  SQL: ${timings.map((ms) => ms.toFixed(0)).join(", ")} ms  (median ${median.toFixed(0)} ms)`,
);
