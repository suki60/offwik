import { open, readFile } from "node:fs/promises";
import { pipeline } from "@huggingface/transformers";
import { connect } from "../db.ts";
import { search } from "../search.ts";
import { DIMS, dot, hammingTopN, rescore, toBits } from "../vector-search.ts";
import { questions } from "./questions.ts";

// Stage 9, step 3: does the file search (vector-search.ts over public/data,
// written by setup/export.ts) find the right articles as often as pgvector?
// Recall@5 at article level: is the expected article among the top 5 chunks?
// Rankings compared, per query embedding dtype (fp16 = Ollama's vectors
// exactly, q8 = smaller download, cosine ~0.97 with Ollama in step 1):
// - pgvector:      HNSW, ef_search 1000 (the Mac app), fp16 query only
// - binary:        Hamming distance only, top 5
// - binary + int8: Hamming top N candidates, int8 rescore to 5 (the phone)
// - exact int8:    int8 dot product with every row (upper bound for the above)
// Usage: npm run search-eval [-- <candidates>]   (default 200)

const MODEL = "nomic-ai/nomic-embed-text-v1.5";
const DTYPES = ["fp16", "q8"] as const;
const DIR = "public/data";
const K = 5;
const CANDIDATES = Number(process.argv[2] ?? 200);

// Whole files in memory: fine in Node for an eval. The browser keeps only
// vectors.bin and offsets.bin in memory and reads the rest by offset.
// Large Buffers start at byteOffset 0, so the typed array views line up.
const bitsBuffer = await readFile(`${DIR}/vectors.bin`);
const bits = new Uint32Array(bitsBuffer.buffer, 0, bitsBuffer.length / 4);
const int8Buffer = await readFile(`${DIR}/vectors.i8`);
const int8 = new Int8Array(int8Buffer.buffer, 0, int8Buffer.length);
const offsetsBuffer = await readFile(`${DIR}/offsets.bin`);

const offsets = new Uint32Array(
  offsetsBuffer.buffer,
  0,
  offsetsBuffer.length / 4,
);

const count = offsets.length - 1;
const i8File = await open(`${DIR}/vectors.i8`);
const textFile = await open(`${DIR}/text.bin`);
const db = await connect();

// One int8 row read from disk, like the browser will do with OPFS.
async function readRow(row: number) {
  const vector = new Int8Array(DIMS);
  await i8File.read(vector, 0, DIMS, row * DIMS);
  return vector;
}

async function readTitle(row: number) {
  const start = offsets[row] ?? 0;
  const end = offsets[row + 1] ?? 0;
  const record = Buffer.alloc(end - start);
  await textFile.read(record, 0, end - start, start);
  return JSON.parse(record.toString()).title as string;
}

// Every row's int8 dot product, keeping the k best in a small sorted list.
function exactTopK(q: number[], k: number) {
  const best: { row: number; score: number }[] = [];

  for (let row = 0; row < count; row++) {
    const score = dot(q, int8, row * DIMS);

    if (best.length < k || score > (best[best.length - 1]?.score ?? 0)) {
      best.push({ row, score });
      best.sort((a, b) => b.score - a.score);
      if (best.length > k) best.pop();
    }
  }

  return best.map(({ row }) => row);
}

const texts = questions.map(({ question }) => `search_query: ${question}`);
const hits: Record<string, number> = {};
const misses: string[] = [];
let hammingMs = 0;
let rescoreMs = 0;

function tally(method: string, titles: string[], index: number) {
  const { question, title } = questions[index] ?? { question: "", title: "" };
  hits[method] = (hits[method] ?? 0) + (titles.includes(title) ? 1 : 0);

  if (!titles.includes(title)) {
    misses.push(`✗ ${method.padEnd(19)} ${question}  (${title})`);
  }
}

for (const dtype of DTYPES) {
  const extractor = await pipeline("feature-extraction", MODEL, { dtype });
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  const vectors: number[][] = output.tolist();
  await extractor.dispose();

  for (const [i, q] of vectors.entries()) {
    if (dtype === "fp16") {
      const passages = await search(db, q, K);

      tally(
        "pgvector",
        passages.map(({ title }) => title),
        i,
      );
    }

    const hammingStart = performance.now();
    const candidates = hammingTopN(bits, toBits(q), CANDIDATES);
    hammingMs += performance.now() - hammingStart;
    const rescoreStart = performance.now();
    const top = await rescore(candidates, readRow, q, K);
    rescoreMs += performance.now() - rescoreStart;
    const binary = candidates.slice(0, K);
    const exact = exactTopK(q, K);
    tally(`binary ${dtype}`, await Promise.all(binary.map(readTitle)), i);
    tally(`binary+int8 ${dtype}`, await Promise.all(top.map(readTitle)), i);
    tally(`exact int8 ${dtype}`, await Promise.all(exact.map(readTitle)), i);
  }

  console.log(`${dtype} done`);
}

await i8File.close();
await textFile.close();
await db.end();
const queries = questions.length * DTYPES.length;
console.log(`\n${misses.join("\n")}\n`);
console.log(`recall@${K} (${questions.length} questions, ${count} rows):`);

for (const [method, hit] of Object.entries(hits)) {
  console.log(`  ${method.padEnd(19)} ${hit}/${questions.length}`);
}

console.log(
  `per query: hamming ${(hammingMs / queries).toFixed(1)} ms, rescore of ${CANDIDATES} rows ${(rescoreMs / queries).toFixed(1)} ms`,
);
