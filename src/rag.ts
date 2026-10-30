// Stage 7: the RAG prompt, shared by rag-eval.ts (Node) and the web app
// (browser). No Node imports here, so Vite can bundle it as it is.

export type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

// One retrieved chunk. `content` starts with "Title\n\n" (see chunker.ts).
export type Passage = { title: string; url: string; content: string };

// The model cites passages by number, not by URL: a 0.8B model copying
// "https://simple.wikipedia.org/wiki/Loachapoka%2C%20Alabama" letter by letter
// can garble it, while "[2]" is hard to get wrong. Code turns the number back
// into a title + URL (citedPassages below).
// The rule shows a full example reply: with only "like [2]", qwen3.5:0.8b
// replied with just "[1]" in 23 of 48 questions (rag-eval, stage 7).
const SYSTEM_PROMPT = `You answer questions using only the numbered passages the user gives you.
Rules:
- Answer in one short sentence.
- End your answer with the number of the passage you used, for example: "The town was founded in 1850 [2]."
- If the passages do not contain the answer, reply exactly: I don't know.`;

export function buildMessages(
  question: string,
  passages: Passage[],
): Message[] {
  // Drop the "Title\n\n" prefix: the title is already on the [n] line.
  const context = passages
    .map(
      (passage, i) =>
        `[${i + 1}] ${passage.title}\n${passage.content.slice(passage.title.length).trim()}`,
    )
    .join("\n\n");

  // Passages first, question last: the question is the last thing the model
  // reads before answering.
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Passages:\n\n${context}\n\nQuestion: ${question}`,
    },
  ];
}

// The passages a reply cites: every [n] that points at a real passage, in
// order of first mention. Numbers outside 1..passages.length are ignored.
export function citedPassages(reply: string, passages: Passage[]) {
  const numbers = [...reply.matchAll(/\[(\d+)\]/g)].map((match) =>
    Number(match[1]),
  );

  return [...new Set(numbers)].flatMap((n) => {
    const passage = passages[n - 1];
    return passage ? [passage] : [];
  });
}
