import {
  type CompletionUsage,
  CreateMLCEngine,
  type InitProgressReport,
  type MLCEngine,
} from "@mlc-ai/web-llm";
import { buildMessages, citedPassages, type Passage } from "../rag.ts";
import { hammingTopN, rescore, toBits } from "../vector-search.ts";
import { openStore } from "./store.ts";

// The three steps of a RAG answer, all in the browser:
// embedQuery (WebLLM) → search (OPFS files) → answer (WebLLM).

const K = 5;

// Both models run in one WebLLM engine: two runtimes (transformers.js +
// WebLLM) went over the iPhone's per-tab memory limit (PLAN.md, stage 10).
// - Chat: same model as rag-eval.ts (llama3.2:1b), ~879 MB GPU memory.
// - Embedder: same model as the exported vectors, ~239 MB.
export const CHAT_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
const EMBED_MODEL = "snowflake-arctic-embed-s-q0f32-MLC-b4";

let engine: Promise<MLCEngine> | undefined;

// Loads both models once; WebLLM caches the weights after the first download.
export function loadModels(onProgress?: (report: InitProgressReport) => void) {
  engine ??= CreateMLCEngine([CHAT_MODEL, EMBED_MODEL], {
    initProgressCallback: onProgress,
  });

  return engine;
}

// Arctic prefixes queries only (same as eval/search-eval.ts). The vector
// comes back unnormalized; the ranking doesn't need it normalized.
export async function embedQuery(question: string) {
  const models = await loadModels();

  const { data } = await models.embeddings.create({
    input: `Represent this sentence for searching relevant passages: ${question}`,
    model: EMBED_MODEL,
  });

  return data[0].embedding;
}

// Hamming over all rows, int8 rescore of the best 200 (48/48 in
// search-eval.ts).
export async function search(vector: number[]) {
  const { bits, readRow, readRecord } = await openStore();
  const candidates = hammingTopN(bits, toBits(vector), 200);
  const top = await rescore(candidates, readRow, vector, K);
  return Promise.all(top.map(readRecord));
}

// Streams the reply: onReply gets the text so far after every chunk. The
// last chunk carries WebLLM's usage (time to first token, tokens/s).
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
