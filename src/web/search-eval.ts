import { questions } from "../eval/questions.ts";
import { embedQuery, search } from "./pipeline.ts";

// Stage 9, step 4b: eval/search-eval.ts inside the page, with the app's own
// embedQuery + search (no chat): recall@5 at article level, and the time per
// step, one question at a time like a user asking. In Node with Ollama's
// arctic (stage 10): 48/48 with 200 candidates, Hamming 6.0 ms per query.
// The same score here means WebLLM's arctic matches Ollama's.

export type SearchEvalResult = {
  hits: number;
  total: number;
  misses: string[];
  embedMs: number;
  searchMs: number;
  hammingMs: number;
};

export async function runSearchEval(onProgress: (done: number) => void) {
  const misses: string[] = [];
  let hits = 0;
  let embedMs = 0;
  let searchMs = 0;
  let hammingMs = 0;

  for (const [i, { question, title }] of questions.entries()) {
    let start = performance.now();
    const vector = await embedQuery(question);
    embedMs += performance.now() - start;
    start = performance.now();
    const result = await search(vector);
    searchMs += performance.now() - start;
    hammingMs += result.hammingMs;

    if (result.passages.some((passage) => passage.title === title)) {
      hits++;
    } else {
      misses.push(`${question} (${title})`);
    }

    onProgress(i + 1);
  }

  const total = questions.length;

  return {
    hits,
    total,
    misses,
    embedMs: embedMs / total,
    searchMs: searchMs / total,
    hammingMs: hammingMs / total,
  } satisfies SearchEvalResult;
}
