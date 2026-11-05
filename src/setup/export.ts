import { existsSync, readFileSync } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { connect } from "../db.ts";
import { DIMS, WORDS } from "../vector-search.ts";

// Setup step 5: export chunks + arctic vectors from Postgres into flat files
// the browser searches without a server (vector-search.ts). Row i is the same
// chunk in every file:
// - vectors.bin  sign bits, WORDS Uint32 per row (fast first pass)
// - vectors.i8   int8 values, DIMS bytes per row: round(x / scale × 127)
// - text.bin     JSON records {title, url, content}, back to back
// - offsets.bin  Uint32 × (count + 1): record i is bytes
//                [offsets[i], offsets[i + 1]) of text.bin
// - meta.json    { count, dims, scale }
// Vite serves public/, so the page fetches /data/vectors.bin etc.
// Skipped when meta.json already counts every embedded chunk. To export
// again: rm -r public/data
// Usage: npm run export

const DIR = "public/data";
const PAGE = 5_000;

const db = await connect();

const { rows: counted } = await db.query(
  "SELECT count(*) FROM chunks WHERE embedding_arctic IS NOT NULL",
);

if (
  existsSync(`${DIR}/meta.json`) &&
  JSON.parse(readFileSync(`${DIR}/meta.json`, "utf8")).count ===
    counted[0].count
) {
  console.log(`${DIR} already holds all ${counted[0].count} rows.`);
  await db.end();
  process.exit(0);
}

// One scale for all int8 values: the largest absolute value in any vector.
// The values are small (around ±0.04), so x × 127 directly would use only a
// few of the 255 steps.
const { rows: scaled } = await db.query(
  `SELECT max(abs(x)) AS scale
   FROM chunks, unnest(embedding_arctic::real[]) AS x
   WHERE embedding_arctic IS NOT NULL`,
);

const scale: number = scaled[0].scale;
console.log(`int8 scale: ${scale}`);
await mkdir(DIR, { recursive: true });
const binFile = await open(`${DIR}/vectors.bin`, "w");
const i8File = await open(`${DIR}/vectors.i8`, "w");
const textFile = await open(`${DIR}/text.bin`, "w");
const offsets = [0];
let lastId = 0;

while (true) {
  // Keyset paging: continue after the last id (OFFSET would re-read every
  // skipped row and get slower page after page).
  const { rows } = await db.query(
    `SELECT c.id, a.title, a.url, c.content, c.embedding_arctic AS embedding
     FROM chunks c
     JOIN articles a ON a.id = c.article_id
     WHERE c.embedding_arctic IS NOT NULL AND c.id > $1
     ORDER BY c.id
     LIMIT $2`,
    [lastId, PAGE],
  );

  if (rows.length === 0) break;
  const bits = new Uint32Array(rows.length * WORDS);
  const int8 = new Int8Array(rows.length * DIMS);
  const records: Buffer[] = [];

  for (const [r, row] of rows.entries()) {
    // pg returns a pgvector value as text: "[0.01,-0.2,...]".
    const vector: number[] = JSON.parse(row.embedding);

    for (let d = 0; d < DIMS; d++) {
      if (vector[d] > 0) bits[r * WORDS + (d >> 5)] |= 1 << (d & 31);
      int8[r * DIMS + d] = Math.round((vector[d] / scale) * 127);
    }

    const { title, url, content } = row;
    const record = Buffer.from(JSON.stringify({ title, url, content }));
    records.push(record);
    offsets.push(offsets[offsets.length - 1] + record.length);
  }

  await binFile.write(new Uint8Array(bits.buffer));
  await i8File.write(new Uint8Array(int8.buffer));
  await textFile.write(Buffer.concat(records));
  lastId = rows[rows.length - 1].id;
  console.log(`${offsets.length - 1} rows`);
}

await binFile.close();
await i8File.close();
await textFile.close();
const count = offsets.length - 1;
const meta = { count, dims: DIMS, scale };
await writeFile(`${DIR}/offsets.bin`, new Uint32Array(offsets));
await writeFile(`${DIR}/meta.json`, JSON.stringify(meta));
await db.end();
console.log(`Done: ${count} rows in ${DIR}`);
