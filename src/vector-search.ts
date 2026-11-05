// Search over the files written by setup/export.ts, without Postgres. Shared
// by eval/search-eval.ts (Node) and the browser (web/pipeline.ts). Two passes:
// 1. hammingTopN: sign bits of the query vs. sign bits of every row, keep the
//    n rows where the fewest bits differ.
// 2. rescore: dot product of the query with the int8 rows of those n
//    candidates, keep the k highest.

// snowflake-arctic-embed-s vectors. WORDS: 32 sign bits per Uint32.
export const DIMS = 384;
export const WORDS = DIMS / 32;

// Bit d is set when value d is above 0 (same packing as export.ts).
export function toBits(vector: number[]) {
  const bits = new Uint32Array(WORDS);

  for (let d = 0; d < DIMS; d++) {
    if (vector[d] > 0) bits[d >> 5] |= 1 << (d & 31);
  }

  return bits;
}

// Number of 1 bits in a 32-bit word: add neighbouring bits in pairs, then
// the pairs in nibbles, then the nibbles in bytes; the multiplication sums
// the 4 bytes into the top byte.
function popcount(word: number) {
  let x = word - ((word >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

// The n rows whose sign bits differ least from the query's, closest first.
// Distances are only 0..DIMS, so instead of sorting all 370k rows: count the
// rows per distance, find the cutoff distance that reaches n rows, and sort
// only the rows up to it.
export function hammingTopN(bits: Uint32Array, qBits: Uint32Array, n: number) {
  const count = bits.length / WORDS;
  const distances = new Uint16Array(count);
  const histogram = new Uint32Array(DIMS + 1);

  for (let i = 0; i < count; i++) {
    let distance = 0;

    // XOR: 1 where the signs differ, 32 dimensions per operation.
    for (let w = 0; w < WORDS; w++) {
      distance += popcount(bits[i * WORDS + w] ^ qBits[w]);
    }

    distances[i] = distance;
    histogram[distance]++;
  }

  let cutoff = 0;
  let total = histogram[0];

  while (total < n && cutoff < DIMS) {
    cutoff++;
    total += histogram[cutoff];
  }

  const rows: number[] = [];

  for (let i = 0; i < count; i++) {
    if (distances[i] <= cutoff) rows.push(i);
  }

  // sort() is stable: ties stay in row order.
  return rows.sort((a, b) => distances[a] - distances[b]).slice(0, n);
}

function dot(q: number[], row: Int8Array) {
  let sum = 0;

  for (let d = 0; d < DIMS; d++) {
    sum += q[d] * row[d];
  }

  return sum;
}

// The k best candidates by int8 dot product, best first. readRow reads one
// row of vectors.i8: fileHandle.read in Node, an OPFS file slice in the
// browser.
export async function rescore(
  candidates: number[],
  readRow: (row: number) => Promise<Int8Array>,
  q: number[],
  k: number,
) {
  const scored = await Promise.all(
    candidates.map(async (row) => ({ row, score: dot(q, await readRow(row)) })),
  );

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ row }) => row);
}
