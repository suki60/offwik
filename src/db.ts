import pg from "pg";

// count(*) returns bigint, which pg gives back as a string by default (a JS
// number is only exact up to 2^53). Our counts are far below that.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

// hnsw.ef_search is a per-connection setting (default 40), so it's set when
// each connection starts. 1000, pgvector's maximum: HNSW then finds 95% of
// what exact search finds (stage 6).
export async function connect() {
  const client = new pg.Client({
    connectionString: "postgres://wiki:wiki@localhost:5432/wiki",
    options: "-c hnsw.ef_search=1000",
  });

  await client.connect();
  return client;
}
