// Stage 2: split one article into section-aware chunks.
// The text has no heading markup (see PLAN.md, stage 1 facts), so headings and
// categories are found with simple shape rules. They are guesses, not parsing.

export type Chunk = {
  section: string | null; // null for the intro (text before the first heading)
  content: string; // "Title › Section\n\n<text>": the prefix is embedded with the text
};

// Max characters of text per chunk, prefix not included (~300 tokens at 4 chars/token).
// Small enough to stay on one topic, big enough to hold a full paragraph or two.
const MAX_CHARS = 1200;

// Sections that are links or references, not facts about the subject.
const SKIP_SECTIONS = new Set([
  "references",
  "other websites",
  "related pages",
  "notes",
  "gallery",
  "sources",
  "footnotes",
  "further reading",
  "external links",
  "see also",
  "bibliography",
]);

// A heading is a short line with at least one letter, no sentence punctuation,
// and no leading space (lines starting with a space are list items).
function isHeading(line: string): boolean {
  return (
    line.length <= 60 &&
    /\p{L}/u.test(line) &&
    !line.startsWith(" ") &&
    !/[.!?:;,]\s*$/.test(line)
  );
}

export function chunkArticle(title: string, text: string): Chunk[] {
  // Wiki tables survived as raw markup ("|-", "|1993||Verdy Kawasaki||..."): drop
  // those lines. Rows start with "|", tables with "{|", header cells with "!",
  // and cells are separated by "||".
  const cleaned = text
    .split("\n")
    .filter((line) => !/^(\||\{\||!)/.test(line) && !line.includes("||"))
    .join("\n");

  // Blocks are separated by one or more blank lines; some "blank" lines contain spaces.
  const blocks = cleaned
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s+$/, ""))
    .filter((block) => block.trim() !== "");

  // Category names ("1987 births", "Communes in Aisne") are the last block:
  // every line short and without end punctuation. Drop it before looking for
  // headings, or the first category would look like a heading.
  const last = blocks.at(-1);
  if (blocks.length > 1 && last?.split("\n").every(isHeading)) {
    blocks.pop();
  }

  // Group blocks into sections. The first block is the intro, even when it looks
  // like a heading ("ROM can mean"), except when the text starts with a blank line:
  // date and year pages have no intro and start straight with "Events".
  const hasIntro = !/^\s*\n/.test(cleaned);
  const sections: { heading: string | null; paragraphs: string[] }[] = [
    { heading: null, paragraphs: [] },
  ];
  for (const [index, block] of blocks.entries()) {
    const [firstLine = "", ...rest] = block.split("\n");
    if (index === 0 && hasIntro) {
      sections[0]?.paragraphs.push(block);
    } else if (isHeading(firstLine)) {
      sections.push({ heading: firstLine.trim(), paragraphs: [] });
      if (rest.length > 0) sections.at(-1)?.paragraphs.push(rest.join("\n"));
    } else {
      sections.at(-1)?.paragraphs.push(block);
    }
  }

  const chunks: Chunk[] = [];
  for (const { heading, paragraphs } of sections) {
    if (heading && SKIP_SECTIONS.has(heading.toLowerCase())) continue;
    const prefix = heading ? `${title} › ${heading}` : title;
    for (const body of pack(paragraphs.flatMap(splitParagraph), "\n\n")) {
      chunks.push({ section: heading, content: `${prefix}\n\n${body}` });
    }
  }
  return chunks;
}

// Greedily join parts with `separator` until the next one would go over MAX_CHARS.
function pack(parts: string[], separator: string): string[] {
  const bodies: string[] = [];
  let current = "";
  for (const part of parts) {
    if (
      current &&
      current.length + separator.length + part.length > MAX_CHARS
    ) {
      bodies.push(current);
      current = "";
    }
    current = current ? `${current}${separator}${part}` : part;
  }
  if (current) bodies.push(current);
  return bodies;
}

// Too-long pieces are split at the largest boundary that works:
// paragraph -> lines (keeps lists as lists) -> sentences -> fixed-size cuts.
function splitParagraph(paragraph: string): string[] {
  if (paragraph.length <= MAX_CHARS) return [paragraph];
  return pack(paragraph.split("\n").flatMap(splitLine), "\n");
}

function splitLine(line: string): string[] {
  if (line.length <= MAX_CHARS) return [line];
  return pack(line.split(/(?<=[.!?])\s+/).flatMap(cut), " ");
}

// Last resort for a single sentence longer than MAX_CHARS.
function cut(sentence: string): string[] {
  const pieces: string[] = [];
  for (let i = 0; i < sentence.length; i += MAX_CHARS) {
    pieces.push(sentence.slice(i, i + MAX_CHARS));
  }
  return pieces;
}
