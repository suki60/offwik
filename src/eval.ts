import { connect } from "./db.ts";
import { embed } from "./ollama.ts";
import { questions } from "./questions.ts";

// Stage 6, step 2: measure retrieval on the eval questions instead of judging
// answers by eye.
// 1. Exact search: article-level recall@k (did any of the top k chunks come
//    from the expected article?).
// 2. ef_search sweep: how close HNSW gets to exact search (share of the exact
//    top 10 chunks it also returns), article recall@10 and latency.
// 3. The questions exact search misses: what came back instead.
// Usage: npm run eval

const K_VALUES = [1, 3, 5, 10, 20];
const MAX_K = 20;

// The sweep compares top 10s. ef_search also caps how many rows one HNSW scan
// returns, so every value here must be >= 10.
const SWEEP_K = 10;
const EF_SEARCH_VALUES = [10, 20, 40, 80, 200, 400];

// One request embeds all questions, with the same prefix as search.ts.
const embeddings = await embed(
  questions.map((question) => `search_query: ${question.question}`),
);

const vectors = embeddings.map((embedding) => JSON.stringify(embedding));
const db = await connect();

// Same query as search.ts, only the columns the metrics need.
const sql = `
  SELECT c.id, a.title
  FROM chunks c
  JOIN articles a ON a.id = c.article_id
  WHERE c.embedding IS NOT NULL
  ORDER BY c.embedding <=> $1::vector
  LIMIT $2
`;

type Hit = { id: number; title: string };

// Runs every question once: the hits and the latency of each query.
async function runAll(k: number) {
  const hits: Hit[][] = [];
  const timings: number[] = [];

  for (const vector of vectors) {
    const start = performance.now();
    const { rows } = await db.query<Hit>(sql, [vector, k]);
    timings.push(performance.now() - start);
    hits.push(rows);
  }

  return { hits, timings };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

// 1-based rank of the first chunk from the expected article, or null.
function articleRank(hits: Hit[], title: string) {
  const index = hits.findIndex((hit) => hit.title === title);
  return index === -1 ? null : index + 1;
}

// Share of questions whose expected article is in the top k.
function recallAt(hitsPerQuestion: Hit[][], k: number) {
  let found = 0;

  for (const [i, { title }] of questions.entries()) {
    const rank = articleRank(hitsPerQuestion[i] ?? [], title);
    if (rank !== null && rank <= k) found++;
  }

  return found / questions.length;
}

// Exact search first: no index scans in this session, so Postgres computes
// the distance to every chunk (the stage 4 plan). It is the ground truth HNSW
// is compared with.
await db.query("SET enable_indexscan = off");
const exact = await runAll(MAX_K);
await db.query("RESET enable_indexscan");

const { rows } = await db.query(
  "SELECT count(*) AS chunks FROM chunks WHERE embedding IS NOT NULL",
);

console.log(`${questions.length} questions, ${rows[0].chunks} chunks\n`);
console.log("Exact search, article-level recall@k:");

for (const k of K_VALUES) {
  console.log(
    `  recall@${String(k).padEnd(2)}  ${recallAt(exact.hits, k).toFixed(2)}`,
  );
}

console.log(`  median latency ${median(exact.timings).toFixed(1)} ms\n`);

// Warm-up: the first HNSW queries read the index from disk. One untimed pass
// keeps that cost out of the first row of the sweep.
await runAll(SWEEP_K);

console.log(`HNSW vs exact, top ${SWEEP_K}:`);
console.log("  ef_search  chunks found  recall@10  median latency");

for (const efSearch of EF_SEARCH_VALUES) {
  await db.query("SELECT set_config('hnsw.ef_search', $1, false)", [
    String(efSearch),
  ]);

  const { hits, timings } = await runAll(SWEEP_K);

  // Per question: how many of the exact top 10 chunks HNSW also returned.
  // Averaged, this is what "HNSW recall" usually means (chunk level).
  let overlap = 0;

  for (const [i, questionHits] of hits.entries()) {
    const exactIds = new Set(
      (exact.hits[i] ?? []).slice(0, SWEEP_K).map((hit) => hit.id),
    );

    overlap += questionHits.filter((hit) => exactIds.has(hit.id)).length;
  }

  const chunkRecall = overlap / (SWEEP_K * questions.length);

  console.log(
    `  ${String(efSearch).padStart(9)}  ${chunkRecall.toFixed(3).padStart(12)}  ${recallAt(hits, SWEEP_K).toFixed(2).padStart(9)}  ${median(timings).toFixed(1).padStart(11)} ms`,
  );
}

console.log(
  `  ${"exact".padStart(9)}  ${"1.000".padStart(12)}  ${recallAt(exact.hits, SWEEP_K).toFixed(2).padStart(9)}  ${median(exact.timings).toFixed(1).padStart(11)} ms\n`,
);

await db.end();

// Misses: where the expected article ranks in the exact top 20 (or "-" if it
// isn't there), and the top 3 articles that came back instead.
console.log(
  `Exact search misses (expected article not in the top ${SWEEP_K}):`,
);

for (const [i, { question, title }] of questions.entries()) {
  const hits = exact.hits[i] ?? [];
  const rank = articleRank(hits, title);
  if (rank !== null && rank <= SWEEP_K) continue;
  const top = hits.slice(0, 3).map((hit) => hit.title);

  console.log(
    `  [rank ${rank ?? "-"}] ${question}\n    expected: ${title}\n    got:      ${top.join(" | ")}`,
  );
}
