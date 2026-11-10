import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ model: z.string().min(1).max(80) });

/** Streams `ollama pull` progress (NDJSON) so Settings can show a download bar. Requires internet once. */
export async function POST(req: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const host = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
  try {
    const upstream = await fetch(`${host}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: parsed.data.model, stream: true }),
    });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: `Ollama responded ${upstream.status}` }, { status: 502 });
    }
    return new Response(upstream.body, { headers: { "content-type": "application/x-ndjson" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ollama unreachable" }, { status: 502 });
  }
}
