import type pg from "pg";
import type { Passage } from "./rag.ts";

// The top k chunks for a query vector, closest first, with pgvector. Used by
// rag-eval.ts and by search-eval.ts as the reference for the browser search.
// The vector must come from "search_query: <question>" (nomic-embed-text).
// <=> is cosine distance. ORDER BY distance ASC + LIMIT is the shape the HNSW
// index can serve (ef_search is set in db.ts).
export async function search(db: pg.Client, vector: number[], k: number) {
  const { rows } = await db.query<Passage>(
    `SELECT a.title, a.url, c.content
     FROM chunks c
     JOIN articles a ON a.id = c.article_id
     WHERE c.embedding_nomic IS NOT NULL
     ORDER BY c.embedding_nomic <=> $1::vector
     LIMIT $2`,
    [JSON.stringify(vector), k],
  );

  return rows;
}
