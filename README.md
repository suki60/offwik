# wiki-rag

RAG over an offline copy of Simple English Wikipedia, with local models (Ollama) and Postgres + pgvector. Goals, stages and measured numbers are in [PLAN.md](PLAN.md).

## Prerequisites

- Node 24, Docker, [Ollama](https://ollama.com)
- Models:
  ```
  ollama pull nomic-embed-text
  ollama pull snowflake-arctic-embed:33m
  ollama pull llama3.2:1b
  ollama pull qwen3.5:0.8b  # optional, for comparisons
  ollama pull qwen3.5:9b    # optional, for comparisons
  ```
- Port 5432 free (Postgres runs there).

## Set up the data

```
npm install
docker compose up -d
npm run setup
```

`npm run setup` runs five steps. Each one can be rerun on its own, and rerunning skips work already done, so after a crash just run `npm run setup` again.

| Step | What it does | Expect |
| --- | --- | --- |
| `npm run download` | Downloads the Parquet dump (pinned revision) to `data/`, checks its sha256 | 157 MB, "sha256 matches" |
| `npm run load` | Chunks every article into the `articles` + `chunks` tables | 238,243 articles, 370,859 chunks |
| `npm run embed` | Embeds every chunk with `nomic-embed-text`, then `snowflake-arctic-embed:33m` (resumable) | ~50 min at ~125 chunks/s (nomic) + arctic (not measured yet) |
| `npm run index` | Builds the HNSW index (m 16, ef_construction 128) | ~1,448 MB, a few minutes |
| `npm run export` | Writes chunks + binary/int8 vectors to `public/data/` for the web app | 4 files, 449.3 MB |

To start over from scratch: `docker compose down -v` (deletes the database volume), then `docker compose up -d` and `npm run setup`.

## Run

```
npm run rag-eval                          # 48 gold questions with retrieval
CHAT_MODEL=qwen3.5:9b npm run rag-eval    # same, another model
npm run search-eval [-- <candidates>]     # file search vs pgvector, recall@5
npm run dev                               # web app on :5173 (WebGPU browser)
```

The web app embeds and searches in the browser: on the first visit it copies `public/data/` into the browser's storage (OPFS) and downloads the embedding model (~275 MB) and the chat model (WebLLM, Llama 3.2 1B, ~695 MB). Nothing goes to Ollama. With `certs/` present it serves HTTPS, so the browser must trust the CA that signed `certs/cert.pem`.

## Layout

```
src/
  db.ts, ollama.ts   Postgres client, Ollama embed/chat
  rag.ts             RAG prompt + citations (shared with the web app)
  search.ts          top-k query (pgvector HNSW), the reference
  vector-search.ts   Hamming + int8 rescore over public/data (Node + browser)
  web/               React app: pipeline.ts (embed │ search │ answer), App.tsx,
                     store.ts (OPFS), search-eval.ts (in-browser eval)
  setup/             download → load (chunker) → embed → index → export
  eval/              gold questions, rag-eval, search-eval
```
