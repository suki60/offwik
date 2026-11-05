import { DuckDBInstance } from "@duckdb/node-api";
import { z } from "zod";
import { connect } from "../db.ts";
import { chunkArticle } from "./chunker.ts";

// Setup step 2: read every article from Parquet, chunk it, and store
// articles + chunks in Postgres. No embeddings yet (embed.ts). Articles
// already in the database are skipped, so a rerun keeps earlier work.
// Expect 238,243 articles and 370,859 chunks.
// Usage: npm run load

// Skips link-only pages: disambiguation pages and "List of" pages.
const duck = await (await DuckDBInstance.create()).connect();

const reader = await duck.runAndReadAll(`
  SELECT id, url, title, text FROM 'data/simple.parquet'
  WHERE title NOT LIKE '%(disambiguation)'
    AND title NOT LIKE 'List of %'
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

// Tables are only created if they don't exist yet. To start over:
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
    position integer NOT NULL,    -- order of the chunk inside its article
    content text NOT NULL,        -- title + text: what gets embedded
    embedding_nomic vector(768),  -- nomic-embed-text (pgvector search)
    embedding_arctic vector(384), -- snowflake-arctic-embed-s (the phone)
    UNIQUE (article_id, position)
  );
`);

// Bulk loading: 2 queries per batch of articles. Postgres turns the arrays
// (one per column) back into rows with unnest(). One transaction for all.
const BATCH_SIZE = 1000;

const start = performance.now();
let articleCount = 0;
let chunkCount = 0;
await db.query("BEGIN");

for (let i = 0; i < articles.length; i += BATCH_SIZE) {
  const batch = articles.slice(i, i + BATCH_SIZE);

  // ON CONFLICT DO NOTHING skips articles already there; RETURNING id gives
  // back only the inserted ones, and only those get chunks.
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO articles (id, title, url)
     SELECT * FROM unnest($1::integer[], $2::text[], $3::text[])
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      batch.map((article) => article.id),
      batch.map((article) => article.title),
      batch.map((article) => article.url),
    ],
  );

  const inserted = new Set(rows.map((row) => row.id));

  // unnest() needs one array per column, not one object per row.
  const chunkArticleIds: number[] = [];
  const positions: number[] = [];
  const contents: string[] = [];

  for (const { id, title, text } of batch) {
    if (!inserted.has(id)) continue;

    for (const [position, content] of chunkArticle(title, text).entries()) {
      chunkArticleIds.push(id);
      positions.push(position);
      contents.push(content);
    }
  }

  await db.query(
    `INSERT INTO chunks (article_id, position, content)
     SELECT * FROM unnest($1::integer[], $2::integer[], $3::text[])`,
    [chunkArticleIds, positions, contents],
  );

  articleCount += inserted.size;
  chunkCount += contents.length;
}

await db.query("COMMIT");
const seconds = (performance.now() - start) / 1000;

console.log(
  `Inserted ${articleCount} new articles and ${chunkCount} chunks in ${seconds.toFixed(1)} s, ` +
    `skipped ${articles.length - articleCount} already loaded`,
);

await db.end();
