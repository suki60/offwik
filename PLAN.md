# Wikipedia RAG: learning RAG at scale

A TypeScript project to practise RAG on a big dataset: an agent that answers questions from an offline copy of Wikipedia, using local models. Follow-up to `agent-fundamentals-2`, where RAG was built on a 9-chunk fictional handbook. I am a frontend engineer (8 years) preparing for AI engineer interviews. Explain the "why" briefly as you go.

## Goals
- See where brute-force vector search stops being fast enough, and what HNSW changes (latency, recall).
- Build an ingestion pipeline that survives hours of work: batching, bulk loading, resuming after a crash.
- Measure retrieval with recall@k instead of judging answers by eye.
- Show the value of RAG on facts the model does not know: niche articles, closed-book vs. RAG.

## Constraints
- Node.js + TypeScript only (no Python), run with `tsx`. Biome, 2-space indentation. Zod 4 for validation. The web app (stages 7-10) needs a browser bundler/dev server: choose and check it in stage 7.
- Models are local, through Ollama's OpenAI-compatible API (`http://localhost:11434/v1`). Chat: `qwen3.5:0.8b` (decided in stage 6: the agent should eventually run on an iPhone; `qwen3.5:9b` stays as a comparison via `CHAT_MODEL`). On the phone (stages 8-10) models run in the browser instead (WebLLM / transformers.js), possibly a different small Qwen if no web build of `qwen3.5:0.8b` exists. Embeddings: `nomic-embed-text` (768 dimensions, needs `search_document: ` / `search_query: ` prefixes).
- Postgres + pgvector in Docker (`pgvector/pgvector:pg17`), plain `pg` client, raw SQL (no ORM).
- Dataset: Hugging Face `wikimedia/wikipedia` (Parquet files, `title` + `text` per article). Start with the `simple` (Simple English) config; grow only after each step works.
- Wikipedia text is CC BY-SA: answers must cite the article (title + URL).

## How to work with me
- One stage at a time. Keep each stage small and runnable, and stop after it so I can run it. Do not implement stages ahead of the current one.
- Make every step as simple as possible. Plain, readable code, no abstractions I haven't asked for.
- Each stage keeps only what it uses: delete experiment files, npm scripts and dependencies the current stage does not run (e.g. `check.ts` is not needed in stage 1). They stay in git history; bring them back when a stage needs them. Exception: the data pipeline (`src/setup/`, `npm run setup`) always stays, so a fresh clone can rebuild the database from the official Parquet file (see README.md).
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
Goal since stage 6: the agent running offline on my iPhone, as a **PWA** (web app added to the Home Screen; chosen over Expo / React Native to avoid Xcode and native builds). Stages 7-10 build towards it; the old hybrid search and scale-up stages moved to the end, optional.

7. **RAG web app on the Mac.** Small web app (chat UI in the browser) on top of the existing pipeline: retrieve, then answer. Always search first (top k chunks, `ef_search` 1000), then the chat model answers only from those passages and cites `[Title](url)`. No tool calling yet: a 0.8B model is unreliable at deciding when to call tools. Keep the pieces swappable (embed, search, chat) so stages 8-10 can replace them with in-browser versions. Eval: the 48 gold questions with retrieval, graded like closed-book: closed-book 0/48 vs. RAG ?/48 for `qwen3.5:0.8b`, `qwen3.5:9b` for comparison.
8. **Phone spike: a model in Safari.** One web page that loads a small Qwen (0.6-0.8B) with WebLLM or transformers.js on WebGPU and chats, opened on my iPhone (served over HTTPS). Answers the risky questions first: does WebGPU work on my iOS version, is there a web build (WebLLM/ONNX) of the model (Ollama's GGUF doesn't run in browsers), how fast is it, does it fit in Safari's memory. If it fails, fall back to Expo / React Native.
9. **In-browser retrieval on the Mac.** Query embeddings with transformers.js (`nomic-embed-text` ONNX, same prefixes, must match the stored vectors), chunks + vectors exported from Postgres into a file the browser loads (OPFS / IndexedDB). Shrink the data first: a subset and/or compressed vectors (int8, or binary + re-ranking): full Simple English is ~270 MB of text + ~1.1 GB of float32 vectors. Search: brute force in JS/WASM or `sqlite-vec` (WASM). Re-run the eval in the browser and compare recall with pgvector.
10. **Offline PWA on the iPhone.** Stages 7-9 together: service worker, model + data cached on the device, answers with citations without network. Measure on the phone: load time, latency per answer, storage used, RAG accuracy on the gold questions.
11. **Optional: hybrid search.** Full-text search (`tsvector` + GIN in Postgres, or an in-browser equivalent) next to vectors, merged with Reciprocal Rank Fusion. Measure on the eval set, especially names, numbers and dates.
12. **Optional: scale up.** Towards 1M+ chunks or full English Wikipedia: `halfvec` to halve storage, build time and memory, index size. Only if the earlier stages are solid.

