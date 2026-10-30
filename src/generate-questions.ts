import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { connect } from "./db.ts";
import { chat } from "./ollama.ts";

// Stage 6: a bigger, synthetic eval set. qwen3.5:9b reads one chunk at a time
// and writes a question that chunk answers; the chunk's article is the
// expected title. questions.ts stays the hand-written "gold" set: this one is
// bigger but noisier, so spot-check it by hand.
// Usage: npm run generate-questions [-- <count>]   (default 300)

const count = Number(process.argv[2] ?? 300);
const OUTPUT = "src/synthetic-questions.json";

// The bigger model writes the questions: the phone model (0.8B) would write
// poor ones. Generating questions is offline work, not part of the app.
const MODEL = "qwen3.5:9b";

const SYSTEM_PROMPT = `You write test questions for a search engine over Simple English Wikipedia.
You get one passage from a Wikipedia article. Write ONE question that:
- asks about one specific fact stated in the passage (a name, number, date or place),
- makes sense on its own to someone who has not seen the passage: name the subject,
- uses your own words, not phrases copied from the passage.
The answer must be 1 to 5 words copied exactly from the passage.
If the passage has no such fact (only references, links or category names), reply {"skip": true}.
Otherwise reply {"question": "...", "answer": "..."}.`;

// All fields optional: the reply is either {skip: true} or a question.
const Reply = z.object({
  skip: z.boolean().optional(),
  question: z.string().optional(),
  answer: z.string().optional(),
});

type SyntheticQuestion = {
  question: string;
  title: string;
  answers: string[];
  chunkId: number;
};

const db = await connect();

// Fixed pseudo-random order (md5 of the id), so reruns pick the same chunks.
// Every chunk has the same chance, so long articles (many chunks) are in the
// sample too, not only stubs. 3x the count leaves room for skips and drops.
// length > 200 skips chunks that are little more than a title.
const { rows } = await db.query<{ id: number; title: string; content: string }>(
  `SELECT c.id, a.title, c.content
   FROM chunks c
   JOIN articles a ON a.id = c.article_id
   WHERE length(c.content) > 200
   ORDER BY md5(c.id::text)
   LIMIT $1`,
  [count * 3],
);

await db.end();

const questions: SyntheticQuestion[] = [];
let skipped = 0;
let dropped = 0;

for (const { id, title, content } of rows) {
  if (questions.length >= count) break;

  const text = await chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Passage:\n${content}` },
    ],
    { model: MODEL, json: true },
  );

  const reply = Reply.safeParse(JSON.parse(text));

  if (!reply.success || reply.data.skip) {
    skipped++;
    continue;
  }

  const { question, answer } = reply.data;

  // Checks the prompt asks for but the model may ignore: a question, a short
  // answer, and the answer really in the passage (otherwise it may be made up).
  const valid =
    question !== undefined &&
    answer !== undefined &&
    answer.split(/\s+/).length <= 5 &&
    content.toLowerCase().includes(answer.toLowerCase());

  if (!valid) {
    dropped++;
    console.log(`  drop  ${title}: ${question} → ${answer}`);
    continue;
  }

  questions.push({ question, title, answers: [answer], chunkId: id });
  console.log(
    `${questions.length}/${count}  ${title}: ${question} → ${answer}`,
  );

  // Saved after every question: a crash or Ctrl+C keeps what is done so far.
  await writeFile(OUTPUT, `${JSON.stringify(questions, null, 2)}\n`);
}

console.log(
  `\n${questions.length} questions written to ${OUTPUT} (${skipped} skipped, ${dropped} dropped)`,
);
