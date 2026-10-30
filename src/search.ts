import type pg from "pg";
import type { Passage } from "./rag.ts";

// The top k chunks for a query vector, closest first. Shared by rag-eval.ts
// (one pg.Client) and server.ts (a pg.Pool): both have the same query().
// The vector must come from "search_query: <question>" (nomic-embed-text).
// <=> is cosine distance. ORDER BY distance ASC + LIMIT is the shape the HNSW
// index can serve (ef_search is set in db.ts).
export async function search(
  db: pg.Client | pg.Pool,
  vector: number[],
  k: number,
) {
  const { rows } = await db.query<Passage>(
    `SELECT a.title, a.url, c.content
     FROM chunks c
     JOIN articles a ON a.id = c.article_id
     WHERE c.embedding IS NOT NULL
     ORDER BY c.embedding <=> $1::vector
     LIMIT $2`,
    [JSON.stringify(vector), k],
  );

  return rows;
}
