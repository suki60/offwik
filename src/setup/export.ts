import { existsSync, readFileSync } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { connect } from "../db.ts";

// Stage 9, step 2: export chunks + vectors from Postgres into flat files the
// browser can search without a server. Row i is the same chunk in every file:
// - vectors.bin  96 bytes/row: 768 sign bits (bit d = 1 when value d > 0),
//                packed into 24 Uint32 words, for the fast first pass
// - vectors.i8   768 bytes/row: Int8 values, round(x / scale * 127), for
//                rescoring the candidates
// - text.bin     UTF-8 JSON records {title, url, content}, back to back
// - offsets.bin  Uint32 × (count + 1): record i is bytes
//                [offsets[i], offsets[i + 1]) of text.bin
// - meta.json    { count, dims, scale }
// Vite serves public/ as is, so the page fetches /data/vectors.bin etc.
// Setup step 5: skipped when meta.json already counts every embedded chunk.
// To export again (e.g. after re-embedding): rm -r public/data
// Usage: npm run export

const DIR = "public/data";
const DIMS = 768;
const WORDS = DIMS / 32;
const PAGE = 5_000;

const db = await connect();

async function embeddedCount() {
  const { rows } = await db.query<{ count: number }>(
    "SELECT count(*) FROM chunks WHERE embedding_nomic IS NOT NULL",
  );

  return rows[0]?.count ?? 0;
}

// One global scale for int8: the largest absolute value in any vector. With
// unit vectors the values are around ±0.04, so x * 127 directly would use only
// a handful of the 255 steps. vector::real[] makes the values unnest-able.
async function maxAbs() {
  const { rows } = await db.query<{ scale: number }>(
    `SELECT max(abs(x)) AS scale
     FROM chunks, unnest(embedding_nomic::real[]) AS x
     WHERE embedding_nomic IS NOT NULL`,
  );

  return rows[0]?.scale ?? 1;
}

if (existsSync(`${DIR}/meta.json`)) {
  const meta = JSON.parse(readFileSync(`${DIR}/meta.json`, "utf8"));

  if (meta.count === (await embeddedCount())) {
    console.log(`${DIR} already holds all ${meta.count} rows, nothing to do.`);
    await db.end();
    process.exit(0);
  }
}

const scale = await maxAbs();
console.log(`int8 scale (max |value|): ${scale}`);

await mkdir(DIR, { recursive: true });
const binFile = await open(`${DIR}/vectors.bin`, "w");
const i8File = await open(`${DIR}/vectors.i8`, "w");
const textFile = await open(`${DIR}/text.bin`, "w");
const offsets: number[] = [0];
let textBytes = 0;
let lastId = 0;
const start = performance.now();

type Row = {
  id: number;
  title: string;
  url: string;
  content: string;
  embedding: string;
};

while (true) {
  // Keyset paging: continue after the last id instead of OFFSET, which would
  // re-read every skipped row and get slower page after page.
  const { rows } = await db.query<Row>(
    `SELECT c.id, a.title, a.url, c.content, c.embedding_nomic AS embedding
     FROM chunks c
     JOIN articles a ON a.id = c.article_id
     WHERE c.embedding_nomic IS NOT NULL AND c.id > $1
     ORDER BY c.id
     LIMIT $2`,
    [lastId, PAGE],
  );

  if (rows.length === 0) break;
  const bits = new Uint32Array(rows.length * WORDS);
  const int8 = new Int8Array(rows.length * DIMS);
  const records: Buffer[] = [];

  for (const [r, row] of rows.entries()) {
    // pg returns pgvector's type as text: "[0.01,-0.2,...]".
    const vector: number[] = JSON.parse(row.embedding);

    for (let d = 0; d < DIMS; d++) {
      const x = vector[d] ?? 0;
      const word = r * WORDS + (d >> 5);
      if (x > 0) bits[word] = (bits[word] ?? 0) | (1 << (d & 31));
      int8[r * DIMS + d] = Math.round((x / scale) * 127);
    }

    const record = Buffer.from(
      JSON.stringify({ title: row.title, url: row.url, content: row.content }),
    );

    records.push(record);
    textBytes += record.length;
    offsets.push(textBytes);
  }

  // Typed arrays are written in the machine's byte order (little-endian on
  // the Mac and the iPhone), which is what Uint32Array reads back.
  await binFile.write(new Uint8Array(bits.buffer));
  await i8File.write(new Uint8Array(int8.buffer));
  await textFile.write(Buffer.concat(records));
  lastId = rows[rows.length - 1]?.id ?? lastId;
  const done = offsets.length - 1;

  if (done % 50_000 < PAGE) {
    const seconds = (performance.now() - start) / 1000;
    console.log(`${done} rows  ${(done / seconds).toFixed(0)} rows/s`);
  }
}

await binFile.close();
await i8File.close();
await textFile.close();
const count = offsets.length - 1;
await writeFile(`${DIR}/offsets.bin`, new Uint32Array(offsets));

await writeFile(
  `${DIR}/meta.json`,
  JSON.stringify({ count, dims: DIMS, scale }),
);

await db.end();
const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

console.log(
  `Done: ${count} rows in ${((performance.now() - start) / 1000).toFixed(0)} s
  vectors.bin  ${mb(count * WORDS * 4)}
  vectors.i8   ${mb(count * DIMS)}
  text.bin     ${mb(textBytes)}
  offsets.bin  ${mb((count + 1) * 4)}`,
);
