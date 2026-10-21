import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";

// Every setting can be overridden with an env var; the defaults match compose.yaml and Ollama.
const env = z
  .object({
    OLLAMA_URL: z.url().default("http://localhost:11434/v1"),
    CHAT_MODEL: z.string().default("qwen3.5:9b"),
    EMBED_MODEL: z.string().default("nomic-embed-text"),
    DATABASE_URL: z
      .string()
      .default("postgres://wiki:wiki@localhost:5432/wiki"),
  })
  .parse(process.env);

export const config = {
  ollamaUrl: env.OLLAMA_URL,
  chatModelName: env.CHAT_MODEL,
  embedModelName: env.EMBED_MODEL,
  databaseUrl: env.DATABASE_URL,
  embedDimensions: 768,
};

const ollama = createOpenAICompatible({
  name: "ollama",
  baseURL: config.ollamaUrl,
});

export const chatModel = ollama.chatModel(config.chatModelName);
export const embedModel = ollama.textEmbeddingModel(config.embedModelName);
