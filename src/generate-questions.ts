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

// v2: the first run gave questions like "In which country does this frog
// live?" (no subject: unanswerable without the passage). Now the model gets
// the article title and must name the subject; a check below enforces it.
const SYSTEM_PROMPT = `You write test questions for a search engine over Simple English Wikipedia.
You get the title of a Wikipedia article and one passage from it. Write ONE question that:
- asks about one specific fact stated in the passage (a name, number, date or place),
- names the subject of the article (from the title), so it makes sense to someone who has not seen the passage; never write "this frog", "the show", "he",
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
// v2: also skips list-like pages (years, dates, "Deaths in May 2021",
// "1990s", "2004 in music"). They collect facts that have their own article,
// so search rightly returns that article and the eval counted a miss.
const { rows } = await db.query<{ id: number; title: string; content: string }>(
  `SELECT c.id, a.title, c.content
   FROM chunks c
   JOIN articles a ON a.id = c.article_id
   WHERE length(c.content) > 200
     AND a.title !~ $2
   ORDER BY md5(c.id::text)
   LIMIT $1`,
  [
    count * 3,
    "^(Deaths in .*|\\d{1,4}( BC)?|\\d{1,4}s( BC)?|\\d{1,4} in .*|(January|February|March|April|May|June|July|August|September|October|November|December) \\d{1,2})$",
  ],
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
      { role: "user", content: `Title: ${title}\n\nPassage:\n${content}` },
    ],
    { model: MODEL, json: true },
  );

  const reply = Reply.safeParse(JSON.parse(text));

  if (!reply.success || reply.data.skip) {
    skipped++;
    continue;
  }

  const { question, answer } = reply.data;

  // Words of the title without a "(movie)"-style suffix, 3+ letters:
  // "Nebraska (movie)" -> ["nebraska"].
  const titleWords = title
    .replace(/\s*\(.*\)$/, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3);

  // Checks the prompt asks for but the model may ignore: a question that
  // names the subject (shares a word with the title), a short answer, and the
  // answer really in the passage (otherwise it may be made up).
  const valid =
    question !== undefined &&
    answer !== undefined &&
    titleWords.some((word) => question.toLowerCase().includes(word)) &&
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
