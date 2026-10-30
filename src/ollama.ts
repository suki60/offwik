import { z } from "zod";

// embed() is shared by embed.ts (documents), search.ts and eval.ts (queries).
// chat() is used by closed-book.ts and generate-questions.ts.

const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434/v1";

// Response of the OpenAI-compatible /embeddings endpoint (only the fields we use).
// `index` says which input each vector belongs to.
const EmbeddingsResponse = z.object({
  data: z.array(
    z.object({ index: z.number().int(), embedding: z.array(z.number()) }),
  ),
});

// One HTTP request for the whole batch: `input` takes an array of strings.
export async function embed(texts: string[]): Promise<number[][]> {
  const response = await fetch(`${ollamaUrl}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "nomic-embed-text", input: texts }),
  });

  // fetch only rejects on network errors: HTTP errors have to be checked by hand.
  if (!response.ok) {
    throw new Error(`Ollama ${response.status}: ${await response.text()}`);
  }

  const { data } = EmbeddingsResponse.parse(await response.json());

  // Sort by index instead of trusting the order of the array.
  return data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
}

// Response of the OpenAI-compatible /chat/completions endpoint (only the
// fields we use).
const ChatResponse = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })),
});

type Message = { role: "system" | "user" | "assistant"; content: string };

// model: defaults to the phone model. CHAT_MODEL picks another one to
// compare, e.g. CHAT_MODEL=qwen3.5:9b npm run closed-book
// json: Ollama forces the reply to be valid JSON (checked against Ollama).
type ChatOptions = { model?: string; json?: boolean };

export async function chat(
  messages: Message[],
  { model, json = false }: ChatOptions = {},
): Promise<string> {
  const response = await fetch(`${ollamaUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model ?? process.env.CHAT_MODEL ?? "qwen3.5:0.8b",
      messages,
      response_format: json ? { type: "json_object" } : undefined,
      // qwen3.5 thinks before answering by default (a long `reasoning` field).
      // "none" turns that off: checked against Ollama, the reply comes back
      // without `reasoning`.
      reasoning_effort: "none",
      // Same question, same answer: makes reruns comparable.
      temperature: 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama ${response.status}: ${await response.text()}`);
  }

  const { choices } = ChatResponse.parse(await response.json());
  return choices[0]?.message.content ?? "";
}
