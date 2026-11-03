import {
  type FeatureExtractionPipeline,
  type ProgressInfo,
  pipeline,
} from "@huggingface/transformers";
import {
  type CompletionUsage,
  CreateMLCEngine,
  type InitProgressReport,
  type MLCEngine,
} from "@mlc-ai/web-llm";
import { buildMessages, citedPassages, type Passage } from "../rag.ts";
import { hammingTopN, rescore, toBits } from "../vector-search.ts";
import { openStore } from "./store.ts";

// Stage 7, step 4: the three steps of a RAG answer in the browser, each behind
// its own function so later stages can swap one without touching the UI:
// - embedQuery: transformers.js in the browser since stage 9 (was Ollama)
// - search:     inside the browser since stage 9 (was server.ts + pgvector)
// - answer:     WebLLM in the browser since stage 10 (was Ollama)

// Same k as rag-eval.ts, where this prompt scored 42/48 with llama3.2:1b.
const K = 5;

// Stage 9, step 4b: the query is embedded in the browser by transformers.js
// (was Ollama's /v1/embeddings). Same model as the stored vectors, ONNX export.
// dtype must be set: without it transformers.js picks q8 on wasm and fp32 on
// WebGPU. fp16 gave Ollama's vectors exactly (cosine 1.0000, PLAN.md stage 9)
// and 48/48 in search-eval.ts; q8 drifted (0.97) and lost one question.
// The weights (~275 MB) are downloaded once and cached by the browser.
const EMBED_MODEL = "nomic-ai/nomic-embed-text-v1.5";

let embedder: Promise<FeatureExtractionPipeline> | undefined;

// Loads the model once; later calls reuse it (same reason as openStore).
export function loadEmbedder(onProgress?: (info: ProgressInfo) => void) {
  embedder ??= pipeline("feature-extraction", EMBED_MODEL, {
    dtype: "fp16",
    device: "webgpu",
    progress_callback: onProgress,
  });

  return embedder;
}

// Same prefix and pooling as eval/search-eval.ts: "search_query: " for queries,
// mean over the tokens, then length 1.
export async function embedQuery(question: string): Promise<number[]> {
  const extractor = await loadEmbedder();

  const output = await extractor(`search_query: ${question}`, {
    pooling: "mean",
    normalize: true,
  });

  return output.tolist()[0];
}

// Stage 9, step 4a: search the exported files in OPFS (store.ts) instead of
// server.ts + pgvector. Hamming over all rows, int8 rescore of the best
// CANDIDATES: 48/48 in search-eval.ts with 200 (pgvector HNSW: 46/48).
const CANDIDATES = 200;

export async function search(vector: number[]) {
  const { bits, readRow, readRecord } = await openStore();
  const start = performance.now();
  const candidates = hammingTopN(bits, toBits(vector), CANDIDATES);
  const hammingMs = performance.now() - start;
  const top = await rescore(candidates, readRow, vector, K);
  const passages = await Promise.all(top.map(readRecord));
  return { passages, hammingMs };
}

// Stage 10, step 1: the answer comes from WebLLM in the browser (was
// Ollama). Same model as rag-eval.ts in Node (llama3.2:1b), WebLLM's 4-bit
// build: ~695 MB download, ~879 MB GPU memory (stage 8). The weights are
// cached by WebLLM (Cache API) after the first download.
export const CHAT_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

let chat: Promise<MLCEngine> | undefined;

// Loads the model once; later calls reuse it (same reason as openStore).
export function loadChat(onProgress?: (report: InitProgressReport) => void) {
  chat ??= CreateMLCEngine(CHAT_MODEL, { initProgressCallback: onProgress });
  return chat;
}

// Same prompt as rag-eval.ts (rag.ts). Streams the reply: onReply gets the
// text so far after every chunk. The last chunk carries WebLLM's usage
// (prefill / decode tok/s, time to first token), like in spike.ts (stage 8).
// No enable_thinking: Llama 3.2 doesn't think (see stage 8).
export async function answer(
  question: string,
  passages: Passage[],
  onReply: (reply: string) => void,
) {
  const engine = await loadChat();

  const chunks = await engine.chat.completions.create({
    messages: buildMessages(question, passages),
    temperature: 0,
    stream: true,
    stream_options: { include_usage: true },
  });

  let reply = "";
  let usage: CompletionUsage | undefined;

  for await (const chunk of chunks) {
    reply += chunk.choices[0]?.delta.content ?? "";
    onReply(reply);
    if (chunk.usage) usage = chunk.usage;
  }

  return { reply, cited: citedPassages(reply, passages), usage };
}
