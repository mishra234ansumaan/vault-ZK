import { NextResponse } from "next/server";
import os from "node:os";

export const dynamic = "force-dynamic";

interface OllamaTags {
  models?: Array<{ name: string; size: number; details?: { quantization_level?: string; parameter_size?: string; family?: string } }>;
}
interface OllamaPs {
  models?: Array<{ name: string; size: number; size_vram?: number }>;
}

async function getJson<T>(url: string): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(): Promise<NextResponse> {
  const host = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
  const [tags, ps] = await Promise.all([getJson<OllamaTags>(`${host}/api/tags`), getJson<OllamaPs>(`${host}/api/ps`)]);
  return NextResponse.json({
    reachable: tags !== null,
    host,
    models: (tags?.models ?? []).map((m) => ({
      name: m.name,
      sizeBytes: m.size,
      quantization: m.details?.quantization_level ?? "unknown",
      parameterSize: m.details?.parameter_size ?? "unknown",
      family: m.details?.family ?? "unknown",
    })),
    running: (ps?.models ?? []).map((m) => ({ name: m.name, sizeBytes: m.size, sizeVram: m.size_vram ?? 0 })),
    system: {
      cpus: os.cpus().length,
      loadAvg1: os.loadavg()[0],
      totalMem: os.totalmem(),
      freeMem: os.freemem(),
      rss: process.memoryUsage().rss,
    },
    defaultModel: process.env.OLLAMA_MODEL ?? "gemma2:2b",
  });
}
