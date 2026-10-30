import { connect } from "../db.ts";
import { embed } from "../ollama.ts";

// Setup step 3: embed every chunk that has no embedding yet, one batch at a
// time. Resumable by design: each batch is committed on its own, and the next
// run starts from `WHERE embedding IS NULL`. A crash or Ctrl+C loses at most
// the batch in flight (its transaction never commits).
// Full Simple English: ~50 min at ~125 chunks/s (measured in stage 3).
// Usage: npm run embed [-- <batch size>]   (default 64)

const batchSize = Number(process.argv[2] ?? 64);
const db = await connect();

const { rows } = await db.query(`
  SELECT count(*) AS chunks, count(*) FILTER (WHERE embedding IS NULL) AS todo
  FROM chunks
`);

const { chunks, todo } = rows[0];

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
  // "search_document: ", queries (rag-eval.ts) get "search_query: ".
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
  const rate = done / ((performance.now() - start) / 1000);
  const etaMinutes = (todo - done) / rate / 60;

  console.log(
    `${done}/${todo}  ${rate.toFixed(1)} chunks/s  ETA ${etaMinutes.toFixed(1)} min`,
  );
}

if (done > 0) {
  const seconds = (performance.now() - start) / 1000;
  console.log(`Embedded ${done} chunks in ${seconds.toFixed(1)} s`);
} else {
  console.log("Nothing to embed.");
}

await db.end();
