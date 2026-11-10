import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  model: z.string().min(1).max(80),
  messages: z
    .array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string().max(20000) }))
    .min(1)
    .max(20),
  json: z.boolean().optional(),
  maxTokens: z.number().int().min(16).max(2048).optional(),
});

interface OllamaChatResponse {
  message?: { content?: string };
  eval_count?: number;
  eval_duration?: number;
  total_duration?: number;
  model?: string;
  error?: string;
}

/**
 * Loopback proxy to the LOCAL Ollama daemon (OLLAMA_HOST, default 127.0.0.1:11434).
 * The browser talks to this route on the same machine; nothing leaves the device.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const { model, messages, json, maxTokens } = parsed.data;
  const host = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const res = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        ...(json ? { format: "json" } : {}),
        options: { temperature: 0.1, num_predict: maxTokens ?? 512 },
      }),
      signal: ctrl.signal,
    });
    const data = (await res.json()) as OllamaChatResponse;
    if (!res.ok || data.error) {
      return NextResponse.json({ error: data.error ?? `Ollama responded ${res.status}` }, { status: 502 });
    }
    return NextResponse.json({
      content: data.message?.content ?? "",
      evalCount: data.eval_count ?? 0,
      evalDurationNs: data.eval_duration ?? 0,
      totalDurationNs: data.total_duration ?? 0,
      model: data.model ?? model,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ollama unreachable";
    return NextResponse.json({ error: `Ollama unreachable: ${msg}` }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
