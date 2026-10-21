# Wikipedia RAG: learning RAG at scale

A TypeScript project to practise RAG on a big dataset: an agent that answers questions from an offline copy of Wikipedia, using local models. Follow-up to `agent-fundamentals-2`, where RAG was built on a 9-chunk fictional handbook. I am a frontend engineer (8 years) preparing for AI engineer interviews. Explain the "why" briefly as you go.

## Goals
- See where brute-force vector search stops being fast enough, and what HNSW changes (latency, recall).
- Build an ingestion pipeline that survives hours of work: batching, bulk loading, resuming after a crash.
- Measure retrieval with recall@k instead of judging answers by eye.
- Show the value of RAG on facts the model does not know: niche articles, closed-book vs. RAG.

## Constraints
- Node.js + TypeScript only (no Python), run with `tsx`. Biome, 2-space indentation. Zod 4 for validation.
- Models are local, through Ollama's OpenAI-compatible API (`http://localhost:11434/v1`). Chat: `qwen3.5:9b`. Embeddings: `nomic-embed-text` (768 dimensions, needs `search_document: ` / `search_query: ` prefixes).
- Postgres + pgvector in Docker (`pgvector/pgvector:pg17`), plain `pg` client, raw SQL (no ORM).
- Dataset: Hugging Face `wikimedia/wikipedia` (Parquet files, `title` + `text` per article). Start with the `simple` (Simple English) config; grow only after each step works.
- Wikipedia text is CC BY-SA: answers must cite the article (title + URL).

## How to work with me
- One stage at a time. Keep each stage small and runnable, and stop after it so I can run it. Do not implement stages ahead of the current one.
- Make every step as simple as possible. Plain, readable code, no abstractions I haven't asked for.
- Each stage keeps only what it uses: delete files, npm scripts and dependencies the current stage does not run (e.g. `check.ts` is not needed in stage 1). They stay in git history; bring them back when a stage needs them.
- Before using any API, library or dataset path, check the **installed** version's types/docs or the real file listing instead of relying on memory.
- Test against my running Ollama and Postgres. Tell me what you verified and what you did not. Numbers from memory must be marked as such.
- After each stage give me 2-3 interview-style questions about what we built, and one experiment that breaks something on purpose.
- Git: one branch per stage. Do not run git commands that change the repo (my global `CLAUDE.md` forbids it); I create branches and commit myself. Read-only git is fine.
- Helper scripts are Node/TypeScript, not Python.

## Stages
0. **Setup.** Scaffold (`tsx`, TypeScript, Biome, Zod), `compose.yaml` with Postgres + pgvector, `src/config.ts`, check Ollama and both models answer.
1. **Get and explore the data.** Download the Simple English Parquet file(s) without Python (direct `curl` or `@huggingface/hub`). Explore with DuckDB (`@duckdb/node-api`) or `hyparquet`: number of articles, text length distribution, what the text looks like (headings, lists, leftovers). Decide the first working subset (e.g. 10k articles).
2. **Chunking.** Section-aware chunks with a `Title › Section` prefix in each chunk. Store chunks in Postgres **without** embeddings first (`articles` + `chunks` tables, `embedding` nullable). Print stats: chunks per article, chunk length distribution.
3. **Embedding pipeline.** Embed chunks in batches (`embedMany`), write vectors back, and make it resumable: a crash or Ctrl+C continues where it stopped (`WHERE embedding IS NULL`). Measure throughput (chunks/second) and estimate the time for the full dataset before running it.
4. **Exact search.** Search CLI with brute-force cosine search (no vector index). Measure latency at 10k, then 100k chunks. Learn bulk loading here if inserts are slow (multi-row `INSERT` or `COPY`).
5. **HNSW.** Build the index **after** loading (`maintenance_work_mem`), confirm with `EXPLAIN`, compare latency with exact search. Experiment with `ef_search`; `m` / `ef_construction` only if needed.
6. **Evals.** About 30-50 questions about niche articles (small towns, minor species, obscure people), each with its expected article title. Run every question closed-book first and keep the ones the model gets wrong. Metrics: recall@k at article level (did any chunk from the right article come back?), HNSW recall vs. exact search, `ef_search` sweep. Optional: reuse Natural Questions / HotpotQA labels (older dumps, match by title).
7. **Hybrid search.** Postgres full-text search (`tsvector` + GIN index) next to vectors, merged with Reciprocal Rank Fusion. Measure on the eval set, especially names, numbers and dates.
8. **Agent.** `search_wikipedia` tool for the AI SDK agent, answers only from retrieved passages, cites `[Title](url)`. Multi-turn chat UI with Ink.
9. **Optional: scale up.** Towards 1M+ chunks or full English Wikipedia: `halfvec` to halve storage, build time and memory, index size. Only if the earlier stages are solid.

## Status
- Stage 0 done (2026-10-21): scaffold, `compose.yaml` (Postgres on host port 5432), `src/config.ts`. `npm run check` verified Postgres 17.11 + pgvector 0.8.7, `qwen3.5:9b` and `nomic-embed-text`.
- Stage 1 done (2026-10-21): `npm run download` (curl, 157 MB, sha256 matches the LFS oid), `npm run explore` (DuckDB, <1 s). Removed `check.ts`, `config.ts` and the `ai`, `@ai-sdk/openai-compatible`, `zod`, `pg`, `@types/pg` packages (unused in stage 1; see commit e9c0cde to restore them). Stage 2 is next.