## Status
- Stage 0 done (2026-10-21): scaffold, `compose.yaml` (Postgres on host port 5432), `src/config.ts`. `npm run check` verified Postgres 17.11 + pgvector 0.8.7, `qwen3.5:9b` and `nomic-embed-text`.
- Stage 1 done (2026-10-21): `npm run download` (curl, 157 MB, sha256 matches the LFS oid), `npm run explore` (DuckDB, <1 s). Removed `check.ts`, `config.ts` and the `ai`, `@ai-sdk/openai-compatible`, `zod`, `pg`, `@types/pg` packages (unused in stage 1; see commit e9c0cde to restore them). 
- Stage 2 done (2026-10-22): `src/chunker.ts` (pure function), `npm run load` (DuckDB -> Zod -> chunker -> Postgres, recreates the tables each run), `npm run stats [-- "<title>"]`. Re-added `pg`, `@types/pg`, `zod`.
- Stage 3 done (2026-10-22): `npm run embed [-- <batch size>]` (plain `fetch` to `/v1/embeddings` + Zod, batch 64, no retries, one transaction per batch, resumes from `WHERE embedding IS NULL`). Measured: 10k articles -> 15,351 chunks, ~125 chunks/s (123 s total); full Simple English ~371k chunks, ~0.8 h estimated. Verified: interrupting with SIGINT after 896 of 3,000 left exactly 2,104 to do, the rerun finished them; vectors have norm 1.0. Removed `src/explore.ts`, `src/stats.ts` and the `stats` script (see commit 033c2da to restore them). Stage 4 is next.
- Stages 4-5: not recorded here (see commits 1bad9cd and 5568c0c). The database now holds the full Simple English subset: 238,243 articles, 370,859 chunks, all embedded.
- Stage 6 done (2026-10-30): single database (`db2` removed, `db` back on host port 5432). `npm run closed-book`, `npm run generate-questions [-- <count>]`, `npm run eval`; `npm run index` takes `<maintenance_work_mem> <m> <ef_construction>`; `npm run search` defaults to `ef_search` 1000. Numbers and decisions in "Evals (stage 6)".
- Stage 7 done (2026-10-30): web app works in the browser on the Mac (`npm run server` + `npm run dev`). Stage 8 (phone spike) is next. `src/rag.ts` (prompt with a few-shot turn, cites passages as `[n]`), `npm run rag-eval` (results in "RAG eval (stage 7)"), `npm run server` (`POST /api/search {vector, k}` on port 3000, `src/search.ts` shared with rag-eval). `hnsw.ef_search` 1000 is set for every connection in `db.ts` (`options: "-c hnsw.ef_search=1000"`, checked with `SHOW`). Web app: Vite 8.3.5 + React 19.3 (`npm run dev`, proxies `/ollama` → Ollama and `/api` → server.ts, so no CORS), `src/web/pipeline.ts` holds the swappable `embedQuery` / `search` / `answer`, model dropdown (0.8b / 9b). Two tsconfigs: `tsconfig.json` (Node, excludes `src/web`) and `tsconfig.web.json` (DOM + JSX, no Node types); one config with both DOM and Node types broke `download.ts` (`ReadableStream` clash). Folders: `src/setup/` (data pipeline), `src/eval/`. `npm run setup` = download (pinned revision + sha256 check) → load (all articles) → embed → index (1500MB, m 16, ef_construction 128), every step skips work already done. Removed: `search.ts`, `eval.ts`, `closed-book.ts`, `generate-questions.ts`, `synthetic-questions.json`, `chat()`'s `model`/`json` options, the args of `load`/`index` (see commit 06c8906 to restore them).

