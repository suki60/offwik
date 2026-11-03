import { pipeline } from "@huggingface/transformers";
import { embed } from "../ollama.ts";
import { questions } from "./questions.ts";

// Stage 9, step 1: does transformers.js embed queries like Ollama did?
// The stored vectors come from Ollama's nomic-embed-text (nomic-bert, F16).
// In the browser the query will be embedded by transformers.js with the ONNX
// export of the same model, so both must point the same way. Per dtype, the
// cosine between the two vectors for each of the 48 gold questions.
// Usage: npm run embed-parity

const MODEL = "nomic-ai/nomic-embed-text-v1.5";

// fp32: onnx/model.onnx, fp16: model_fp16.onnx, q8: model_quantized.onnx.
const DTYPES = ["fp32", "fp16", "q8"] as const;

const texts = questions.map(({ question }) => `search_query: ${question}`);
const reference = await embed(texts);

function cosine(a: number[], b: number[]) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }

  return dot / Math.sqrt(normA * normB);
}

for (const dtype of DTYPES) {
  const loadStart = performance.now();
  const extractor = await pipeline("feature-extraction", MODEL, { dtype });
  const loadMs = performance.now() - loadStart;

  // nomic-embed-text: mean pooling over the tokens, then length 1.
  const embedStart = performance.now();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  const embedMs = performance.now() - embedStart;

  const vectors: number[][] = output.tolist();
  const scores = vectors.map((vector, i) => cosine(vector, reference[i] ?? []));
  const min = Math.min(...scores);
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const worst = scores.indexOf(min);

  console.log(
    `${dtype.padEnd(5)} dims ${vectors[0]?.length}  min ${min.toFixed(4)}  mean ${mean.toFixed(4)}  load ${(loadMs / 1000).toFixed(1)} s  embed 48 ${embedMs.toFixed(0)} ms\n      worst: ${questions[worst]?.question}`,
  );

  await extractor.dispose();
}
