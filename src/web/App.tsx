import { type FormEvent, useEffect, useState } from "react";
import type { Passage } from "../rag.ts";
import {
  answer,
  embedQuery,
  loadEmbedder,
  MODELS,
  search,
} from "./pipeline.ts";
import { runSearchEval } from "./search-eval.ts";
import { openStore } from "./store.ts";

// Stage 7, step 4: ask a question, see the answer with its citations and the
// passages it was given. Each question is one "turn" that moves through
// searching → answering → done (or error).

type Turn = {
  id: string;
  question: string;
  model: string;
  status: "searching" | "answering" | "done" | "error";
  passages: Passage[];
  reply: string;
  cited: Passage[];
  error: string;
  // Milliseconds per step, to see where the time goes.
  // hamming is the part of search spent on the Hamming scan (stage 9).
  timings: {
    embed?: number;
    search?: number;
    hamming?: number;
    answer?: number;
  };
};

export function App() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [model, setModel] = useState(MODELS[0] ?? "");
  const [dataStatus, setDataStatus] = useState("Opening the search data…");
  const [isReady, setIsReady] = useState(false);

  const isBusy = turns.some(
    (turn) => turn.status === "searching" || turn.status === "answering",
  );

  const [evalStatus, setEvalStatus] = useState("");

  // Stage 9: the search data lives in OPFS. The first visit copies it there
  // (~610 MB, with progress); later visits only open it. Then the embedding
  // model: downloaded on the first visit (~275 MB), from the browser cache
  // after that. Its load time shows how long a cold start takes.
  useEffect(() => {
    async function load() {
      await openStore((copied, total) =>
        setDataStatus(
          `Copying the search data… ${(copied / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`,
        ),
      );

      setDataStatus("Loading the embedding model…");
      const start = performance.now();

      await loadEmbedder((info) => {
        if (info.status === "progress") {
          setDataStatus(
            `Loading the embedding model… ${info.file} ${info.progress.toFixed(0)}%`,
          );
        }
      });

      console.log(
        `Embedding model loaded in ${(performance.now() - start).toFixed(0)} ms`,
      );

      setIsReady(true);
      setDataStatus("");
    }

    load().catch((error) => setDataStatus(`Loading error: ${error}`));
  }, []);

  // The 48 gold questions through embedQuery + search only (search-eval.ts).
  async function evaluate() {
    setEvalStatus("Search eval: 0/48…");

    try {
      const result = await runSearchEval((done) =>
        setEvalStatus(`Search eval: ${done}/48…`),
      );

      setEvalStatus(
        `Search eval: ${result.hits}/${result.total} retrieved · per question: embed ${result.embedMs.toFixed(0)} ms · search ${result.searchMs.toFixed(0)} ms (hamming ${result.hammingMs.toFixed(0)} ms)${result.misses.map((miss) => `\n✗ ${miss}`).join("")}`,
      );
    } catch (error) {
      setEvalStatus(`Search eval error: ${error}`);
    }
  }

  const isEvaluating = evalStatus.endsWith("…");

  // Merges changes into one turn. Functional update: always applies to the
  // latest state, even after other updates happened in between.
  function update(id: string, changes: Partial<Turn>) {
    setTurns((previous) =>
      previous.map((turn) => (turn.id === id ? { ...turn, ...changes } : turn)),
    );
  }

  async function ask(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || isBusy || !isReady) return;
    const id = crypto.randomUUID();
    setQuestion("");

    // Newest first.
    setTurns((previous) => [
      {
        id,
        question: text,
        model,
        status: "searching",
        passages: [],
        reply: "",
        cited: [],
        error: "",
        timings: {},
      },
      ...previous,
    ]);

    try {
      let start = performance.now();
      const vector = await embedQuery(text);
      const embedMs = performance.now() - start;
      start = performance.now();
      const { passages, hammingMs } = await search(vector);
      const searchMs = performance.now() - start;

      update(id, {
        status: "answering",
        passages,
        timings: { embed: embedMs, search: searchMs, hamming: hammingMs },
      });

      start = performance.now();
      const { reply, cited } = await answer(text, passages, model);

      update(id, {
        status: "done",
        reply,
        cited,
        timings: {
          embed: embedMs,
          search: searchMs,
          hamming: hammingMs,
          answer: performance.now() - start,
        },
      });
    } catch (error) {
      update(id, { status: "error", error: String(error) });
    }
  }

  return (
    <main data-theme={theme}>
      <header className="app-header">
        <div>
          <p className="eyebrow">SIMPLE ENGLISH WIKIPEDIA</p>
          <h1>Wiki RAG</h1>
        </div>
        <button
          className="theme-toggle"
          type="button"
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
        >
          {theme === "light" ? "☾ Dark" : "☀ Light"}
        </button>
      </header>
      <p className="intro">
        Ask a question and explore the articles behind the answer.
      </p>
      <form onSubmit={ask}>
        <input
          type="text"
          name="question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about Simple English Wikipedia…"
        />
        <select
          name="model"
          value={model}
          onChange={(event) => setModel(event.target.value)}
        >
          {MODELS.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <button type="submit" disabled={isBusy || !isReady}>
          Ask
        </button>
      </form>
      {dataStatus && <p className="meta">{dataStatus}</p>}
      <p className="meta">
        <button
          type="button"
          onClick={evaluate}
          disabled={!isReady || isBusy || isEvaluating}
        >
          Run search eval
        </button>
      </p>
      {evalStatus && (
        <p className="meta" style={{ whiteSpace: "pre-line" }}>
          {evalStatus}
        </p>
      )}
      {turns.map((turn) => (
        <TurnView key={turn.id} turn={turn} />
      ))}
    </main>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  const { embed, search, hamming, answer } = turn.timings;

  const timings = [
    embed && `embed ${embed.toFixed(0)} ms`,
    search &&
      `search ${search.toFixed(0)} ms (hamming ${hamming?.toFixed(0)} ms)`,
    answer && `answer ${answer.toFixed(0)} ms`,
  ]
    .filter(Boolean)
    .join(" · ");

  // One link per article: the reply can cite two chunks of the same article
  // ([1] and [2] both Barcelona), which share a URL and would share a key.
  const sources = turn.cited.filter(
    (passage, i) =>
      turn.cited.findIndex(({ url }) => url === passage.url) === i,
  );

  return (
    <section className="turn">
      <div className="question">{turn.question}</div>
      <div className="meta">
        {turn.model}
        {timings && ` · ${timings}`}
      </div>
      {turn.status === "searching" && <p>Searching…</p>}
      {turn.status === "answering" && <p>Answering…</p>}
      {turn.status === "error" && <p className="error">{turn.error}</p>}
      {turn.status === "done" && (
        <>
          <p>
            <Reply reply={turn.reply} passages={turn.passages} />
          </p>
          {sources.length > 0 && (
            <p className="meta">
              Sources:{" "}
              {sources.map((passage, i) => (
                <span key={passage.url}>
                  {i > 0 && ", "}
                  <a href={passage.url} target="_blank" rel="noreferrer">
                    {passage.title}
                  </a>
                </span>
              ))}
            </p>
          )}
        </>
      )}
      {turn.passages.length > 0 && (
        <details>
          <summary className="meta">
            {turn.passages.length} passages given to the model
          </summary>
          {turn.passages.map((passage, i) => (
            <div
              key={`${passage.url}#${passage.content.length}`}
              className={
                turn.cited.includes(passage) ? "passage cited" : "passage"
              }
            >
              <strong>
                [{i + 1}] {passage.title}
              </strong>
              {"\n"}
              {passage.content.slice(passage.title.length).trim()}
            </div>
          ))}
        </details>
      )}
    </section>
  );
}

// The reply with every "[n]" turned into a link to passage n's article.
// split() with a capture group keeps the "[n]" pieces in the array.
function Reply({ reply, passages }: { reply: string; passages: Passage[] }) {
  const parts = reply.split(/(\[\d+\])/);

  return parts.map((part, i) => {
    const passage = passages[Number(part.slice(1, -1)) - 1];
    // The parts never change order for a given reply, so the position is a
    // stable key here.
    const key = `${i}:${part}`;

    if (/^\[\d+\]$/.test(part) && passage) {
      return (
        <a
          key={key}
          href={passage.url}
          target="_blank"
          rel="noreferrer"
          title={passage.title}
        >
          {part}
        </a>
      );
    }

    return <span key={key}>{part}</span>;
  });
}
