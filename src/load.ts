import { DuckDBInstance } from "@duckdb/node-api";
import { z } from "zod";
import { chunkArticle } from "./chunker.ts";
import { connect } from "./db.ts";

// Stage 2: read the first N articles of the subset from Parquet, chunk them,
// and store articles + chunks in Postgres. No embeddings yet (stage 3).
// Usage: npm run load [-- <number of articles>]   (default 10000)

const limit = Number(process.argv[2] ?? 10000);

// Fixed pseudo-random order (hash of the id), skipping the two easy-to-spot
// kinds of link-only pages: disambiguation pages and "List of" pages.
const duck = await (await DuckDBInstance.create()).connect();
const reader = await duck.runAndReadAll(`
  SELECT id, url, title, text FROM 'data/simple.parquet'
  WHERE title NOT LIKE '%(disambiguation)'
    AND title NOT LIKE 'List of %'
  ORDER BY hash(id)
  LIMIT ${limit}
`);
// DuckDB rows are typed as generic Json values: validate the shape at runtime
// and get real types from the schema. id is a VARCHAR in the Parquet file.
const Article = z.object({
  id: z.coerce.number().int(),
  url: z.string(),
  title: z.string(),
  text: z.string(),
});
const articles = z.array(Article).parse(reader.getRowObjectsJson());
console.log(`Read ${articles.length} articles from Parquet`);

const db = await connect();

// Recreate the tables on every run: while chunking rules change, a clean reload is simplest.
// (From stage 3 on this would also throw away the embeddings.)
await db.query(`
  CREATE EXTENSION IF NOT EXISTS vector;
  DROP TABLE IF EXISTS chunks, articles;
  CREATE TABLE articles (
    id integer PRIMARY KEY,
    title text NOT NULL UNIQUE,
    url text NOT NULL
  );
  CREATE TABLE chunks (
    id serial PRIMARY KEY,
    article_id integer NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
    position integer NOT NULL, -- order of the chunk inside its article
    content text NOT NULL,     -- title + text: what gets embedded
    embedding vector(768),     -- filled in stage 3
    UNIQUE (article_id, position)
  );
`);

// One INSERT per row, all in one transaction: simple, and one commit at the end
// instead of one per row. Stage 4 looks at faster bulk loading.
const start = performance.now();
let chunkCount = 0;
await db.query("BEGIN");
for (const { id, url, title, text } of articles) {
  await db.query("INSERT INTO articles (id, title, url) VALUES ($1, $2, $3)", [
    id,
    title,
    url,
  ]);
  const chunks = chunkArticle(title, text);
  for (const [position, content] of chunks.entries()) {
    await db.query(
      "INSERT INTO chunks (article_id, position, content) VALUES ($1, $2, $3)",
      [id, position, content],
    );
  }
  chunkCount += chunks.length;
}
await db.query("COMMIT");
const seconds = (performance.now() - start) / 1000;

console.log(
  `Inserted ${articles.length} articles and ${chunkCount} chunks in ${seconds.toFixed(1)} s ` +
    `(${Math.round((articles.length + chunkCount) / seconds)} rows/s)`,
);
await db.end();
