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
const SYSTEM_PROMPT = `You answer questions using only the numbered passages the user gives you.
Rules:
- Answer in one short sentence.
- End your answer with the number of the passage you used in square brackets.
- If the passages do not contain the answer, reply exactly: I don't know.`;

// Few-shot example, sent as an earlier user/assistant turn (stage 7 rag-eval
// with qwen3.5:0.8b):
// - Rule only ("like [2]"): 23 of 48 replies were just "[1]", 19/48 correct.
// - Example reply inside the rule: 36/48, but 6 replies copied it word for
//   word ("The town was founded in 1850 [2].").
// As a past exchange about other, made-up content, the model sees the format
// in use instead of a sentence to paste. Passage 1 is a distractor, so the
// example also shows picking the passage that holds the answer.
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

// Passages first, question last: the question is the last thing the model
// reads before answering. Drops the "Title\n\n" prefix of each chunk: the
// title is already on the [n] line.
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

  return [...new Set(numbers)].flatMap((n) => {
    const passage = passages[n - 1];
    return passage ? [passage] : [];
  });
}
