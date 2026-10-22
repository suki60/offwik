// Stage 2: split one article into chunks. Generic rules, nothing Wikipedia-specific:
// split at blank lines, pack paragraphs up to MAX_CHARS, cut anything longer.

// ~300 tokens at 4 chars/token: small enough to stay on one topic,
// big enough to hold a full paragraph or two.
const MAX_CHARS = 1200;

export function chunkArticle(title: string, text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");

  // Greedily join paragraphs until the next one would go over MAX_CHARS.
  const bodies: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + 2 + paragraph.length > MAX_CHARS) {
      bodies.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  if (current) bodies.push(current);

  // A single paragraph longer than MAX_CHARS is cut into fixed-size pieces.
  // Each chunk starts with the title, so it still says what it is about.
  const chunks: string[] = [];
  for (const body of bodies) {
    for (let i = 0; i < body.length; i += MAX_CHARS) {
      chunks.push(`${title}\n\n${body.slice(i, i + MAX_CHARS)}`);
    }
  }
  return chunks;
}
