import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { embedMany } from "ai";
import { connect } from "./db.ts";

// Stage 3: embed every chunk that has no embedding yet, one batch at a time.
// Resumable by design: each batch is committed on its own, and the next run
// starts from `WHERE embedding IS NULL`. A crash or Ctrl+C loses at most the
// batch in flight (its transaction never commits).
// Usage: npm run embed [-- <batch size>]   (default 64)
const batchSize = Number(process.argv[2] ?? 64);

// Ollama's OpenAI-compatible API, no key needed.
const ollama = createOpenAICompatible({
  name: "ollama",
  baseURL: process.env.OLLAMA_URL ?? "http://localhost:11434/v1",
});

const model = ollama.textEmbeddingModel("nomic-embed-text");

// What embedMany adds on top of a plain fetch (read in the installed source):
// - splits values into requests of at most maxEmbeddingsPerCall (2048 here),
//   sent in parallel (maxParallelCalls, default unlimited);
// - retries failed requests with backoff (maxRetries, default 2);
// - checks the response with its own Zod schema and throws typed errors.
// It does not sort by `index`: it trusts the order of `data`.
async function embed(texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({ model, values: texts });
  return embeddings;
}

// Rows in the full Simple English dump (measured in stage 1), for the estimate.
const FULL_DATASET_ARTICLES = 241_787;

const db = await connect();

const { rows } = await db.query(`
  SELECT
    (SELECT count(*) FROM articles) AS articles,
    count(*) AS chunks,
    count(*) FILTER (WHERE embedding IS NULL) AS todo
  FROM chunks
`);

const { articles, chunks, todo } = rows[0];

console.log(
  `${chunks} chunks, ${chunks - todo} already embedded, ${todo} to do (batch size ${batchSize})`,
);

const start = performance.now();
let done = 0;

while (true) {
  // ORDER BY id: batches go in a stable order, so progress is easy to follow.
  const { rows } = await db.query<{ id: number; content: string }>(
    "SELECT id, content FROM chunks WHERE embedding IS NULL ORDER BY id LIMIT $1",
    [batchSize],
  );

  if (rows.length === 0) break;

  // nomic-embed-text was trained with task prefixes: documents get
  // "search_document: ", queries (stage 4) will get "search_query: ".
  // If a request still fails after the SDK's retries, the script stops and a rerun resumes.
  const embeddings = await embed(
    rows.map((row) => `search_document: ${row.content}`),
  );

  // pgvector accepts a vector as text ("[0.1,0.2,...]"): JSON.stringify + ::vector.
  // One transaction per batch: all of it is written, or none of it.
  await db.query("BEGIN");

  for (const [i, row] of rows.entries()) {
    await db.query("UPDATE chunks SET embedding = $1::vector WHERE id = $2", [
      JSON.stringify(embeddings[i]),
      row.id,
    ]);
  }

  await db.query("COMMIT");
  done += rows.length;
  const seconds = (performance.now() - start) / 1000;
  const rate = done / seconds;
  const etaMinutes = (todo - done) / rate / 60;

  console.log(
    `${done}/${todo}  ${rate.toFixed(1)} chunks/s  ETA ${etaMinutes.toFixed(1)} min`,
  );
}

const seconds = (performance.now() - start) / 1000;

if (done > 0) {
  const rate = done / seconds;

  // Assumes the rest of the dump has as many chunks per article as this subset.
  const fullChunks = (chunks / articles) * FULL_DATASET_ARTICLES;

  console.log(
    `\nEmbedded ${done} chunks in ${seconds.toFixed(1)} s (${rate.toFixed(1)} chunks/s)`,
  );

  console.log(
    `Full Simple English estimate: ~${Math.round(fullChunks)} chunks, ~${(fullChunks / rate / 3600).toFixed(1)} h at this rate`,
  );
} else {
  console.log("Nothing to embed.");
}

await db.end();
