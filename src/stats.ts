import { connect } from "./db.ts";

// Stage 2: chunk statistics, computed in Postgres.
// Usage: npm run stats               overall numbers
//        npm run stats -- "<title>"  the chunks of one article

const db = await connect();
const title = process.argv[2];

if (title) {
  const { rows } = await db.query(
    `SELECT c.position, length(c.content) AS chars, c.content
     FROM chunks c JOIN articles a ON a.id = c.article_id
     WHERE a.title = $1
     ORDER BY c.position`,
    [title],
  );
  if (rows.length === 0) console.log(`No chunks for "${title}"`);
  for (const row of rows) {
    console.log(`\n--- #${row.position} ${row.chars} chars`);
    console.log(row.content);
  }
} else {
  console.log("== Totals");
  console.table(
    (
      await db.query(`
        SELECT
          (SELECT count(*) FROM articles) AS articles,
          (SELECT count(*) FROM chunks) AS chunks,
          (SELECT count(*) FROM articles a WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.article_id = a.id)) AS articles_without_chunks,
          (SELECT sum(length(content)) FROM chunks) AS total_chars
      `)
    ).rows,
  );

  // percentile_cont needs a sorted set: WITHIN GROUP (ORDER BY ...).
  console.log("\n== Chunks per article");
  console.table(
    (
      await db.query(`
        SELECT
          round(avg(n), 2) AS avg,
          round(percentile_cont(0.5) WITHIN GROUP (ORDER BY n)::numeric) AS p50,
          round(percentile_cont(0.9) WITHIN GROUP (ORDER BY n)::numeric) AS p90,
          round(percentile_cont(0.99) WITHIN GROUP (ORDER BY n)::numeric) AS p99,
          max(n) AS max,
          round(100.0 * count(*) FILTER (WHERE n = 1) / count(*), 1) AS pct_single_chunk
        FROM (SELECT count(*) AS n FROM chunks GROUP BY article_id) per_article
      `)
    ).rows,
  );

  console.log("\n== Chunk length (characters, prefix included)");
  console.table(
    (
      await db.query(`
        SELECT
          min(len) AS min,
          round(percentile_cont(0.1) WITHIN GROUP (ORDER BY len)::numeric) AS p10,
          round(percentile_cont(0.5) WITHIN GROUP (ORDER BY len)::numeric) AS p50,
          round(percentile_cont(0.9) WITHIN GROUP (ORDER BY len)::numeric) AS p90,
          round(percentile_cont(0.99) WITHIN GROUP (ORDER BY len)::numeric) AS p99,
          max(len) AS max
        FROM (SELECT length(content) AS len FROM chunks) c
      `)
    ).rows,
  );
  console.table(
    (
      await db.query(`
        SELECT
          CASE
            WHEN length(content) < 100 THEN 'a: < 100'
            WHEN length(content) < 300 THEN 'b: 100-300'
            WHEN length(content) < 600 THEN 'c: 300-600'
            WHEN length(content) < 1000 THEN 'd: 600-1000'
            ELSE 'e: >= 1000'
          END AS bucket,
          count(*) AS chunks,
          round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
        FROM chunks
        GROUP BY bucket
        ORDER BY bucket
      `)
    ).rows,
  );

  console.log("\n== Shortest chunks (are they worth embedding?)");
  console.table(
    (
      await db.query(`
        SELECT length(content) AS chars, content
        FROM chunks
        ORDER BY length(content), id
        LIMIT 8
      `)
    ).rows,
  );
}

await db.end();
