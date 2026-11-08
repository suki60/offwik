import { type FormEvent, useState } from "react";
import type { Passage } from "../rag.ts";
import {
  answer,
  CHAT_MODEL,
  embedQuery,
  loadModels,
  search,
} from "./pipeline.ts";
import { openStore } from "./store.ts";

// Ask a question, see the answer with its citations and the passages it was
// given. Each question is one "turn": searching → answering → done (or error).

type Turn = {
  id: string;
  question: string;
  status: "searching" | "answering" | "done" | "error";
  passages: Passage[];
  reply: string;
  cited: Passage[];
  error: string;
  // Where the time goes, shown under the question.
  timings: string[];
};

export function App() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState("");
  const [isStarted, setIsStarted] = useState(false);
  const [isReady, setIsReady] = useState(false);

  const isBusy = turns.some(
    (turn) => turn.status === "searching" || turn.status === "answering",
  );

  // Nothing loads before Start, so a Web Inspector recording can begin at 0.
  // First the search data (copied into OPFS on the first visit), then both
  // models (downloaded on the first visit, from WebLLM's cache after that).
  async function start() {
    setIsStarted(true);

    try {
      // Asks the browser not to delete our ~1.4 GB when space runs low. It
      // decides on its own: false means "best effort".
      console.log(`Persistent storage: ${await navigator.storage.persist()}`);

      await openStore((copied, total) =>
        setStatus(
          `Copying the search data… ${(copied / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`,
        ),
      );

      const startedAt = performance.now();
      await loadModels((report) => setStatus(report.text));
      const seconds = (performance.now() - startedAt) / 1000;
      console.log(`Models loaded in ${seconds.toFixed(1)} s`);
      setIsReady(true);
      setStatus("");
    } catch (error) {
      setStatus(`Loading error: ${error}`);
    }
  }

  // Merges changes into one turn. The functional update always applies to
  // the latest state, even after other updates happened in between.
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
        status: "searching",
        passages: [],
        reply: "",
        cited: [],
        error: "",
        timings: [],
      },
      ...previous,
    ]);

    try {
      let startedAt = performance.now();
      const vector = await embedQuery(text);
      const embed = `embed ${(performance.now() - startedAt).toFixed(0)} ms`;
      startedAt = performance.now();
      const passages = await search(vector);
      const searched = `search ${(performance.now() - startedAt).toFixed(0)} ms`;
      update(id, { status: "answering", passages, timings: [embed, searched] });

      const { reply, cited, usage } = await answer(text, passages, (reply) =>
        update(id, { reply }),
      );

      update(id, {
        status: "done",
        reply,
        cited,
        timings: [
          embed,
          searched,
          `first token ${usage?.extra.time_to_first_token_s.toFixed(2)} s`,
          `decode ${usage?.extra.decode_tokens_per_s.toFixed(1)} tok/s`,
        ],
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
          <h1>offwik</h1>
        </div>
        <button
          className="theme-toggle"
          type="button"
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
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
        <button type="submit" disabled={isBusy || !isReady}>
          Ask
        </button>
      </form>
      {!isStarted && (
        <p className="meta">
          <button type="button" onClick={start}>
            Start
          </button>
        </p>
      )}
      {status && <p className="meta">{status}</p>}
      {turns.map((turn) => (
        <TurnView key={turn.id} turn={turn} />
      ))}
    </main>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  // One link per article: two cited chunks of the same article share a URL.
  const sources = turn.cited.filter(
    (passage, i) =>
      turn.cited.findIndex(({ url }) => url === passage.url) === i,
  );

  return (
    <section className="turn">
      <div className="question">{turn.question}</div>
      <div className="meta">{[CHAT_MODEL, ...turn.timings].join(" · ")}</div>
      {turn.status === "searching" && <p>Searching…</p>}
      {turn.status === "answering" && <p>{turn.reply || "Answering…"}</p>}
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
  return reply.split(/(\[\d+\])/).map((part, i) => {
    const passage = passages[Number(part.slice(1, -1)) - 1];
    // The parts never change order, so the position is a stable key.
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
