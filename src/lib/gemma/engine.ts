import { useAppStore, type EngineId } from "@/lib/store";
import { errorMessage } from "@/lib/utils";
import { generateTransformers, isTransformersReady, TRANSFORMERS_MODEL } from "@/lib/gemma/transformers";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenResult {
  text: string;
  engine: EngineId;
  model: string;
  ms: number;
  tokens: number;
}

export interface OllamaStatus {
  reachable: boolean;
  host: string;
  models: Array<{ name: string; sizeBytes: number; quantization: string; parameterSize: string; family: string }>;
  running: Array<{ name: string; sizeBytes: number; sizeVram: number }>;
  system: { cpus: number; loadAvg1: number; totalMem: number; freeMem: number; rss: number };
  defaultModel: string;
}

export async function fetchOllamaStatus(): Promise<OllamaStatus | null> {
  try {
    const res = await fetch("/api/gemma/status", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as OllamaStatus;
  } catch {
    return null;
  }
}

function modelInstalled(models: string[], wanted: string): boolean {
  return models.some((m) => m === wanted || m.startsWith(`${wanted}:`) || wanted.startsWith(`${m}:`));
}

/** Probes engines in priority order and publishes the result to the global Gemma status indicator. */
export async function refreshGemmaStatus(): Promise<OllamaStatus | null> {
  const { settings, setGemma } = useAppStore.getState();
  const st = await fetchOllamaStatus();
  const installed = st?.models.map((m) => m.name) ?? [];
  const reachable = st?.reachable ?? false;
  const ollamaOk = reachable && modelInstalled(installed, settings.gemmaModel);
  const mode = settings.engineMode;
  let engine: EngineId = "rules";
  if (mode === "ollama") engine = ollamaOk ? "ollama" : "rules";
  else if (mode === "transformers") engine = isTransformersReady() ? "transformers" : "rules";
  else if (mode === "rules") engine = "rules";
  else engine = ollamaOk ? "ollama" : isTransformersReady() ? "transformers" : "rules";

  const labels: Record<EngineId, string> = {
    ollama: `Ollama · ${settings.gemmaModel}`,
    transformers: `transformers.js · ${TRANSFORMERS_MODEL.split("/")[1]}`,
    rules: "Rule engine (no model loaded)",
    none: "Unavailable",
  };
  setGemma({
    engine,
    label: labels[engine],
    model: engine === "transformers" ? TRANSFORMERS_MODEL : settings.gemmaModel,
    status: engine === "rules" ? "fallback" : "ready",
    ollamaReachable: reachable,
    installedModels: installed,
  });
  return st;
}

interface OllamaGen {
  content: string;
  evalCount: number;
  evalDurationNs: number;
  totalDurationNs: number;
  model: string;
}

async function viaOllama(messages: ChatMessage[], json: boolean, maxTokens: number, model: string): Promise<GenResult> {
  const t0 = performance.now();
  const res = await fetch("/api/gemma/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages, json, maxTokens }),
  });
  const data = (await res.json()) as OllamaGen & { error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? `Ollama error ${res.status}`);
  const ms = Math.round(performance.now() - t0);
  const tps = data.evalDurationNs > 0 ? data.evalCount / (data.evalDurationNs / 1e9) : null;
  useAppStore.getState().setGemma({ lastLatencyMs: ms, tokensPerSec: tps ? Math.round(tps * 10) / 10 : null });
  return { text: data.content, engine: "ollama", model: data.model, ms, tokens: data.evalCount };
}

/**
 * Runs inference on the best available local engine. Returns null when only the rule engine
 * is available, so callers fall back to deterministic logic.
 */
export async function generate(messages: ChatMessage[], opts: { json?: boolean; maxTokens?: number } = {}): Promise<GenResult | null> {
  const { gemma, settings, pushLog } = useAppStore.getState();
  const maxTokens = opts.maxTokens ?? 512;
  const attempt = async (engine: EngineId): Promise<GenResult | null> => {
    const t0 = performance.now();
    try {
      if (engine === "ollama") return await viaOllama(messages, opts.json ?? false, maxTokens, settings.gemmaModel);
      if (engine === "transformers") {
        const r = await generateTransformers(messages, maxTokens);
        const ms = Math.round(performance.now() - t0);
        useAppStore.getState().setGemma({ lastLatencyMs: ms, tokensPerSec: Math.round((r.tokens / (ms / 1000)) * 10) / 10 });
        return { text: r.text, engine, model: TRANSFORMERS_MODEL, ms, tokens: r.tokens };
      }
    } catch (e) {
      pushLog({ level: "error", message: `${engine} inference failed: ${errorMessage(e)}` });
    }
    return null;
  };

  if (gemma.engine === "none" || gemma.status === "checking") await refreshGemmaStatus();
  const engine = useAppStore.getState().gemma.engine;
  if (engine === "ollama") {
    const r = await attempt("ollama");
    if (r) return r;
    if (settings.engineMode === "auto" && isTransformersReady()) {
      pushLog({ level: "info", message: "Ollama unavailable → falling back to in-browser transformers.js" });
      const t = await attempt("transformers");
      if (t) return t;
    }
    useAppStore.getState().setGemma({ engine: "rules", label: "Rule engine (no model loaded)", status: "fallback" });
    return null;
  }
  if (engine === "transformers") return attempt("transformers");
  return null;
}

export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
