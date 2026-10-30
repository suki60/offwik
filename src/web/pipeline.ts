import { z } from "zod";
import { buildMessages, citedPassages, type Passage } from "../rag.ts";

// Stage 7, step 4: the three steps of a RAG answer in the browser, each behind
// its own function so later stages can swap one without touching the UI:
// - embedQuery: Ollama now, transformers.js in stage 9
// - search:     server.ts + pgvector now, search inside the browser in stage 9
// - answer:     Ollama now, WebLLM / transformers.js in stage 8
// Relative URLs: vite.config.ts proxies /ollama to Ollama and /api to server.ts.

export const MODELS = ["qwen3.5:0.8b", "qwen3.5:9b"];

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

const Passages = z.array(
  z.object({ title: z.string(), url: z.string(), content: z.string() }),
);

export async function search(vector: number[]): Promise<Passage[]> {
  return Passages.parse(await postJson("/api/search", { vector, k: K }));
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
