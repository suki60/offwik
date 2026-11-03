import { z } from "zod";
import { buildMessages, citedPassages, type Passage } from "../rag.ts";
import { hammingTopN, rescore, toBits } from "../vector-search.ts";
import { openStore } from "./store.ts";

// Stage 7, step 4: the three steps of a RAG answer in the browser, each behind
// its own function so later stages can swap one without touching the UI:
// - embedQuery: Ollama now, transformers.js in stage 9
// - search:     inside the browser since stage 9 (was server.ts + pgvector)
// - answer:     Ollama now, WebLLM / transformers.js in stage 8
// Relative URLs: vite.config.ts proxies /ollama to Ollama.

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

const EmbeddingsResponse = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()) })),
});

// Same model and prefix as the stored vectors were compared with in
// rag-eval.ts: queries get "search_query: ".
export async function embedQuery(question: string) {
  const { data } = EmbeddingsResponse.parse(
    await postJson("/ollama/v1/embeddings", {
      model: "nomic-embed-text",
      input: `search_query: ${question}`,
    }),
  );

  const embedding = data[0]?.embedding;
  if (!embedding) throw new Error("Ollama returned no embedding");
  return embedding;
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
