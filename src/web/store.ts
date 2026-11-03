import type { Passage } from "../rag.ts";
import { DIMS, WORDS } from "../vector-search.ts";

// Stage 9, step 4a: the files from setup/export.ts, kept in the browser's
// Origin Private File System (OPFS): a private disk area per site that stays
// after reloads, with real files that can be read at an offset.
// - First visit: each file is streamed from /data/ (Vite serves public/) into
//   OPFS, never held in memory as a whole.
// - Every visit: vectors.bin (36 MB) and offsets.bin (1.5 MB) go into memory
//   for the Hamming scan; vectors.i8 and text.bin stay on disk and are read
//   by slice: 200 int8 rows and 5 records per question.

export type Store = {
  bits: Uint32Array;
  readRow: (row: number) => Promise<Int8Array>;
  readRecord: (row: number) => Promise<Passage>;
};

type Meta = { count: number; dims: number; scale: number };

// Bytes copied so far and in total, for a progress bar.
export type Progress = (copied: number, total: number) => void;

async function fetchOk(url: string) {
  const response = await fetch(url);

  // fetch only rejects on network errors: HTTP errors have to be checked by hand.
  if (!response.ok || !response.body) {
    throw new Error(`${url} ${response.status}`);
  }

  return response;
}

// Size of a file in OPFS, or -1 when it doesn't exist yet.
async function sizeOf(dir: FileSystemDirectoryHandle, name: string) {
  try {
    const handle = await dir.getFileHandle(name);
    return (await handle.getFile()).size;
  } catch {
    return -1;
  }
}

async function open(onProgress?: Progress): Promise<Store> {
  const dir = await navigator.storage.getDirectory();

  // meta.json is 45 bytes: always fetched, it says how big every other file
  // must be. A file with the right size counts as copied, so a copy cut off
  // halfway (tab closed) is detected and done again. text.bin's size is the
  // last entry of offsets.bin, so offsets.bin is copied before it.
  const meta: Meta = await (await fetchOk("/data/meta.json")).json();

  if (meta.dims !== DIMS) throw new Error(`Expected ${DIMS} dims`);

  const sizes: Record<string, number> = {
    "offsets.bin": (meta.count + 1) * 4,
    "vectors.bin": meta.count * WORDS * 4,
    "vectors.i8": meta.count * DIMS,
  };

  let total = Object.values(sizes).reduce((sum, size) => sum + size, 0);
  let copied = 0;

  async function copy(name: string) {
    if ((await sizeOf(dir, name)) === sizes[name]) {
      copied += sizes[name] ?? 0;
      return;
    }

    const response = await fetchOk(`/data/${name}`);
    const handle = await dir.getFileHandle(name, { create: true });

    // Counts the bytes on their way from the network to the file.
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        copied += chunk.length;
        onProgress?.(copied, total);
        controller.enqueue(chunk);
      },
    });

    const writable = await handle.createWritable();

    // pipeTo closes the writable when the download ends, which saves the file.
    await response.body?.pipeThrough(counter).pipeTo(writable);
  }

  await copy("offsets.bin");
  const offsetsFile = await (await dir.getFileHandle("offsets.bin")).getFile();
  const offsets = new Uint32Array(await offsetsFile.arrayBuffer());
  sizes["text.bin"] = offsets[meta.count] ?? 0;
  total += sizes["text.bin"];
  await copy("vectors.bin");
  await copy("vectors.i8");
  await copy("text.bin");
  onProgress?.(total, total);
  const bitsFile = await (await dir.getFileHandle("vectors.bin")).getFile();
  const bits = new Uint32Array(await bitsFile.arrayBuffer());
  const i8File = await (await dir.getFileHandle("vectors.i8")).getFile();
  const textFile = await (await dir.getFileHandle("text.bin")).getFile();

  return {
    bits,
    // Row i of vectors.i8 is bytes [i × 768, (i + 1) × 768).
    readRow: async (row) =>
      new Int8Array(
        await i8File.slice(row * DIMS, (row + 1) * DIMS).arrayBuffer(),
      ),
    // Record i of text.bin is bytes [offsets[i], offsets[i + 1]): JSON
    // written by export.ts. Blob.text() decodes UTF-8.
    readRecord: async (row) =>
      JSON.parse(
        await textFile.slice(offsets[row], offsets[row + 1]).text(),
      ) as Passage,
  };
}

// One copy at a time: React's StrictMode runs effects twice in development,
// and the second call must reuse the first instead of copying again.
let opening: Promise<Store> | undefined;

export function openStore(onProgress?: Progress) {
  opening ??= open(onProgress);
  return opening;
}
