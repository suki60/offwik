import { questions } from "../eval/questions.ts";
import { embedQuery, search } from "./pipeline.ts";

// eval/search-eval.ts inside the page, with the app's own embedQuery +
// search: recall@5 at article level and the time per step, one question at
// a time like a user asking. Node gets 48/48.

export async function runSearchEval(onProgress: (done: number) => void) {
  const misses: string[] = [];
  let embedMs = 0;
  let searchMs = 0;

  for (const [i, { question, title }] of questions.entries()) {
    let start = performance.now();
    const vector = await embedQuery(question);
    embedMs += performance.now() - start;
    start = performance.now();
    const passages = await search(vector);
    searchMs += performance.now() - start;

    if (!passages.some((passage) => passage.title === title)) {
      misses.push(`${question} (${title})`);
    }

    onProgress(i + 1);
  }

  const n = questions.length;

  return {
    hits: n - misses.length,
    total: n,
    misses,
    embedMs: embedMs / n,
    searchMs: searchMs / n,
  };
}
