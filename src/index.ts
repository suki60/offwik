import { connect } from "./db.ts";

// Stage 5: build the HNSW index on chunks.embedding, after all rows are loaded.
// Building once over the full table is much faster than keeping the index up
// to date during thousands of inserts/updates. Drops and rebuilds each run.
// Usage: npm run index [-- <maintenance_work_mem> <m> <ef_construction>]
//        (defaults 768MB 16 64; 16 and 64 are pgvector's defaults)

// The graph is built in memory: if it outgrows maintenance_work_mem, pgvector
// prints a NOTICE and continues on disk, much slower. A parallel build keeps
// the graph in shared memory (/dev/shm), which compose.yaml sets to 2 GB, so
// stay below that.
const memory = process.argv[2] ?? "768MB";

// Stage 6: m is how many neighbours each node keeps in the graph (more =
// bigger index, better recall). ef_construction is how many candidates are
// considered when picking those neighbours (more = slower build, better
// graph, same index size).
const m = Number(process.argv[3] ?? 16);
const efConstruction = Number(process.argv[4] ?? 64);

const db = await connect();

// NOTICEs from Postgres (e.g. the one above) arrive as events, not errors.
db.on("notice", (notice) => console.log(`NOTICE: ${notice.message}`));

// SET doesn't take bind parameters: set_config() is the same thing as a function.
// false = for the whole session, not only the current transaction.
await db.query("SELECT set_config('maintenance_work_mem', $1, false)", [
  memory,
]);

// The leader plus up to 7 workers (max_worker_processes is 8).
await db.query("SET max_parallel_maintenance_workers = 7");
await db.query("DROP INDEX IF EXISTS chunks_embedding_idx");

console.log(
  `Building HNSW index (m ${m}, ef_construction ${efConstruction}, maintenance_work_mem ${memory})...`,
);

const start = performance.now();

// vector_cosine_ops: the index serves `<=>` (cosine distance), the operator
// search.ts orders by. WITH (...) doesn't take bind parameters either: m and
// efConstruction come from Number(), so putting them in the SQL is safe.
await db.query(`
  CREATE INDEX chunks_embedding_idx ON chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = ${m}, ef_construction = ${efConstruction})
`);

const seconds = (performance.now() - start) / 1000;

const { rows } = await db.query(`
  SELECT
    pg_size_pretty(pg_relation_size('chunks_embedding_idx')) AS index_size,
    pg_size_pretty(pg_table_size('chunks')) AS table_size,
    (SELECT count(*) FROM chunks WHERE embedding IS NOT NULL) AS vectors
`);

const { index_size, table_size, vectors } = rows[0];

console.log(
  `Indexed ${vectors} vectors in ${seconds.toFixed(1)} s (m ${m}, ef_construction ${efConstruction})`,
);

console.log(`  index ${index_size}, table (with TOAST) ${table_size}`);
await db.end();
