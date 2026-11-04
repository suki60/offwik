import { connect } from "../db.ts";

// Setup step 4: build the HNSW index on chunks.embedding_nomic, after all rows are
// embedded. Building once over the full table is much faster than keeping the
// index up to date during thousands of updates. Skips the build when the index
// already exists. To rebuild (e.g. with other settings), drop it by hand:
//   docker compose exec db psql -U wiki -c "DROP INDEX chunks_embedding_nomic_idx"
// Expect ~1,448 MB and a few minutes.
// Usage: npm run index

// The graph is built in memory: if it outgrows maintenance_work_mem, pgvector
// prints a NOTICE and continues on disk, much slower (768MB overflowed after
// 213k vectors in stage 6). A parallel build keeps the graph in shared memory
// (/dev/shm), which compose.yaml sets to 2 GB, so stay below that.
const MEMORY = "1500MB";

// Stage 6: m is how many neighbours each node keeps in the graph (more =
// bigger index, better recall; 16 is pgvector's default, kept small for the
// phone). ef_construction is how many candidates are considered when picking
// those neighbours (more = slower build, better graph, same index size):
// 128 instead of the default 64 improved chunk overlap with exact search.
const M = 16;
const EF_CONSTRUCTION = 128;

const db = await connect();

// to_regclass() returns NULL when no table/index has that name.
const { rowCount } = await db.query(
  "SELECT 1 WHERE to_regclass('chunks_embedding_nomic_idx') IS NOT NULL",
);

if (rowCount) {
  console.log(
    "Index chunks_embedding_nomic_idx already exists, nothing to do.",
  );
  await db.end();
  process.exit(0);
}

// NOTICEs from Postgres (e.g. the one above) arrive as events, not errors.
db.on("notice", (notice) => console.log(`NOTICE: ${notice.message}`));

// SET doesn't take bind parameters: set_config() is the same thing as a function.
// false = for the whole session, not only the current transaction.
await db.query("SELECT set_config('maintenance_work_mem', $1, false)", [
  MEMORY,
]);

// The leader plus up to 7 workers (max_worker_processes is 8).
await db.query("SET max_parallel_maintenance_workers = 7");

console.log(
  `Building HNSW index (m ${M}, ef_construction ${EF_CONSTRUCTION}, maintenance_work_mem ${MEMORY})...`,
);

const start = performance.now();

// vector_cosine_ops: the index serves `<=>` (cosine distance), the operator
// searches order by. WITH (...) doesn't take bind parameters either: M and
// EF_CONSTRUCTION are constants above.
await db.query(`
  CREATE INDEX chunks_embedding_nomic_idx ON chunks
  USING hnsw (embedding_nomic vector_cosine_ops)
  WITH (m = ${M}, ef_construction = ${EF_CONSTRUCTION})
`);

const seconds = (performance.now() - start) / 1000;

const { rows } = await db.query(`
  SELECT
    pg_size_pretty(pg_relation_size('chunks_embedding_nomic_idx')) AS index_size,
    (SELECT count(*) FROM chunks WHERE embedding_nomic IS NOT NULL) AS vectors
`);

const { index_size, vectors } = rows[0];
console.log(`Indexed ${vectors} vectors in ${seconds.toFixed(1)} s`);
console.log(`  index ${index_size}`);
await db.end();
