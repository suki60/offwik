import { open, readFile } from "node:fs/promises";
import { connect } from "../db.ts";
import { embed } from "../ollama.ts";
import { search } from "../search.ts";
import { DIMS, hammingTopN, rescore, toBits } from "../vector-search.ts";
import { questions } from "./questions.ts";

// Does the phone's search (arctic vectors in public/data, Hamming + int8
// rescore) find the expected article as often as pgvector (nomic, HNSW)?
// Recall@5 at article level: is the expected article among the top 5 chunks?
// Usage: npm run search-eval [-- <candidates>]   (default 200)

// Arctic prefixes only queries; nomic prefixes both sides.
const ARCTIC_PREFIX =
  "Represent this sentence for searching relevant passages: ";
const DIR = "public/data";
const K = 5;
const CANDIDATES = Number(process.argv[2] ?? 200);

// Uint32Array views over the file bytes (4 bytes per number).
const toUint32 = (buffer: Buffer) =>
  new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);

const bits = toUint32(await readFile(`${DIR}/vectors.bin`));
const offsets = toUint32(await readFile(`${DIR}/offsets.bin`));
const i8File = await open(`${DIR}/vectors.i8`);
const textFile = await open(`${DIR}/text.bin`);
const db = await connect();

// Read from disk by offset, like the browser does with OPFS.
async function readRow(row: number) {
  const vector = new Int8Array(DIMS);
  await i8File.read(vector, 0, DIMS, row * DIMS);
  return vector;
}

async function readTitle(row: number) {
  const record = Buffer.alloc(offsets[row + 1] - offsets[row]);
  await textFile.read(record, 0, record.length, offsets[row]);
  return JSON.parse(record.toString()).title as string;
}

// One embeddings request per model for all 48 questions.
const nomicVectors = await embed(
  questions.map(({ question }) => `search_query: ${question}`),
);

const arcticVectors = await embed(
  questions.map(({ question }) => `${ARCTIC_PREFIX}${question}`),
  "snowflake-arctic-embed:33m",
);

let pgvectorHits = 0;
let fileHits = 0;
let hammingMs = 0;

for (const [i, { question, title }] of questions.entries()) {
  const passages = await search(db, nomicVectors[i], K);
  const q = arcticVectors[i];
  const start = performance.now();
  const candidates = hammingTopN(bits, toBits(q), CANDIDATES);
  hammingMs += performance.now() - start;
  const top = await rescore(candidates, readRow, q, K);
  const titles = await Promise.all(top.map(readTitle));

  if (passages.some((passage) => passage.title === title)) {
    pgvectorHits++;
  } else {
    console.log(`✗ pgvector nomic  ${question}  (${title})`);
  }

  if (titles.includes(title)) {
    fileHits++;
  } else {
    console.log(`✗ arctic files    ${question}  (${title})`);
  }
}

await i8File.close();
await textFile.close();
await db.end();
const n = questions.length;
console.log(`\nrecall@${K} (${n} questions, ${offsets.length - 1} rows):`);
console.log(`  pgvector nomic  ${pgvectorHits}/${n}`);
console.log(`  arctic files    ${fileHits}/${n}  (${CANDIDATES} candidates)`);
console.log(`Hamming per query: ${(hammingMs / n).toFixed(1)} ms`);
