import { DuckDBInstance } from "@duckdb/node-api";

// Stage 1: explore the Simple English Wikipedia Parquet file with DuckDB.
// DuckDB queries the Parquet file in place: no import step, no Postgres needed yet.

const file = "data/simple.parquet";

const db = await DuckDBInstance.create(); // in-memory database
const conn = await db.connect();

async function query(sql: string) {
  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjectsJson();
}

await conn.run(`CREATE VIEW articles AS SELECT * FROM '${file}'`);

console.log("== Columns");
console.table(
  await query("SELECT column_name, column_type FROM (DESCRIBE articles)"),
);

console.log("\n== Size");
console.table(
  await query(`
    SELECT
      count(*) AS articles,
      sum(length(text)) AS total_chars,
      round(sum(length(text)) / 4 / 1e6, 1) AS approx_million_tokens -- rule of thumb: ~4 chars per token
    FROM articles
  `),
);

console.log("\n== Text length (characters)");
console.table(
  await query(`
    SELECT
      min(length(text)) AS min,
      quantile_cont(length(text), 0.10)::INT AS p10,
      quantile_cont(length(text), 0.50)::INT AS p50,
      quantile_cont(length(text), 0.90)::INT AS p90,
      quantile_cont(length(text), 0.99)::INT AS p99,
      max(length(text)) AS max
    FROM articles
  `),
);
console.table(
  await query(`
    SELECT
      CASE
        WHEN length(text) < 200 THEN 'a: < 200'
        WHEN length(text) < 1000 THEN 'b: 200-1k'
        WHEN length(text) < 5000 THEN 'c: 1k-5k'
        WHEN length(text) < 20000 THEN 'd: 5k-20k'
        ELSE 'e: >= 20k'
      END AS bucket,
      count(*) AS articles,
      round(100 * count(*) / sum(count(*)) OVER (), 1) AS pct_articles,
      round(100 * sum(length(text)) / sum(sum(length(text))) OVER (), 1) AS pct_text
    FROM articles
    GROUP BY bucket
    ORDER BY bucket
  `),
);

console.log("\n== Longest articles");
console.table(
  await query(
    "SELECT title, length(text) AS chars FROM articles ORDER BY chars DESC LIMIT 5",
  ),
);

console.log("\n== Kinds of pages");
console.table(
  await query(`
    SELECT
      count(*) FILTER (WHERE length(text) < 200) AS stubs_under_200_chars,
      count(*) FILTER (WHERE title LIKE '%(disambiguation)' OR text LIKE '%may refer to%' OR text LIKE '%may mean:%') AS disambiguation,
      count(*) FILTER (WHERE title LIKE 'List of %') AS lists,
      count(*) FILTER (WHERE regexp_matches(title, '^\\d{1,4}$')) AS years
    FROM articles
  `),
);

// Headings are not marked up: they are a short line after a blank line, sometimes with a trailing space.
// This regex is a rough guess at that shape, good enough to count them.
console.log(
  "\n== Most common heading-like lines (short line after a blank line, no end punctuation)",
);
console.table(
  await query(`
    SELECT trim(heading) AS heading, count(*) AS n
    FROM (SELECT unnest(regexp_extract_all(text, '\\n\\n([^\\n.!?:]{1,50})\\n', 1)) AS heading FROM articles)
    GROUP BY 1
    ORDER BY n DESC
    LIMIT 20
  `),
);

console.log("\n== Wiki markup leftovers (articles containing each)");
console.table(
  await query(`
    SELECT
      count(*) FILTER (WHERE text LIKE '%{{%') AS templates,
      count(*) FILTER (WHERE text LIKE '%[[%') AS wikilinks,
      count(*) FILTER (WHERE text LIKE '%<ref%') AS ref_tags,
      count(*) FILTER (WHERE text LIKE '%thumb|%') AS image_captions,
      count(*) FILTER (WHERE text LIKE '%' || chr(10) || '| %') AS table_rows
    FROM articles
  `),
);

// JSON.stringify makes newlines and trailing spaces visible.
console.log("\n== Samples (raw text, JSON-escaped)");
const samples = await query(`
  SELECT title, url, text
  FROM articles
  WHERE title IN ('Barcelona', 'Ostrogoths', 'Panaci', 'Lionel Messi')
`);
for (const { title, url, text } of samples) {
  const raw = String(text);
  console.log(`\n--- ${title} (${url}), ${raw.length} chars`);
  console.log(`start: ${JSON.stringify(raw.slice(0, 500))}`);
  console.log(`end:   ${JSON.stringify(raw.slice(-300))}`);
}

// First working subset: 10k articles in a fixed pseudo-random order (hash of the id),
// skipping disambiguation pages and "List of" pages, which are mostly link lists.
// Taking the first 100k of the same order later gives a superset of these 10k.
console.log("\n== Proposed first subset: 10k articles, ordered by hash(id)");
const subsetQuery = `
  SELECT * FROM articles
  WHERE title NOT LIKE '%(disambiguation)'
    AND text NOT LIKE '%may refer to%'
    AND text NOT LIKE '%may mean:%'
    AND title NOT LIKE 'List of %'
  ORDER BY hash(id)
  LIMIT 10000
`;
console.table(
  await query(`
    SELECT
      count(*) AS articles,
      sum(length(text)) AS total_chars,
      quantile_cont(length(text), 0.50)::INT AS p50_chars,
      count(*) FILTER (WHERE length(text) < 200) AS stubs_under_200_chars
    FROM (${subsetQuery})
  `),
);
console.table(
  await query(
    `SELECT title, length(text) AS chars FROM (${subsetQuery}) LIMIT 10`,
  ),
);

conn.closeSync();
db.closeSync();
