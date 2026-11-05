import type { Passage } from "../rag.ts";
import { DIMS, WORDS } from "../vector-search.ts";

// The files from setup/export.ts, kept in the browser's Origin Private File
// System (OPFS): a private disk area per site that survives reloads.
// - First visit: each file is streamed from /data/ into OPFS.
// - Every visit: vectors.bin and offsets.bin go into memory for the Hamming
//   scan; vectors.i8 and text.bin stay on disk and are read by slice.

export type Store = {
  bits: Uint32Array;
  readRow: (row: number) => Promise<Int8Array>;
  readRecord: (row: number) => Promise<Passage>;
};

// Bytes copied so far and in total, for the progress text.
export type Progress = (copied: number, total: number) => void;

async function fileSize(dir: FileSystemDirectoryHandle, name: string) {
  try {
    return (await (await dir.getFileHandle(name)).getFile()).size;
  } catch {
    return -1;
  }
}

async function open(onProgress: Progress): Promise<Store> {
  const dir = await navigator.storage.getDirectory();

  // meta.json says how big every file must be. A file with the right size
  // counts as copied, so a copy cut off halfway is done again.
  const { count } = await (await fetch("/data/meta.json")).json();

  const sizes: Record<string, number> = {
    "offsets.bin": (count + 1) * 4,
    "vectors.bin": count * WORDS * 4,
    "vectors.i8": count * DIMS,
  };

  let total = sizes["offsets.bin"] + sizes["vectors.bin"] + sizes["vectors.i8"];
  let copied = 0;

  async function copy(name: string) {
    if ((await fileSize(dir, name)) !== sizes[name]) {
      const response = await fetch(`/data/${name}`);
      const handle = await dir.getFileHandle(name, { create: true });

      // Counts the bytes on their way from the network to the file.
      const counter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          copied += chunk.length;
          onProgress(copied, total);
          controller.enqueue(chunk);
        },
      });

      // pipeTo closes the file when the download ends, which saves it.
      const file = await handle.createWritable();
      await response.body?.pipeThrough(counter).pipeTo(file);
    } else {
      copied += sizes[name];
    }

    return (await dir.getFileHandle(name)).getFile();
  }

  // text.bin's size is the last offset, so offsets.bin comes first.
  const offsetsFile = await copy("offsets.bin");
  const offsets = new Uint32Array(await offsetsFile.arrayBuffer());
  sizes["text.bin"] = offsets[count];
  total += sizes["text.bin"];
  const bitsFile = await copy("vectors.bin");
  const bits = new Uint32Array(await bitsFile.arrayBuffer());
  const i8File = await copy("vectors.i8");
  const textFile = await copy("text.bin");

  return {
    bits,
    readRow: async (row) =>
      new Int8Array(
        await i8File.slice(row * DIMS, (row + 1) * DIMS).arrayBuffer(),
      ),
    readRecord: async (row) =>
      JSON.parse(await textFile.slice(offsets[row], offsets[row + 1]).text()),
  };
}

// One open at a time: Start and the search eval both call this, and the
// second call reuses the first.
let opening: Promise<Store> | undefined;

export function openStore(onProgress: Progress = () => {}) {
  opening ??= open(onProgress);
  return opening;
}
