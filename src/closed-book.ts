import { isCorrect } from "./grade.ts";
import { chat } from "./ollama.ts";
import { questions } from "./questions.ts";

// Stage 6, step 1: ask the chat model every eval question without retrieval
// ("closed book"). Questions it already answers correctly show nothing about
// RAG, so they get removed from questions.ts; the rest is the eval set.
// Usage: npm run closed-book

const SYSTEM_PROMPT =
  "Answer in one short sentence. If you are not sure, say that you don't know.";

const correctTitles: string[] = [];

for (const [i, { question, title, answers }] of questions.entries()) {
  const reply = await chat([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: question },
  ]);

  const correct = isCorrect(reply, answers);
  if (correct) correctTitles.push(title);

  console.log(
    `${correct ? "✓" : "✗"} ${i + 1}. ${question}\n   expected: ${answers.join(" / ")}\n   model:    ${reply.replace(/\s+/g, " ").trim()}\n`,
  );
}

console.log(
  `Closed book: ${correctTitles.length}/${questions.length} correct, ${questions.length - correctTitles.length} wrong`,
);

console.log(
  `Correct (to remove from questions.ts):\n  ${correctTitles.join("\n  ")}`,
);