## Dataset facts (measured in stage 1)
- Only one dump in `wikimedia/wikipedia`: `20231101.simple/train-00000-of-00001.parquet`. Columns `id`, `url`, `title`, `text` (all VARCHAR). 241,787 articles, ids and titles unique, 267M chars (~67M tokens at 4 chars/token, estimate).
- Length: p10 141, p50 514, p90 2,069, p99 9,490, max 236,695 chars. 19% of articles are < 200 chars but hold 2% of the text; 0.3% are >= 20k chars and hold 13.5%.
- Plain text, wiki markup mostly stripped (templates/infoboxes gone, sometimes leaving broken sentences like "1984 (MCMLXXXIV) was ."). Leftovers in a few hundred articles: `{{`, `<ref`, `| ` table rows.
- Headings are not marked: a short line after a blank line, sometimes with a trailing space (`"\n\nHistory \nThe origin..."`). Most common: References, Other websites, Related pages, History.
- List items are lines starting with a space. Category names are appended at the end of each article as plain lines ("1987 births", "Communes in Aisne"); stubs often end with a repeat of the title.
- Boilerplate sections to drop or treat specially in stage 2: References, Other websites, Related pages, Notes, Gallery, Sources.
- URLs encode spaces as `%20` (`.../wiki/Lionel%20Messi`): use the `url` column as-is for citations.
- First subset: 10k articles, `ORDER BY hash(id) LIMIT 10000`, excluding disambiguation pages and `List of` pages. Taking 100k from the same order later gives a superset. (`hash()` is DuckDB's; not guaranteed stable across DuckDB versions.)

## Environment (re-checked 2026-10-21)
- Node 24.22, npm 11.19 (blocks install scripts by default; tsx works without esbuild's postinstall), Docker 29.8.
- Ollama 0.40.4 with `qwen3:4b`, `qwen3:14b`, `qwen3.5:9b`, `nomic-embed-text`.
- `pgvector/pgvector:pg17` image ships pgvector 0.8.7.
- Port 8080 is used by SearXNG (agent-fundamentals-2 compose). Postgres on 5432 is also used by agent-fundamentals-2: this project uses 5432 too, so stop that one before `docker compose up` here.

## Packages (check installed versions before using)
- Known to work together: `ai@^5` (pinned; latest on npm is 7) + `@ai-sdk/openai-compatible@^1`, `zod@4`, `pg@8` + `@types/pg`, `ink@6` + `react@19`, dev `typescript@7`, `tsx`, `@biomejs/biome`, `@types/node`.
- `@duckdb/node-api@1.5.6-r.2`: `DuckDBInstance.create()` -> `connect()` -> `runAndReadAll(sql)` -> `getRowObjectsJson()` (BIGINTs come back as strings). Native binary arrives as an optional dependency, no install script needed. `tsx -e` compiles to CJS (no top-level await): use a file.

## Unverified estimates (from memory, check them)
- Full English: about 6-7M articles, tens of millions of chunks.
- Local embedding speed: a few hundred chunks/second; full English would take days.
- Storage: ~3 KB per 768-dim `vector` (measured: 3,076 bytes), roughly doubled by an HNSW index.
- Models remember popular facts well and niche facts poorly (Kandpal et al. 2023, Mallen et al. 2023 "PopQA"), not checked.

## Carried over from agent-fundamentals-2 (verified there)
- AI SDK 5: `embed`, `embedMany`, `cosineSimilarity`; `ollama.textEmbeddingModel(name)` calls `/v1/embeddings`. `tool({ description, inputSchema, execute })`, `stopWhen: stepCountIs(n)`, `readUIMessageStream` for UI snapshots. Set `streamText({ onError })` or errors garble Ink.
- `nomic-embed-text` vectors come back normalized (length 1.0): cosine, dot product and L2 give the same ranking. Use cosine (`<=>`, `vector_cosine_ops`).
- Scores are relative: an unrelated query still scores ~0.56. No fixed threshold for "relevant".
- Exact identifiers (codes, names) are weak for embeddings: hybrid search fixes that.
- pgvector with plain `pg`: send vectors as text (`JSON.stringify`), cast with `$1::vector`. Vectors are stored out of line (TOAST, storage `external`, uncompressed).
- An HNSW index is only used for `ORDER BY embedding <=> $1` (ascending) + `LIMIT`; `ORDER BY score DESC` falls back to a full scan. With few rows the planner ignores the index anyway: check with `EXPLAIN`. `ef_search` (default 40) caps results per scan.
- Re-index in one transaction on one client (`pool.connect()`). `allowExitOnIdle: true` lets the Ink app exit.
- Pool defaults (pg-pool 3.14): max 10, min 0, idle timeout 10 s. Postgres `max_connections` = 100.
- Ink owns the terminal: no `console.log` from the agent loop.
