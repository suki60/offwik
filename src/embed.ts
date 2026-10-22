import { z } from "zod";
import { connect } from "./db.ts";

// Stage 3: embed every chunk that has no embedding yet, one batch at a time.
// Resumable by design: each batch is committed on its own, and the next run
// starts from `WHERE embedding IS NULL`. A crash or Ctrl+C loses at most the
// batch in flight (its transaction never commits).
// Usage: npm run embed [-- <batch size>]   (default 64)

const batchSize = Number(process.argv[2] ?? 64);

const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434/v1";

// Response of the OpenAI-compatible /embeddings endpoint (only the fields we use).
// `index` says which input each vector belongs to.
const EmbeddingsResponse = z.object({
  data: z.array(
    z.object({ index: z.number().int(), embedding: z.array(z.number()) }),
  ),
});

// One HTTP request for the whole batch: `input` takes an array of strings.
async function embed(texts: string[]): Promise<number[][]> {
  const response = await fetch(`${ollamaUrl}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "nomic-embed-text", input: texts }),
  });
  // fetch only rejects on network errors: HTTP errors have to be checked by hand.
  if (!response.ok) {
    throw new Error(`Ollama ${response.status}: ${await response.text()}`);
  }
  const { data } = EmbeddingsResponse.parse(await response.json());
  // Sort by index instead of trusting the order of the array.
  return data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
}

// Rows in the full Simple English dump (measured in stage 1), for the estimate.
const FULL_DATASET_ARTICLES = 241_787;

const db = await connect();

const { rows } = await db.query(`
  SELECT
    (SELECT count(*) FROM articles)::int AS articles,
    count(*)::int AS chunks,
    count(*) FILTER (WHERE embedding IS NULL)::int AS todo
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
  // No retries: if a request fails, the script stops and a rerun resumes.
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
