import pg from "pg";

// count(*) and sum() return bigint, which pg gives back as a string by default
// (a JS number is only exact up to 2^53). Our counts and ids are far below that.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

// Shared by connect() (scripts) and server.ts (pg.Pool).
// options: settings Postgres applies when each connection starts.
// hnsw.ef_search is per connection, and a new one silently falls back to 40.
// Setting it here covers every connection, pooled or not. 1000 is pgvector's
// maximum: HNSW finds 95% of the articles exact search finds (stage 6).
export const dbConfig = {
  connectionString: "postgres://wiki:wiki@localhost:5432/wiki",
  options: "-c hnsw.ef_search=1000",
};

export async function connect() {
  const client = new pg.Client(dbConfig);
  await client.connect();
  return client;
}
