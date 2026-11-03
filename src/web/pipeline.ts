import {
  type FeatureExtractionPipeline,
  type ProgressInfo,
  pipeline,
} from "@huggingface/transformers";
import { z } from "zod";
import { buildMessages, citedPassages, type Passage } from "../rag.ts";
import { hammingTopN, rescore, toBits } from "../vector-search.ts";
import { openStore } from "./store.ts";

// Stage 7, step 4: the three steps of a RAG answer in the browser, each behind
// its own function so later stages can swap one without touching the UI:
// - embedQuery: transformers.js in the browser since stage 9 (was Ollama)
// - search:     inside the browser since stage 9 (was server.ts + pgvector)
// - answer:     Ollama now, WebLLM in stage 10
// Relative URL: vite.config.ts proxies /ollama to Ollama.

export const MODELS = ["llama3.2:1b", "qwen3.5:0.8b", "qwen3.5:9b"];

// Same k as rag-eval.ts, where this prompt scored 37/48 (0.8b) and 46/48 (9b).
const K = 5;

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // fetch only rejects on network errors: HTTP errors have to be checked by hand.
  if (!response.ok) {
    throw new Error(`${url} ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

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

const ChatResponse = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })),
});

// Same request as chat() in ollama.ts, with the prompt from rag.ts.
export async function answer(
  question: string,
  passages: Passage[],
  model: string,
) {
  const { choices } = ChatResponse.parse(
    await postJson("/ollama/v1/chat/completions", {
      model,
      messages: buildMessages(question, passages),
      reasoning_effort: "none",
      temperature: 0,
    }),
  );

  const reply = choices[0]?.message.content ?? "";
  return { reply, cited: citedPassages(reply, passages) };
}
