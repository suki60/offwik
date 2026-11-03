// Stage 9, step 3: search the files written by setup/export.ts, without
// Postgres. Shared by eval/search-eval.ts (Node) and, in step 4, the browser:
// only the function that reads an int8 row differs between the two.
// Two passes:
// 1. hammingTopN: sign bits of the query vs. sign bits of every row (in
//    memory), count the bits that differ, keep the n rows with the fewest.
// 2. rescore: dot product of the float query with the int8 rows of those n
//    candidates (read from disk), keep the k highest. The stored vectors have
//    length 1, so the dot product ranks like cosine; the int8 scale is the same
//    for every row and doesn't change the order either.

export const DIMS = 768;
export const WORDS = DIMS / 32;

// Same packing as export.ts: bit d of the vector is bit (d % 32) of word
// (d / 32), set when the value is above 0.
export function toBits(vector: number[]) {
  const bits = new Uint32Array(WORDS);

  for (let d = 0; d < DIMS; d++) {
    const word = d >> 5;
    if ((vector[d] ?? 0) > 0) bits[word] = (bits[word] ?? 0) | (1 << (d & 31));
  }

  return bits;
}

// Number of 1 bits in a 32-bit word, without a loop over the bits: add
// neighbouring bits in pairs, then the pairs in nibbles, then the nibbles in
// bytes; the multiplication sums the 4 bytes into the top byte.
function popcount(word: number) {
  let x = word - ((word >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

// The n rows whose sign bits differ least from the query's, closest first.
// Distances are only 0..768, so instead of sorting 370k numbers: count how
// many rows have each distance, then walk up from 0 to find the cutoff.
export function hammingTopN(bits: Uint32Array, qBits: Uint32Array, n: number) {
  const count = bits.length / WORDS;
  const distances = new Uint16Array(count);
  const histogram = new Uint32Array(DIMS + 1);

  for (let i = 0; i < count; i++) {
    let distance = 0;

    // XOR: 1 where the signs differ, 32 dimensions per operation.
    for (let w = 0; w < WORDS; w++) {
      distance += popcount((bits[i * WORDS + w] ?? 0) ^ (qBits[w] ?? 0));
    }

    distances[i] = distance;
    histogram[distance] = (histogram[distance] ?? 0) + 1;
  }

  // Smallest cutoff with at least n rows at or below it. `below` rows are
  // strictly closer; the rest of the n are taken from the ties at the cutoff.
  let cutoff = 0;
  let below = 0;

  while (cutoff < DIMS && below + (histogram[cutoff] ?? 0) < n) {
    below += histogram[cutoff] ?? 0;
    cutoff++;
  }

  const rows: number[] = [];
  let ties = n - below;

  for (let i = 0; i < count; i++) {
    const distance = distances[i] ?? DIMS;

    if (distance < cutoff) {
      rows.push(i);
    } else if (distance === cutoff && ties > 0) {
      rows.push(i);
      ties--;
    }
  }

  return rows.sort((a, b) => (distances[a] ?? 0) - (distances[b] ?? 0));
}

// Dot product of the float query with one int8 row, which starts at
// `offset` in `data` (0 for a single row, i * DIMS for all rows in memory).
export function dot(q: number[], data: Int8Array, offset = 0) {
  let sum = 0;

  for (let d = 0; d < DIMS; d++) {
    sum += (q[d] ?? 0) * (data[offset + d] ?? 0);
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
