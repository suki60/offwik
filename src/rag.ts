// The RAG prompt, shared by rag-eval.ts (Node) and the web app (browser).

export type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

// One retrieved chunk. `content` starts with "Title\n\n" (see chunker.ts).
export type Passage = { title: string; url: string; content: string };

// The model cites passages by number, not by URL: a small model can garble a
// long URL, "[2]" is hard to get wrong. citedPassages turns it back into a
// title + URL.
const SYSTEM_PROMPT = `You answer questions using only the numbered passages the user gives you.
Rules:
- Answer in one short sentence.
- End your answer with the number of the passage you used in square brackets.
- If the passages do not contain the answer, reply exactly: I don't know.`;

// Few-shot example, sent as an earlier user/assistant turn about made-up
// content: the model sees the format in use instead of a sentence to copy
// (scores in PLAN.md, stage 7). Passage 1 is a distractor, so it also shows
// picking the passage that holds the answer.
const EXAMPLE_QUESTION = "When was the village of Quillby founded?";

const EXAMPLE_PASSAGES: Passage[] = [
  {
    title: "Brindle Creek",
    url: "",
    content:
      "Brindle Creek\n\nBrindle Creek is a small river in Ontario, Canada. It is 14 km long.",
  },
  {
    title: "Quillby",
    url: "",
    content:
      "Quillby\n\nQuillby is a fishing village in Denmark. It was founded in 1732.",
  },
];

const EXAMPLE_ANSWER = "Quillby was founded in 1732 [2].";

// Passages first, question last (the last thing the model reads). Each
// chunk's "Title\n\n" prefix is dropped: the title is on the [n] line.
function userMessage(question: string, passages: Passage[]): Message {
  const context = passages
    .map(
      (passage, i) =>
        `[${i + 1}] ${passage.title}\n${passage.content.slice(passage.title.length).trim()}`,
    )
    .join("\n\n");

  return {
    role: "user",
    content: `Passages:\n\n${context}\n\nQuestion: ${question}`,
  };
}

export function buildMessages(
  question: string,
  passages: Passage[],
): Message[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    userMessage(EXAMPLE_QUESTION, EXAMPLE_PASSAGES),
    { role: "assistant", content: EXAMPLE_ANSWER },
    userMessage(question, passages),
  ];
}

// The passages a reply cites: every [n] that points at a real passage, in
// order of first mention. Numbers outside 1..passages.length are ignored.
export function citedPassages(reply: string, passages: Passage[]) {
  const numbers = [...reply.matchAll(/\[(\d+)\]/g)].map((match) =>
    Number(match[1]),
  );

  return [...new Set(numbers)]
    .map((n) => passages[n - 1])
    .filter((passage) => passage !== undefined);
}
