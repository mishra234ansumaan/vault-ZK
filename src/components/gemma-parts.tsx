"use client";

import { useEffect, useRef, useState } from "react";
import { Brain, Terminal, Trash2 } from "lucide-react";
import { useAppStore, type GemmaLogEntry } from "@/lib/store";
import { Badge, Button, Tip } from "@/components/ui";
import { cn } from "@/lib/utils";

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function GemmaStatusPill({ compact = false }: { compact?: boolean }) {
  const g = useAppStore((s) => s.gemma);
  const tone = g.status === "ready" ? "ok" : g.status === "fallback" ? "warn" : g.status === "error" ? "danger" : "neutral";
  const dot = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", neutral: "bg-slate-500" }[tone];
  const detail = `${g.label}${g.tokensPerSec ? ` · ${g.tokensPerSec} tok/s` : ""}${g.lastLatencyMs ? ` · last ${g.lastLatencyMs} ms` : ""}`;
  return (
    <Tip label={detail}>
      <span tabIndex={0} className="inline-flex cursor-default" aria-label={`Gemma status: ${detail}`}>
        <Badge tone={tone} className="gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", dot, g.status === "ready" && "animate-pulse")} />
          <Brain className="h-3 w-3" aria-hidden />
          {compact ? "Gemma" : g.engine === "rules" ? "Gemma · rule fallback" : g.engine === "none" ? "Gemma …" : `Gemma · ${g.engine}`}
        </Badge>
      </span>
    </Tip>
  );
}

const levelStyle: Record<GemmaLogEntry["level"], string> = {
  info: "text-slate-400",
  tool: "text-accent",
  result: "text-ok",
  error: "text-danger",
  inference: "text-fuchsia-300",
};

function ts(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleTimeString("en-GB")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

/** Live Gemma tool-call console. Every tool call is timestamped here. */
export function GemmaConsole({ className, height = "h-64" }: { className?: string; height?: string }) {
  const logs = useAppStore((s) => s.gemmaLogs);
  const clear = useAppStore((s) => s.clearLogs);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [logs.length]);
  return (
    <div className={cn("overflow-hidden rounded-xl border border-line bg-black/60", className)}>
      <div className="flex items-center justify-between border-b border-line bg-panel/60 px-3 py-1.5">
        <span className="flex items-center gap-2 font-mono text-xs text-mute">
          <Terminal className="h-3.5 w-3.5 text-accent" aria-hidden /> gemma-agent://tool-calls
        </span>
        <Button variant="ghost" size="sm" onClick={clear} aria-label="Clear Gemma console" className="h-6 px-2 text-xs">
          <Trash2 className="h-3 w-3" /> Clear
        </Button>
      </div>
      <div ref={ref} className={cn("overflow-y-auto p-3 font-mono text-xs leading-relaxed", height)} role="log" aria-live="polite">
        {logs.length === 0 ? (
          <p className="text-slate-600">No Gemma activity yet. Upload a document or ask the privacy advisor.</p>
        ) : (
          logs.map((l) => (
            <div key={l.id} className={cn("flex gap-2", levelStyle[l.level])}>
              <span className="shrink-0 text-slate-600">{ts(l.at)}</span>
              <span className="break-all">
                {l.message}
                {l.ms !== undefined ? <span className="text-slate-500"> [{l.ms}ms]</span> : null}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
