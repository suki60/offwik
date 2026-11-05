import { connect } from "../db.ts";
import { embed } from "../ollama.ts";

// Setup step 3: embed every chunk with both models, one batch at a time.
// Resumable: each batch is committed on its own, and a rerun continues from
// `WHERE <column> IS NULL`. ~50 min for nomic, ~62 min for arctic.
// Usage: npm run embed [-- <batch size>]   (default 64)

// Document prefixes: nomic wants "search_document: ", arctic none (it
// prefixes only queries).
const MODELS = [
  {
    column: "embedding_nomic",
    model: "nomic-embed-text",
    prefix: "search_document: ",
  },
  {
    column: "embedding_arctic",
    model: "snowflake-arctic-embed:33m",
    prefix: "",
  },
];

const batchSize = Number(process.argv[2] ?? 64);
const db = await connect();

for (const { column, model, prefix } of MODELS) {
  const { rows } = await db.query(
    `SELECT count(*) AS todo FROM chunks WHERE ${column} IS NULL`,
  );

  const { todo } = rows[0];
  console.log(`${model}: ${todo} chunks to embed`);
  const start = performance.now();
  let done = 0;

  while (true) {
    const { rows } = await db.query(
      `SELECT id, content FROM chunks WHERE ${column} IS NULL ORDER BY id LIMIT $1`,
      [batchSize],
    );

    if (rows.length === 0) break;

    const embeddings = await embed(
      rows.map((row) => `${prefix}${row.content}`),
      model,
    );

    // pgvector accepts a vector as text ("[0.1,0.2,...]"). One transaction
    // per batch: all of it is written, or none of it.
    await db.query("BEGIN");

    for (const [i, row] of rows.entries()) {
      await db.query(`UPDATE chunks SET ${column} = $1::vector WHERE id = $2`, [
        JSON.stringify(embeddings[i]),
        row.id,
      ]);
    }

    await db.query("COMMIT");
    done += rows.length;
    const rate = done / ((performance.now() - start) / 1000);

    console.log(
      `${done}/${todo}  ${rate.toFixed(1)} chunks/s  ETA ${((todo - done) / rate / 60).toFixed(1)} min`,
    );
  }
}

await db.end();
