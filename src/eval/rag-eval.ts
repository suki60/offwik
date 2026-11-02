import { connect } from "../db.ts";
import { chat, embed } from "../ollama.ts";
import { buildMessages, citedPassages } from "../rag.ts";
import { search } from "../search.ts";
import { questions } from "./questions.ts";

// Stage 7, step 2: the gold questions with retrieval, graded like stage 6's
// closed-book.ts (closed book: qwen3.5:0.8b 0/48, qwen3.5:9b 7/48).
// Per question: retrieve the top K chunks (HNSW, ef_search 1000), let the chat
// model answer from them, then check three things separately:
// - retrieved: is the expected article among the K passages? (search)
// - correct:   does the reply contain an expected answer? (search + model)
// - cited:     does the reply cite the expected article? (model)
// Usage: npm run rag-eval                          (llama3.2:1b)
//        CHAT_MODEL=qwen3.5:0.8b npm run rag-eval (comparison)

// Exact recall@5 on the gold set was 1.00 (stage 6). 5 chunks of up to 1,200
// chars are ~1.5k tokens of context (estimate at 4 chars/token).
const K = 5;

const db = await connect();

// Correct if the reply contains one of the expected answers as a whole word,
// case-insensitive. The lookarounds use Unicode letters/digits, so "Dan"
// doesn't match "abundant" and "Ölfusá" still matches (\b is ASCII-only).
function isCorrect(reply: string, answers: string[]) {
  return answers.some((answer) => {
    const escaped = answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    return new RegExp(
      `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
      "iu",
    ).test(reply);
  });
}

// 48 questions: one embeddings request for all of them.
const vectors = await embed(
  questions.map(({ question }) => `search_query: ${question}`),
);

let retrieved = 0;
let correct = 0;
let cited = 0;

for (const [i, { question, title, answers }] of questions.entries()) {
  const passages = await search(db, vectors[i] ?? [], K);
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
const model = process.env.CHAT_MODEL ?? "llama3.2:1b";
console.log(`RAG with ${model}, top ${K}, ${n} questions:`);
console.log(`  retrieved expected article: ${retrieved}/${n}`);
console.log(`  answer correct:             ${correct}/${n}`);
console.log(`  cited expected article:     ${cited}/${n}`);
