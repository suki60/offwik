import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// Setup step 1: download the Simple English dump from Hugging Face and check
// it is exactly the file every number in PLAN.md was measured on.
// - REVISION pins a dataset commit (`main` could change the data).
// - SHA256 is the hash Hugging Face publishes for this file.
// Skipped when data/simple.parquet is already there and matches.
// Usage: npm run download

const REVISION = "b04c8d1ceb2f5cd4588862100d08de323dccfbaa";
const URL = `https://huggingface.co/datasets/wikimedia/wikipedia/resolve/${REVISION}/20231101.simple/train-00000-of-00001.parquet`;
const SHA256 =
  "31bded16768a47c286becd292079122f5d7d4397a17b87d4250a00ccd581e6f0";
const FILE = "data/simple.parquet";

// Reads the file in pieces: no need to hold 157 MB in memory.
async function sha256(path: string) {
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

if (existsSync(FILE) && (await sha256(FILE)) === SHA256) {
  console.log(`${FILE} already downloaded, sha256 matches`);
  process.exit(0);
}

console.log(`Downloading ${URL} (157 MB)...`);
await mkdir("data", { recursive: true });
const response = await fetch(URL);

if (!response.ok || !response.body) {
  throw new Error(`Download failed: HTTP ${response.status}`);
}

// Written to a .part file first and renamed only once the hash matches, so
// data/simple.parquet is never a half-downloaded file.
const partFile = `${FILE}.part`;
await pipeline(Readable.fromWeb(response.body), createWriteStream(partFile));
const actual = await sha256(partFile);

if (actual !== SHA256) {
  throw new Error(
    `sha256 mismatch: expected ${SHA256}, got ${actual} (${partFile} kept)`,
  );
}

await rename(partFile, FILE);
console.log(`Saved ${FILE}, sha256 matches`);
