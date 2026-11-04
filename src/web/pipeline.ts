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
// - embedQuery: WebLLM in the browser since stage 10 (transformers.js in
//               stage 9, Ollama before)
// - search:     inside the browser since stage 9 (was server.ts + pgvector)
// - answer:     WebLLM in the browser since stage 10 (was Ollama)

// Same k as rag-eval.ts, where this prompt scored 42/48 with llama3.2:1b.
const K = 5;

// Stage 10, step 1: the answer comes from WebLLM in the browser (was
// Ollama). Same model as rag-eval.ts in Node (llama3.2:1b), WebLLM's 4-bit
// build: ~695 MB download, ~879 MB GPU memory (stage 8).
export const CHAT_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

// Stage 10, step 3: the query embedder runs in the same WebLLM engine as the
// chat model. transformers.js + onnxruntime next to WebLLM went over the
// iPhone's ~1.4 GB per-tab limit (PLAN.md stage 10). Same model as the
// exported vectors (snowflake-arctic-embed:33m in Ollama), WebLLM's build
// with batch size 4: ~239 MB GPU memory.
const EMBED_MODEL = "snowflake-arctic-embed-s-q0f32-MLC-b4";

let engine: Promise<MLCEngine> | undefined;

// Loads both models once into one engine; later calls reuse it (same reason
// as openStore). The weights are cached by WebLLM (Cache API) after the
// first download.
export function loadModels(onProgress?: (report: InitProgressReport) => void) {
  engine ??= CreateMLCEngine([CHAT_MODEL, EMBED_MODEL], {
    initProgressCallback: onProgress,
  });

  return engine;
}

// Same prefix as eval/search-eval.ts: arctic prefixes queries only.
const QUERY_PREFIX =
  "Represent this sentence for searching relevant passages: ";

// WebLLM returns the CLS vector without normalizing it (Ollama does). Not
// needed here: Hamming only looks at signs, and the rescore ranks rows by dot
// product with the query, so the query's length doesn't change the order.
export async function embedQuery(question: string): Promise<number[]> {
  const models = await loadModels();

  // With two models in the engine, every request must say which one.
  const { data } = await models.embeddings.create({
    input: `${QUERY_PREFIX}${question}`,
    model: EMBED_MODEL,
  });

  const vector = data[0]?.embedding;
  if (!vector) throw new Error("No embedding returned");
  return vector;
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

// Same prompt as rag-eval.ts (rag.ts). Streams the reply: onReply gets the
// text so far after every chunk. The last chunk carries WebLLM's usage
// (prefill / decode tok/s, time to first token), like in spike.ts (stage 8).
// No enable_thinking: Llama 3.2 doesn't think (see stage 8).
export async function answer(
  question: string,
  passages: Passage[],
  onReply: (reply: string) => void,
) {
  const models = await loadModels();

  const chunks = await models.chat.completions.create({
    model: CHAT_MODEL,
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
