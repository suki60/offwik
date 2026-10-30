import { createServer } from "node:http";
import { json } from "node:stream/consumers";
import pg from "pg";
import { z } from "zod";
import { dbConfig } from "./db.ts";
import { search } from "./search.ts";

// Stage 7, step 3: the only part of the web app that can't run in the
// browser, because a browser can't talk to Postgres. It takes a query vector
// (the browser embeds the question itself, through Ollama) and returns the top
// k passages. Stage 9 replaces it with search inside the browser.
// Usage: npm run server

const PORT = 3000;

// A pool instead of one client: several requests can run at the same time,
// each on its own connection. ef_search is set for every connection in db.ts.
const pool = new pg.Pool(dbConfig);

// nomic-embed-text vectors have 768 numbers. k up to 20: the prompt is built
// for a handful of passages, not hundreds.
const SearchRequest = z.object({
  vector: z.array(z.number()).length(768),
  k: z.number().int().min(1).max(20).default(5),
});

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/api/search") {
    response.writeHead(404).end();
    return;
  }

  // Bad input is the caller's fault (400), anything else is ours (500).
  try {
    const { vector, k } = SearchRequest.parse(await json(request));
    const start = performance.now();
    const passages = await search(pool, vector, k);
    console.log(`search k=${k}: ${(performance.now() - start).toFixed(0)} ms`);

    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify(passages));
  } catch (error) {
    const isBadInput =
      error instanceof z.ZodError || error instanceof SyntaxError;
    console.error(error);
    response.writeHead(isBadInput ? 400 : 500).end(String(error));
  }
});

// Shows that the ef_search from db.ts reaches the connections.
const { rows } = await pool.query("SHOW hnsw.ef_search");
console.log(`hnsw.ef_search = ${rows[0]["hnsw.ef_search"]}`);

server.listen(PORT, () => {
  console.log(`Search API on http://localhost:${PORT}/api/search`);
});