## RAG eval (stage 7)
- `npm run rag-eval`: the 48 gold questions, top 5 chunks (HNSW, ef_search 1000) → chat model → graded like closed-book (expected answer as a whole word), plus "retrieved" (expected article in the top 5) and "cited" (reply cites it as `[n]`).
- Prompt iterations, `qwen3.5:0.8b` correct / cited: rule only ("cite like [2]") 19 / 43 (23 replies were just "[1]"); example reply inside the rule 36 / 34 (6 replies copied the example word for word); few-shot user/assistant turn with made-up passages 37 / 38, no copies. `qwen3.5:9b`: 46 / 45-46 with every prompt.
- Ceiling: retrieval finds 46/48; the 2 misses (Mackwiller, Fikret Otyam) get "I don't know" (once the 0.8B invented an answer from another passage). The 9b answers every retrieved question. The 0.8b's remaining 9 errors are reading mistakes (wrong sentence, wrong passage, refusing although the answer is there): model size, not prompt. Stopped tuning there to avoid fitting the prompt to 48 questions.
- Untested idea: k = 3 (fewer distractor passages for the 0.8B).
- Thinking (`reasoning_effort` low/high) dropped: `qwen3.5:0.8b` spent 1-2k tokens even on "17*3" and loops at temperature 0 (rag-eval never finished). If revisited: temperature 0.6 / top_p 0.95 (Qwen's recommendation, from memory) + a `max_tokens` cap.

## Evals (stage 6)
- Two question sets, each with the expected article title. Gold: `src/questions.ts`, 48 hand-written questions about niche short articles (300-1,500 chars), every title and answer checked against the data. Synthetic: `src/synthetic-questions.json`, 300 questions written by `qwen3.5:9b` from random chunks (v2 prompt: gets the title, must name the subject; years, dates and "Deaths in …" pages skipped).
- Closed book (no retrieval): `qwen3.5:9b` 7/48 right, `qwen3.5:0.8b` 0/48 (it even said Sydney is Australia's capital). All 48 stay in the gold set. `reasoning_effort: "none"` turns off qwen3.5's thinking (checked on both models).
- Metric: article-level recall@k (any chunk of the expected article in the top k), with a 95% range. 48 questions ≈ ±0.07, 300 ≈ ±0.02-0.04: differences smaller than that are noise.
- Exact search: gold recall@1 0.92, @5 1.00; synthetic recall@1 0.91, @10 0.98. Embeddings + generic chunking are good enough; no chunking rule added back.
- HNSW (`m` 16, `ef_construction` 128), "of exact" = share of the articles exact search finds that HNSW finds too (synthetic / gold): ef_search 40 (default) 0.68 / 0.81 at ~2 ms, 200 0.85 / 0.94, 1000 0.95 / 0.96 at ~18 ms; exact ~400 ms. Decision: `ef_search` 1000 (pgvector's maximum, checked).
- Chunk overlap with exact ("chunks found") looks better than article recall (0.82 vs 0.68 at ef 40): HNSW disproportionately misses the relevant chunk. Hypothesis, not verified: query vectors (`search_query:`) sit apart from document vectors, which hurts the graph walk.
- `ef_construction` 64 -> 128 improved chunk overlap (ef 200: 0.965 -> 0.988), article recall moved within noise. Index size unchanged (1,448 MB); `m` was not raised (bigger index, bad for the phone).
- Label noise: ~2% of the synthetic set (5/300 clearly broken, e.g. "Which team won the league in 1992?"). Kept on purpose: removing only the questions search fails on would bias the eval.
- Latency gotchas: `shared_buffers` is 128 MB and the index 1.4 GB, so cold queries fetch pages from outside Postgres (measured: 51 ms cold vs 2.6 ms warm, same query). The planner does not change plans with ef_search (checked with `EXPLAIN`). `hnsw.ef_search` is per connection: every new connection falls back to 40 without any error. Fixed in stage 7 by setting it in the connection config (`db.ts`), which covers `pg.Pool` connections too. `index.ts` needs ~1.5 GB `maintenance_work_mem` for this index (768 MB overflowed after 213k vectors). A Ctrl+C'd `CREATE INDEX` keeps running on the server: a rerun then fails with "duplicate key … pg_class_relname_nsp_index".
- For stage 7 (answer quality): Ragas and DeepEval are Python. TypeScript options to check: promptfoo, Evalite, autoevals (Braintrust).

## Chunking (stage 2)
- Kept deliberately generic, no Wikipedia-specific rules: split at blank lines, pack paragraphs up to 1,200 chars, hard-cut anything longer, prefix each chunk with the title (`Title\n\n<text>`, what stage 3 embeds). Subset filter: only `(disambiguation)` titles and `List of` pages.
- Accepted noise: references, categories and table leftovers get embedded; chunks can span topics. Stage 6 evals decide whether any rule is worth adding back: none needed (exact recall@10 0.98-1.00).
- A first, Wikipedia-specific version (heading detection, sections, category/table removal, extra disambiguation regexes) was dropped as too complex. It found: wiki-table lines (`|-`, `||`), date pages starting with a blank line, ~970 extra disambiguation pages ("X could mean:", "may be about:").
- Numbers for the generic version: not measured yet (`npm run stats` removed in stage 3; restore from commit 033c2da).

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
- Node 24.22, npm 11.19 (blocks install scripts by default; tsx works without esbuild's postinstall), Docker 29.8. Re-checked 2026-10-30: Node 26.13, npm 11.20; `fsevents`' install script is blocked too, Vite works without it.
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
