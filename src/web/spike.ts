import { CreateMLCEngine, type MLCEngine } from "@mlc-ai/web-llm";

// Stage 8: can the iPhone run the chat model in Safari? Plain DOM, no React,
// no retrieval: load the model with WebLLM (WebGPU), chat, show the numbers.
// Open /spike.html on the dev server (npm run dev).

// WebLLM's prebuilt build of Llama 3.2 1B (4-bit weights, fp16 activations).
// Its config says ~879 MB of GPU memory and a 4,096-token context.
// Qwen3.5-0.8B-q4f16_1-MLC (~1,629 MB) crashed the iPhone tab when memory was
// tight; Qwen2.5-0.5B and Llama 3.2 1B ran without crashes, Llama answered
// better.
const MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

function element<T extends HTMLElement>(id: string) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`spike.html has no #${id} element`);
  return found as T;
}

const gpu = element<HTMLParagraphElement>("gpu");
const loadButton = element<HTMLButtonElement>("load");
const progress = element<HTMLParagraphElement>("progress");
const form = element<HTMLFormElement>("form");
const prompt = element<HTMLInputElement>("prompt");
const askButton = element<HTMLButtonElement>("ask");
const reply = element<HTMLParagraphElement>("reply");
const stats = element<HTMLParagraphElement>("stats");

let engine: MLCEngine | undefined;

// Question 1: does this browser have WebGPU at all? The types say
// navigator.gpu always exists, but browsers without WebGPU leave it out.
async function checkGpu() {
  if (!("gpu" in navigator)) {
    gpu.textContent = "WebGPU: not available in this browser";
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();

  if (adapter) {
    gpu.textContent = `WebGPU: yes (${adapter.info.vendor} ${adapter.info.architecture})`;
  } else {
    gpu.textContent = "WebGPU: navigator.gpu exists, but no adapter";
  }
}

// Question 2: does the model download, compile and fit in memory? The first
// load downloads ~695 MB from Hugging Face; WebLLM caches the files in the
// browser (Cache API), so a reload only reads them back.
async function load() {
  loadButton.disabled = true;
  const start = performance.now();

  try {
    engine = await CreateMLCEngine(MODEL_ID, {
      initProgressCallback: (report) => {
        progress.textContent = report.text;
      },
    });

    const seconds = (performance.now() - start) / 1000;
    progress.textContent = `Loaded ${MODEL_ID} in ${seconds.toFixed(1)} s`;
    prompt.disabled = false;
    askButton.disabled = false;
  } catch (error) {
    progress.textContent = `Load failed: ${String(error)}`;
    loadButton.disabled = false;
  }
}

// Question 3: how fast is it? Streams the reply and shows WebLLM's numbers
// from the last chunk: prefill (reading the prompt) and decode (writing).
async function ask(event: SubmitEvent) {
  event.preventDefault();
  const text = prompt.value.trim();
  if (!engine || !text) return;
  askButton.disabled = true;
  reply.textContent = "";
  stats.textContent = "";

  try {
    // No enable_thinking: Llama 3.2 doesn't think, and WebLLM would put an
    // empty <think></think> in front of the reply that only Qwen3 understands.
    const chunks = await engine.chat.completions.create({
      messages: [{ role: "user", content: text }],
      temperature: 0,
      stream: true,
      stream_options: { include_usage: true },
    });

    for await (const chunk of chunks) {
      reply.textContent += chunk.choices[0]?.delta.content ?? "";

      if (chunk.usage) {
        const { prompt_tokens, completion_tokens, extra } = chunk.usage;

        stats.textContent =
          `${prompt_tokens} prompt tokens at ${extra.prefill_tokens_per_s.toFixed(0)} tok/s, ` +
          `${completion_tokens} reply tokens at ${extra.decode_tokens_per_s.toFixed(1)} tok/s, ` +
          `first token after ${extra.time_to_first_token_s.toFixed(2)} s`;
      }
    }
  } catch (error) {
    stats.textContent = `Chat failed: ${String(error)}`;
  }

  askButton.disabled = false;
}

loadButton.addEventListener("click", load);
form.addEventListener("submit", ask);
checkGpu();
