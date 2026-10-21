import { embed, generateText } from "ai";
import pg from "pg";
import { chatModel, config, embedModel } from "./config.ts";

// Smoke test for stage 0: Postgres + pgvector, the chat model and the embedding model.

const client = new pg.Client({ connectionString: config.databaseUrl });
await client.connect();
await client.query("CREATE EXTENSION IF NOT EXISTS vector");
const { rows } = await client.query(
  "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
);
const version = await client.query("SHOW server_version");
console.log(
  `Postgres ${version.rows[0].server_version}, pgvector ${rows[0].extversion}`,
);
await client.end();

let start = performance.now();
const { text } = await generateText({
  model: chatModel,
  prompt: "Reply with one word: what is the capital of France?",
});
console.log(
  `Chat (${config.chatModelName}): ${JSON.stringify(text.trim())} in ${Math.round(performance.now() - start)} ms`,
);

start = performance.now();
const { embedding } = await embed({
  model: embedModel,
  value: "search_query: What is the capital of France?",
});
const length = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0));
console.log(
  `Embedding (${config.embedModelName}): ${embedding.length} dims, length ${length.toFixed(4)}, in ${Math.round(performance.now() - start)} ms`,
);
if (embedding.length !== config.embedDimensions) {
  throw new Error(`Expected ${config.embedDimensions} dimensions`);
}
