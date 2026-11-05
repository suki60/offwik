import type pg from "pg";
import type { Passage } from "./rag.ts";

// The top k chunks for a nomic query vector ("search_query: <question>"),
// closest first. <=> is cosine distance; ORDER BY it + LIMIT is the shape the
// HNSW index serves.
export async function search(db: pg.Client, vector: number[], k: number) {
  const { rows } = await db.query<Passage>(
    `SELECT a.title, a.url, c.content
     FROM chunks c
     JOIN articles a ON a.id = c.article_id
     ORDER BY c.embedding_nomic <=> $1::vector
     LIMIT $2`,
    [JSON.stringify(vector), k],
  );

  return rows;
}
