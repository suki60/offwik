# wiki-rag

RAG over an offline copy of Simple English Wikipedia, with local models (Ollama) and Postgres + pgvector. Goals, stages and measured numbers are in [PLAN.md](PLAN.md).

## Prerequisites

- Node 24, Docker, [Ollama](https://ollama.com)
- Models:
  ```
  ollama pull nomic-embed-text
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

`npm run setup` runs four steps. Each one can be rerun on its own, and rerunning skips work already done, so after a crash just run `npm run setup` again.

| Step | What it does | Expect |
| --- | --- | --- |
| `npm run download` | Downloads the Parquet dump (pinned revision) to `data/`, checks its sha256 | 157 MB, "sha256 matches" |
| `npm run load` | Chunks every article into the `articles` + `chunks` tables | 238,243 articles, 370,859 chunks |
| `npm run embed` | Embeds every chunk with `nomic-embed-text` (resumable) | ~50 min at ~125 chunks/s |
| `npm run index` | Builds the HNSW index (m 16, ef_construction 128) | ~1,448 MB, a few minutes |

To start over from scratch: `docker compose down -v` (deletes the database volume), then `docker compose up -d` and `npm run setup`.

## Run

```
npm run rag-eval                          # 48 gold questions with retrieval
CHAT_MODEL=qwen3.5:9b npm run rag-eval    # same, another model
npm run server                            # search API on :3000
npm run dev                               # web app on :5173 (needs server)
```

## Layout

```
src/
  db.ts, ollama.ts   Postgres client, Ollama embed/chat
  rag.ts             RAG prompt + citations (shared with the web app)
  search.ts          top-k query (HNSW)
  server.ts          POST /api/search for the web app
  web/               React app: pipeline.ts (embed │ search │ answer), App.tsx
  setup/             download → load (chunker) → embed → index
  eval/              gold questions + rag-eval
```
