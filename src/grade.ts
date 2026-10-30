// Shared by closed-book.ts and rag-eval.ts, so both are graded the same way.

// Correct if the reply contains one of the expected answers as a whole word,
// case-insensitive. The lookarounds use Unicode letters/digits, so "Dan"
// doesn't match "abundant" and "Ölfusá" still matches (\b is ASCII-only).
export function isCorrect(reply: string, answers: string[]) {
  return answers.some((answer) => {
    const escaped = answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    return new RegExp(
      `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
      "iu",
    ).test(reply);
  });
}
