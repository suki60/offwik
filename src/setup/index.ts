import { connect } from "../db.ts";

// Setup step 4: build the HNSW index on chunks.embedding_nomic, once all rows
// are embedded (one build over the full table is much faster than updating
// the index row by row). Skipped when the index exists. To rebuild:
//   docker compose exec db psql -U wiki -c "DROP INDEX chunks_embedding_nomic_idx"
// Expect ~1,448 MB and a few minutes.
// Usage: npm run index

// The graph is built in memory: past maintenance_work_mem pgvector continues
// on disk, much slower. Parallel builds use shared memory (/dev/shm), which
// compose.yaml sets to 2 GB, so stay below that.
const MEMORY = "1500MB";

// m: neighbours per node (16, pgvector's default). ef_construction:
// candidates considered when picking them (128 instead of 64 gave results
// closer to exact search, stage 6).
const M = 16;
const EF_CONSTRUCTION = 128;

const db = await connect();

// to_regclass() returns NULL when no index has that name.
const { rowCount } = await db.query(
  "SELECT 1 WHERE to_regclass('chunks_embedding_nomic_idx') IS NOT NULL",
);

if (rowCount) {
  console.log("Index chunks_embedding_nomic_idx already exists.");
  await db.end();
  process.exit(0);
}

// Postgres NOTICEs (e.g. "continuing on disk") arrive as events.
db.on("notice", (notice) => console.log(`NOTICE: ${notice.message}`));

// SET doesn't take bind parameters; set_config() is the same as a function.
await db.query("SELECT set_config('maintenance_work_mem', $1, false)", [
  MEMORY,
]);

// The leader plus up to 7 workers (max_worker_processes is 8).
await db.query("SET max_parallel_maintenance_workers = 7");
console.log(`Building HNSW index (m ${M}, ef_construction ${EF_CONSTRUCTION})`);
const start = performance.now();

// vector_cosine_ops: the index serves <=> (cosine distance).
await db.query(`
  CREATE INDEX chunks_embedding_nomic_idx ON chunks
  USING hnsw (embedding_nomic vector_cosine_ops)
  WITH (m = ${M}, ef_construction = ${EF_CONSTRUCTION})
`);

const seconds = (performance.now() - start) / 1000;

const { rows } = await db.query(
  "SELECT pg_size_pretty(pg_relation_size('chunks_embedding_nomic_idx')) AS size",
);

console.log(`Index built in ${seconds.toFixed(1)} s, ${rows[0].size}`);
await db.end();
