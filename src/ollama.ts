import type { Message } from "./rag.ts";

// Ollama's OpenAI-compatible API: embed() for setup/embed.ts and the evals,
// chat() for rag-eval.ts.
const OLLAMA_URL = "http://localhost:11434/v1";

// Chat model, the same one the phone runs in WebLLM. CHAT_MODEL compares
// another one, e.g. CHAT_MODEL=qwen3.5:9b npm run rag-eval
export const CHAT_MODEL = process.env.CHAT_MODEL ?? "llama3.2:1b";

async function post<T>(path: string, body: object): Promise<T> {
  const response = await fetch(`${OLLAMA_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // fetch only rejects on network errors: HTTP errors are checked by hand.
  if (!response.ok) {
    throw new Error(`Ollama ${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as T;
}

// One request for the whole batch: `input` takes an array of strings.
export async function embed(
  texts: string[],
  model = "nomic-embed-text",
): Promise<number[][]> {
  const { data } = await post<{ data: { embedding: number[] }[] }>(
    "/embeddings",
    { model, input: texts },
  );

  return data.map((item) => item.embedding);
}

export async function chat(messages: Message[]): Promise<string> {
  const { choices } = await post<{
    choices: { message: { content: string } }[];
  }>("/chat/completions", {
    model: CHAT_MODEL,
    messages,
    // qwen3.5 thinks before answering by default; "none" turns it off.
    reasoning_effort: "none",
    // Same question, same answer: makes reruns comparable.
    temperature: 0,
  });

  return choices[0].message.content;
}
