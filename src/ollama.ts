import { z } from "zod";

// Shared by embed.ts (documents) and search.ts (queries).

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
