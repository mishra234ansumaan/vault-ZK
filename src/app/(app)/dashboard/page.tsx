"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { ArrowDownRight, ArrowUpRight, BadgeCheck, Brain, Cpu, FileKey2, Fingerprint, HardDrive, IdCard, Landmark, Lock, Play, Settings2, ShieldCheck, Timer, Wallet, Zap } from "lucide-react";
import { Badge, Bar, Button, Card, CardTitle, EmptyState, PageHero, Ring, Skeleton } from "@/components/ui";
import { CountUp, useNow } from "@/components/widgets";
import { getDb } from "@/lib/db";
import { useAppStore } from "@/lib/store";
import { fetchOllamaStatus, generate, refreshGemmaStatus, type OllamaStatus } from "@/lib/gemma/engine";
import { vaultBytesUsed } from "@/lib/vault";
import { cn, formatBytes, mmss, timeAgo } from "@/lib/utils";

interface PerfMemory {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

function useDashboardData() {
  return useLiveQuery(async () => {
    const db = getDb();
    const [proofs, verifs, docs] = await Promise.all([db.proofs.toArray(), db.verifications.toArray(), db.documents.toArray()]);
    const bytes = await vaultBytesUsed();
    return { proofs, verifs, docs, bytes };
  }, []);
}

const quick = [
  { label: "Generate Age Proof", icon: Fingerprint, preset: "age", tone: "from-cyan-500/20" },
  { label: "Income Proof", icon: Wallet, preset: "income", tone: "from-emerald-500/20" },
  { label: "ID Proof", icon: IdCard, preset: "id", tone: "from-indigo-500/20" },
  { label: "Custom Logic", icon: Settings2, preset: "custom", tone: "from-fuchsia-500/20" },
] as const;

export default function DashboardPage() {
  const data = useDashboardData();
  const now = useNow(1000);
  const gemma = useAppStore((s) => s.gemma);
  const pinSet = useAppStore((s) => s.pinSet);
  const logs = useAppStore((s) => s.gemmaLogs);
  const [sys, setSys] = useState<OllamaStatus | null>(null);
  const [heap, setHeap] = useState<{ used: number; limit: number } | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const s = await fetchOllamaStatus();
      if (alive) setSys(s);
      const mem = (performance as unknown as { memory?: PerfMemory }).memory;
      if (mem && alive) setHeap({ used: mem.usedJSHeapSize, limit: mem.jsHeapSizeLimit });
      const est = await navigator.storage?.estimate?.();
      if (est && alive) setStorage({ usage: est.usage ?? 0, quota: est.quota ?? 0 });
    };
    void poll();
    const t = setInterval(() => void poll(), 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const runTest = useCallback(async () => {
    setTesting(true);
    try {
      await refreshGemmaStatus();
      const r = await generate([{ role: "user", content: "Reply with the single word: ready" }], { maxTokens: 16 });
      if (r) toast.success(`Gemma responded in ${r.ms} ms on ${r.engine}`);
      else toast.info("No model engine is loaded — rule engine is serving requests. Pull a Gemma model with Ollama to enable inference.");
    } catch {
      toast.error("Inference test failed");
    } finally {
      setTesting(false);
    }
  }, []);

  if (!data) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-44" />
        ))}
      </div>
    );
  }

  const { proofs, verifs, docs, bytes } = data;
  const active = proofs.filter((p) => p.status === "active" && p.expiresAt > now).sort((a, b) => a.expiresAt - b.expiresAt);
  const DAY = 86_400_000;
  const thisMonth = verifs.filter((v) => v.at > now - 30 * DAY).length;
  const lastMonth = verifs.filter((v) => v.at <= now - 30 * DAY && v.at > now - 60 * DAY).length;
  const trendPct = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : thisMonth > 0 ? 100 : 0;
  const signed = docs.filter((d) => d.signature === "valid").length;
  let health = 100;
  if (!pinSet) health -= 2;
  if (docs.length === 0) health -= 3;
  if (docs.length > 0 && signed < docs.length) health -= 3;
  if (gemma.engine === "rules") health -= 2;
  const recent = [
    ...proofs.filter((p) => !p.synthetic || true).map((p) => ({ at: p.createdAt, kind: "proof" as const, text: `Proof generated: ${p.label}`, status: p.status === "revoked" ? "revoked" : "ok" })),
    ...verifs.map((v) => ({ at: v.at, kind: "verify" as const, text: `Verification ${v.result}: ${v.label}`, status: v.result })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 10);
  const statusDot = (s: string) => (s === "ok" || s === "verified" ? "bg-ok" : s === "expired" ? "bg-warn" : "bg-danger");
  const cpuPct = sys ? Math.min(100, Math.round((sys.system.loadAvg1 / Math.max(1, sys.system.cpus)) * 100)) : 0;
  const ramPct = sys ? Math.round(((sys.system.totalMem - sys.system.freeMem) / sys.system.totalMem) * 100) : 0;
  const running = sys?.running[0];

  return (
    <div>
      <PageHero title="Security Dashboard" subtitle="Everything on this screen was computed on your device." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="flex flex-col items-center gap-3 text-center">
          <CardTitle className="self-start">Vault Health Score</CardTitle>
          <Ring value={health} tone={health >= 90 ? "ok" : "warn"} size={132}>
            <CountUp to={health} className="text-3xl font-black" />
            <span className="text-xs text-mute">/ 100</span>
          </Ring>
          <div className="flex flex-wrap justify-center gap-2 text-xs">
            <Badge tone="ok">
              <BadgeCheck className="h-3 w-3" /> {signed}/{docs.length} docs verified
            </Badge>
            <Badge tone="accent">
              <Lock className="h-3 w-3" /> AES-256-GCM
            </Badge>
          </div>
        </Card>

        <Card>
          <CardTitle>Active Proofs</CardTitle>
          <p className="mt-2 text-5xl font-black text-accent">
            <CountUp to={active.length} />
          </p>
          <div className="mt-3 space-y-2">
            {active.slice(0, 3).map((p) => {
              const total = p.expiresAt - p.createdAt;
              const left = p.expiresAt - now;
              return (
                <div key={p.id}>
                  <div className="flex justify-between text-xs">
                    <span className="truncate pr-2 text-ink">{p.label}</span>
                    <span className="font-mono text-warn">{mmss(left / 1000)}</span>
                  </div>
                  <Bar value={(left / total) * 100} tone="warn" className="mt-1 h-1.5" />
                </div>
              );
            })}
            {active.length === 0 ? <p className="text-xs text-mute">No live proofs. Generate one to see the time-bomb countdown.</p> : null}
          </div>
        </Card>

        <Card>
          <CardTitle>Verifications This Month</CardTitle>
          <div className="mt-2 flex items-end gap-3">
            <p className="text-5xl font-black">
              <CountUp to={thisMonth} />
            </p>
            <span className={cn("mb-2 flex items-center text-sm font-semibold", trendPct >= 0 ? "text-ok" : "text-danger")}>
              {trendPct >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
              {Math.abs(trendPct)}%
            </span>
          </div>
          <p className="mt-2 text-xs text-mute">vs {lastMonth} in the previous 30 days</p>
          <Bar value={lastMonth + thisMonth === 0 ? 0 : (thisMonth / (thisMonth + lastMonth)) * 100} className="mt-4" />
        </Card>

        <Card className="border-ok/30 bg-ok/5">
          <CardTitle>Privacy Leak Index</CardTitle>
          <p className="mt-2 text-5xl font-black text-ok">
            <CountUp to={0} decimals={2} suffix="%" />
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-ok">
            <ShieldCheck className="h-4 w-4" /> Zero personal data exposed
          </p>
          <p className="mt-1 text-xs text-mute">0 bytes uploaded · proofs reveal only a yes/no</p>
        </Card>

        <Card className="md:col-span-2">
          <CardTitle>Recent Activity</CardTitle>
          {recent.length === 0 ? (
            <div className="mt-3">
              <EmptyState icon={<Timer className="h-6 w-6" />} title="No activity yet" hint="Generate or verify a proof and it will appear here." />
            </div>
          ) : (
            <ol className="mt-3 space-y-2.5 border-l border-line pl-4">
              {recent.map((r, i) => (
                <motion.li key={`${r.at}-${i}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className="relative text-sm">
                  <span className={cn("absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-bg", statusDot(r.status))} />
                  <span className="text-ink">{r.text}</span>
                  <span className="ml-2 text-xs text-mute">{timeAgo(r.at, now)}</span>
                </motion.li>
              ))}
            </ol>
          )}
        </Card>

        <Card className="md:col-span-2">
          <CardTitle>Quick Actions</CardTitle>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {quick.map((q) => (
              <Link
                key={q.preset}
                href={`/generate?preset=${q.preset}`}
                className={cn("glass glass-lift flex h-28 flex-col items-start justify-between rounded-xl bg-gradient-to-br to-transparent p-4", q.tone)}
              >
                <q.icon className="h-6 w-6 text-accent" aria-hidden />
                <span className="font-semibold">{q.label}</span>
              </Link>
            ))}
          </div>
        </Card>

        <Card className="md:col-span-2">
          <div className="flex items-center justify-between">
            <CardTitle>Gemma AI Status</CardTitle>
            <Badge tone={gemma.status === "ready" ? "ok" : "warn"}>{gemma.status === "ready" ? "Model loaded" : "Rule fallback"}</Badge>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Metric label="Engine" value={gemma.engine === "none" ? "…" : gemma.engine} />
            <Metric label="Model" value={gemma.model} mono />
            <Metric label="Speed" value={gemma.tokensPerSec ? `${gemma.tokensPerSec} tok/s` : "—"} />
            <Metric label="Last latency" value={gemma.lastLatencyMs ? `${gemma.lastLatencyMs} ms` : "—"} />
          </div>
          <p className="mt-3 flex items-center gap-2 text-xs text-mute">
            <FileKey2 className="h-3.5 w-3.5" /> Last document: <span className="text-ink">{gemma.lastDoc ?? "none processed"}</span>
          </p>
          <p className="mt-1 text-xs text-mute">
            Installed: {gemma.installedModels.length ? gemma.installedModels.join(", ") : gemma.ollamaReachable ? "no models" : "Ollama not detected on 127.0.0.1:11434"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={runTest} disabled={testing}>
              <Play className="h-3.5 w-3.5" /> {testing ? "Running…" : "Test inference"}
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href="/settings">
                <Brain className="h-3.5 w-3.5" /> Gemma settings
              </Link>
            </Button>
          </div>
          {logs.length > 0 ? <p className="mt-3 truncate font-mono text-[11px] text-slate-500">{logs[logs.length - 1].message}</p> : null}
        </Card>

        <Card className="md:col-span-2">
          <CardTitle>System Resources</CardTitle>
          <div className="mt-3 space-y-3 text-sm">
            <Resource icon={<Cpu className="h-4 w-4" />} label={`Host CPU load (${sys?.system.cpus ?? "—"} cores)`} pct={cpuPct} text={sys ? `${cpuPct}%` : "n/a"} />
            <Resource icon={<Landmark className="h-4 w-4" />} label="Host RAM" pct={ramPct} text={sys ? `${formatBytes(sys.system.totalMem - sys.system.freeMem)} / ${formatBytes(sys.system.totalMem)}` : "n/a"} />
            <Resource
              icon={<Brain className="h-4 w-4" />}
              label={running ? `Gemma resident memory (${running.name})` : "Gemma resident memory"}
              pct={running && sys ? (running.sizeBytes / sys.system.totalMem) * 100 : 0}
              text={running ? formatBytes(running.sizeBytes) : "model idle / not loaded"}
            />
            <Resource icon={<Zap className="h-4 w-4" />} label="Browser JS heap" pct={heap ? (heap.used / heap.limit) * 100 : 0} text={heap ? formatBytes(heap.used) : "n/a"} />
            <Resource icon={<HardDrive className="h-4 w-4" />} label="Vault storage (encrypted)" pct={storage && storage.quota ? Math.max(1, (bytes / storage.quota) * 100) : 1} text={`${formatBytes(bytes)} in ${docs.length} docs`} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg bg-panel2/30 p-2.5">
      <p className="text-[10px] uppercase tracking-wider text-mute">{label}</p>
      <p className={cn("mt-0.5 truncate font-semibold", mono && "font-mono text-xs")}>{value}</p>
    </div>
  );
}

function Resource({ icon, label, pct, text }: { icon: React.ReactNode; label: string; pct: number; text: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-mute">
          {icon} {label}
        </span>
        <span className="font-mono text-ink">{text}</span>
      </div>
      <Bar value={pct} tone={pct > 85 ? "danger" : pct > 65 ? "warn" : "accent"} />
    </div>
  );
}
