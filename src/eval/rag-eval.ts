import { connect } from "../db.ts";
import { CHAT_MODEL, chat, embed } from "../ollama.ts";
import { buildMessages, citedPassages } from "../rag.ts";
import { search } from "../search.ts";
import { questions } from "./questions.ts";

// The gold questions with retrieval: search the top K chunks (pgvector), let
// the chat model answer from them, then check three things separately:
// - retrieved: is the expected article among the K passages? (search)
// - correct:   does the reply contain an expected answer? (search + model)
// - cited:     does the reply cite the expected article? (model)
// Usage: npm run rag-eval   (CHAT_MODEL=<ollama model> to compare another)

const K = 5;

const db = await connect();

// Correct if the reply contains one of the expected answers as a whole word,
// case-insensitive. Unicode letters/digits around it, so "Dan" doesn't match
// "abundant" and "Ölfusá" still matches (\b is ASCII-only).
function isCorrect(reply: string, answers: string[]) {
  return answers.some((answer) => {
    const escaped = answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    return new RegExp(
      `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
      "iu",
    ).test(reply);
  });
}

const vectors = await embed(
  questions.map(({ question }) => `search_query: ${question}`),
);

let retrieved = 0;
let correct = 0;
let cited = 0;

for (const [i, { question, title, answers }] of questions.entries()) {
  const passages = await search(db, vectors[i], K);
  const reply = await chat(buildMessages(question, passages));
  const isRetrieved = passages.some((passage) => passage.title === title);
  const isRight = isCorrect(reply, answers);
  const citedTitles = citedPassages(reply, passages).map(({ title }) => title);
  const isCited = citedTitles.includes(title);
  if (isRetrieved) retrieved++;
  if (isRight) correct++;
  if (isCited) cited++;

  console.log(
    `${isRight ? "✓" : "✗"} ${i + 1}. ${question}\n   expected:  ${answers.join(" / ")}  (${title})\n   retrieved: ${isRetrieved ? "yes" : "no"}   cited: ${citedTitles.join(" | ") || "-"}\n   model:     ${reply.replace(/\s+/g, " ").trim()}\n`,
  );
}

await db.end();
const n = questions.length;
console.log(`RAG with ${CHAT_MODEL}, top ${K}, ${n} questions:`);
console.log(`  retrieved expected article: ${retrieved}/${n}`);
console.log(`  answer correct:             ${correct}/${n}`);
console.log(`  cited expected article:     ${cited}/${n}`);
