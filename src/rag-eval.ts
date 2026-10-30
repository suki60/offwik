import { connect } from "./db.ts";
import { isCorrect } from "./grade.ts";
import { chat, embed } from "./ollama.ts";
import { questions } from "./questions.ts";
import { buildMessages, citedPassages, type Passage } from "./rag.ts";

// Stage 7, step 2: the gold questions with retrieval, graded like
// closed-book.ts (closed book: qwen3.5:0.8b 0/48, qwen3.5:9b 7/48).
// Per question: retrieve the top K chunks (HNSW, ef_search 1000), let the chat
// model answer from them, then check three things separately:
// - retrieved: is the expected article among the K passages? (search)
// - correct:   does the reply contain an expected answer? (search + model)
// - cited:     does the reply cite the expected article? (model)
// Usage: npm run rag-eval
//        CHAT_MODEL=qwen3.5:9b npm run rag-eval   (comparison)

// Exact recall@5 on the gold set was 1.00 (stage 6). 5 chunks of up to 1,200
// chars are ~1.5k tokens of context (estimate at 4 chars/token).
const K = 5;

const db = await connect();
await db.query("SELECT set_config('hnsw.ef_search', '1000', false)");

// Same query as search.ts, with the columns the prompt needs.
const sql = `
  SELECT a.title, a.url, c.content
  FROM chunks c
  JOIN articles a ON a.id = c.article_id
  WHERE c.embedding IS NOT NULL
  ORDER BY c.embedding <=> $1::vector
  LIMIT $2
`;

// 48 questions: one embeddings request for all of them.
const vectors = await embed(
  questions.map(({ question }) => `search_query: ${question}`),
);

let retrieved = 0;
let correct = 0;
let cited = 0;

for (const [i, { question, title, answers }] of questions.entries()) {
  const { rows } = await db.query<Passage>(sql, [
    JSON.stringify(vectors[i]),
    K,
  ]);

  const reply = await chat(buildMessages(question, rows));
  const isRetrieved = rows.some((passage) => passage.title === title);
  const isRight = isCorrect(reply, answers);
  const citedTitles = citedPassages(reply, rows).map(({ title }) => title);
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
const model = process.env.CHAT_MODEL ?? "qwen3.5:0.8b";
console.log(`RAG with ${model}, top ${K}, ${n} questions:`);
console.log(`  retrieved expected article: ${retrieved}/${n}`);
console.log(`  answer correct:             ${correct}/${n}`);
console.log(`  cited expected article:     ${cited}/${n}`);
