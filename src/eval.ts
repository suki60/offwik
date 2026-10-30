import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { connect } from "./db.ts";
import { embed } from "./ollama.ts";
import { questions as goldQuestions } from "./questions.ts";

// Stage 6, step 2: measure retrieval on the eval questions instead of judging
// answers by eye. Runs once per question set: the hand-written "gold" set
// (questions.ts) and the synthetic one (npm run generate-questions).
// 1. Exact search: article-level recall@k (did any of the top k chunks come
//    from the expected article?), with a 95% range.
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

// Same batch size as embed.ts: one request per 64 questions.
const EMBED_BATCH_SIZE = 64;

// The synthetic set can have many misses: print only the first ones.
const MAX_MISSES_SHOWN = 15;

const SYNTHETIC_FILE = "src/synthetic-questions.json";

// Only the fields eval needs; the JSON file has more (answers, chunkId).
const EvalQuestion = z.object({ question: z.string(), title: z.string() });
type EvalQuestion = z.infer<typeof EvalQuestion>;

const sets: { name: string; questions: EvalQuestion[] }[] = [
  { name: "gold (hand-written)", questions: goldQuestions },
];

if (existsSync(SYNTHETIC_FILE)) {
  const synthetic = z
    .array(EvalQuestion)
    .parse(JSON.parse(await readFile(SYNTHETIC_FILE, "utf8")));

  sets.push({ name: "synthetic (qwen3.5:9b)", questions: synthetic });
} else {
  console.log(`${SYNTHETIC_FILE} not found: gold set only\n`);
}

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

// Embeds the questions with the same prefix as search.ts.
async function embedQuestions(questions: EvalQuestion[]) {
  const vectors: string[] = [];

  for (let i = 0; i < questions.length; i += EMBED_BATCH_SIZE) {
    const batch = questions.slice(i, i + EMBED_BATCH_SIZE);

    const embeddings = await embed(
      batch.map((question) => `search_query: ${question.question}`),
    );

    vectors.push(...embeddings.map((embedding) => JSON.stringify(embedding)));
  }

  return vectors;
}

// Runs every question once: the hits and the latency of each query.
async function runAll(vectors: string[], k: number) {
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
function recallAt(
  questions: EvalQuestion[],
  hitsPerQuestion: Hit[][],
  k: number,
) {
  let found = 0;

  for (const [i, { title }] of questions.entries()) {
    const rank = articleRank(hitsPerQuestion[i] ?? [], title);
    if (rank !== null && rank <= k) found++;
  }

  return found / questions.length;
}

// 95% range of a share measured on n questions (normal approximation):
// with 48 questions, 0.94 means "somewhere around 0.87-1.00".
function margin(share: number, n: number) {
  return 1.96 * Math.sqrt((share * (1 - share)) / n);
}

async function evaluate(name: string, questions: EvalQuestion[]) {
  const vectors = await embedQuestions(questions);
  console.log(`=== ${name}: ${questions.length} questions\n`);

  // Exact search first: no index scans in this session, so Postgres computes
  // the distance to every chunk (the stage 4 plan). It is the ground truth
  // HNSW is compared with.
  await db.query("SET enable_indexscan = off");
  const exact = await runAll(vectors, MAX_K);
  await db.query("RESET enable_indexscan");
  console.log("Exact search, article-level recall@k:");

  for (const k of K_VALUES) {
    const recall = recallAt(questions, exact.hits, k);

    console.log(
      `  recall@${String(k).padEnd(2)}  ${recall.toFixed(2)} ± ${margin(recall, questions.length).toFixed(2)}`,
    );
  }

  console.log(`  median latency ${median(exact.timings).toFixed(1)} ms\n`);

  // Warm-up: the first HNSW queries read the index from disk. One untimed
  // pass at the default ef_search keeps that cost out of the sweep.
  await db.query("RESET hnsw.ef_search");
  await runAll(vectors, SWEEP_K);
  console.log(`HNSW vs exact, top ${SWEEP_K}:`);
  console.log("  ef_search  chunks found  recall@10  median latency");

  for (const efSearch of EF_SEARCH_VALUES) {
    await db.query("SELECT set_config('hnsw.ef_search', $1, false)", [
      String(efSearch),
    ]);

    const { hits, timings } = await runAll(vectors, SWEEP_K);

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
      `  ${String(efSearch).padStart(9)}  ${chunkRecall.toFixed(3).padStart(12)}  ${recallAt(questions, hits, SWEEP_K).toFixed(2).padStart(9)}  ${median(timings).toFixed(1).padStart(11)} ms`,
    );
  }

  console.log(
    `  ${"exact".padStart(9)}  ${"1.000".padStart(12)}  ${recallAt(questions, exact.hits, SWEEP_K).toFixed(2).padStart(9)}  ${median(exact.timings).toFixed(1).padStart(11)} ms\n`,
  );

  // Misses: where the expected article ranks in the exact top 20 (or "-" if
  // it isn't there), and the top 3 articles that came back instead.
  const misses = questions.flatMap((question, i) => {
    const hits = exact.hits[i] ?? [];
    const rank = articleRank(hits, question.title);
    return rank === null || rank > SWEEP_K ? [{ ...question, rank, hits }] : [];
  });

  console.log(
    `Exact search misses (expected article not in the top ${SWEEP_K}): ${misses.length}`,
  );

  for (const { question, title, rank, hits } of misses.slice(
    0,
    MAX_MISSES_SHOWN,
  )) {
    const top = hits.slice(0, 3).map((hit) => hit.title);

    console.log(
      `  [rank ${rank ?? "-"}] ${question}\n    expected: ${title}\n    got:      ${top.join(" | ")}`,
    );
  }

  if (misses.length > MAX_MISSES_SHOWN) {
    console.log(`  … and ${misses.length - MAX_MISSES_SHOWN} more`);
  }

  console.log();
}

for (const { name, questions } of sets) {
  await evaluate(name, questions);
}

await db.end();
