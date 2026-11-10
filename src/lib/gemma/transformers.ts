import type { ChatMessage } from "@/lib/gemma/engine";

/** In-browser Gemma fallback (ONNX / WebGPU or WASM) via transformers.js. */
export const TRANSFORMERS_MODEL = "onnx-community/gemma-3-270m-it-ONNX";
const FLAG = "vaultzk-transformers-ready";

type TextGen = (
  messages: ChatMessage[],
  opts: { max_new_tokens: number; do_sample: boolean },
) => Promise<Array<{ generated_text: Array<{ role: string; content: string }> | string }>>;

let pipePromise: Promise<TextGen> | null = null;

export function isTransformersReady(): boolean {
  return typeof localStorage !== "undefined" && localStorage.getItem(FLAG) === "1";
}

export async function loadTransformers(onProgress?: (pct: number, file: string) => void): Promise<void> {
  if (!pipePromise) {
    pipePromise = (async () => {
      const tf = await import("@huggingface/transformers");
      const device = typeof navigator !== "undefined" && "gpu" in navigator ? "webgpu" : "wasm";
      const pipe = await tf.pipeline("text-generation", TRANSFORMERS_MODEL, {
        dtype: "q4",
        device,
        progress_callback: (p: { status?: string; progress?: number; file?: string }) => {
          if (p.status === "progress" && typeof p.progress === "number") onProgress?.(p.progress, p.file ?? "");
        },
      });
      return pipe as unknown as TextGen;
    })().catch((e: unknown) => {
      pipePromise = null;
      throw e;
    });
  }
  await pipePromise;
  localStorage.setItem(FLAG, "1");
}

export async function clearTransformersCache(): Promise<void> {
  pipePromise = null;
  localStorage.removeItem(FLAG);
  if (typeof caches !== "undefined") {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.includes("transformers")).map((k) => caches.delete(k)));
  }
}

export async function generateTransformers(messages: ChatMessage[], maxTokens: number): Promise<{ text: string; tokens: number }> {
  await loadTransformers();
  const pipe = await (pipePromise as Promise<TextGen>);
  const out = await pipe(messages, { max_new_tokens: maxTokens, do_sample: false });
  const gen = out[0]?.generated_text;
  const text = Array.isArray(gen) ? (gen[gen.length - 1]?.content ?? "") : String(gen ?? "");
  return { text, tokens: Math.max(1, Math.round(text.length / 4)) };
}
