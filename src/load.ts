import { DuckDBInstance } from "@duckdb/node-api";
import { z } from "zod";
import { chunkArticle } from "./chunker.ts";
import { connect } from "./db.ts";

// Stage 2: read the first N articles of the subset from Parquet, chunk them,
// and store articles + chunks in Postgres. No embeddings yet (stage 3).
// Additive: articles already in the database are skipped, so their chunks and
// embeddings are kept. Loading 60k after 10k only adds the 50k new ones.
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

// Never drops anything: tables are created only if they don't exist yet.
// To start over (e.g. after changing the chunker), drop them by hand:
//   docker compose exec db psql -U wiki -c "DROP TABLE chunks, articles"
await db.query(`
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE TABLE IF NOT EXISTS articles (
    id integer PRIMARY KEY,
    title text NOT NULL UNIQUE,
    url text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chunks (
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
let articleCount = 0;
let chunkCount = 0;
await db.query("BEGIN");
for (const { id, url, title, text } of articles) {
  // ON CONFLICT DO NOTHING inserts 0 rows when the article is already there:
  // then its chunks are there too, so skip them.
  const { rowCount } = await db.query(
    "INSERT INTO articles (id, title, url) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    [id, title, url],
  );

  if (rowCount === 0) continue;
  articleCount++;
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
  `Inserted ${articleCount} new articles and ${chunkCount} chunks in ${seconds.toFixed(1)} s ` +
    `(${Math.round((articleCount + chunkCount) / seconds)} rows/s), ` +
    `skipped ${articles.length - articleCount} already loaded`,
);
await db.end();
