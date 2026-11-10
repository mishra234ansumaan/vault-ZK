"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { BatteryCharging, Beaker, Bluetooth, Gauge, Globe2, Mountain, Music2, Nfc, PlaneTakeoff, ShieldAlert, ShieldCheck, ShieldX, SignalZero, Siren, WifiOff, Zap } from "lucide-react";
import { Badge, Button, Card, CardTitle, EmptyState, PageHero, Select, Slider } from "@/components/ui";
import { useOnline } from "@/components/gemma-parts";
import { getDb } from "@/lib/db";
import { generateExampleProof, verifyPayloadText, type VerifyOutcome } from "@/lib/proofs";
import { cn, errorMessage } from "@/lib/utils";

const NFC_KBPS = 424;

type Phase = "idle" | "transmitting" | "verifying" | "done" | "failed";

interface Metrics {
  txMs: number;
  verifyMs: number;
  bytes: number;
}

declare global {
  interface Window {
    NDEFReader?: new () => { write(message: { records: Array<{ recordType: string; mediaType?: string; data: Uint8Array }> }): Promise<void> };
  }
}

function Phone({ title, children, glow }: { title: string; children: React.ReactNode; glow?: boolean }) {
  return (
    <div className={cn("relative mx-auto h-[360px] w-[190px] rounded-[2.2rem] border-4 border-slate-600 bg-slate-950 p-2 shadow-2xl transition", glow && "shadow-[0_0_50px_-8px_var(--accent)]")}>
      <div className="absolute left-1/2 top-2 h-4 w-20 -translate-x-1/2 rounded-full bg-black" aria-hidden />
      <div className="flex h-full flex-col rounded-[1.7rem] bg-gradient-to-b from-slate-900 to-slate-950 px-3 pb-3 pt-8">
        <p className="mb-2 text-center text-[10px] font-bold uppercase tracking-widest text-accent">{title}</p>
        {children}
      </div>
    </div>
  );
}

const USE_CASES = [
  { icon: Music2, title: "Music festivals", text: "50,000 phones, zero signal. Prove age 18+ at the bar without a network." },
  { icon: PlaneTakeoff, title: "International travel", text: "No roaming needed. Prove citizenship and ID validity at a border kiosk." },
  { icon: Mountain, title: "Remote areas", text: "Rural clinics and field offices verify eligibility with no coverage." },
  { icon: Siren, title: "Emergencies", text: "When infrastructure is down, credentials still work peer-to-peer." },
];

const STEPS = [
  { t: "1 · Cache the verification key", d: "A verifier stores the circuit's public verification key once (a few KB). It never changes per proof." },
  { t: "2 · Prover builds the proof", d: "The holder's phone creates a Groth16 proof offline. The expiry and nonce are bound inside it." },
  { t: "3 · Tap transmits ~1 KB", d: "NFC (ISO 14443, 424 kbps) moves the payload in tens of milliseconds, within 4 cm." },
  { t: "4 · Local pairing check", d: "The verifier runs the pairing equation against its cached key and checks expiry and its revocation list — no server." },
];

export default function NfcPage() {
  const online = useOnline();
  const proofs = useLiveQuery(async () => (await getDb().proofs.where("status").equals("active").toArray()).filter((p) => p.payload && p.expiresAt > Date.now()), []);
  const [selected, setSelected] = useState("");
  const [range, setRange] = useState(2);
  const [phase, setPhase] = useState<Phase>("idle");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [outcome, setOutcome] = useState<VerifyOutcome | null>(null);
  const [step, setStep] = useState(0);
  const [demoPayload, setDemoPayload] = useState<string | null>(null);

  useEffect(() => {
    const fromGen = sessionStorage.getItem("vaultzk-nfc-proof");
    if (fromGen) {
      setSelected(fromGen);
      sessionStorage.removeItem("vaultzk-nfc-proof");
    }
  }, []);
  useEffect(() => {
    if (!selected && proofs && proofs.length > 0) setSelected(proofs[0].id);
  }, [proofs, selected]);

  const current = proofs?.find((p) => p.id === selected);
  const payload = current?.payload ?? demoPayload;

  const makeDemo = async () => {
    try {
      setDemoPayload(JSON.stringify(JSON.parse(await generateExampleProof("valid"))));
      toast.success("Demo proof (real Groth16) loaded onto the prover device");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const tap = useCallback(async () => {
    if (!payload) {
      toast.error("Select or generate a proof first.");
      return;
    }
    setOutcome(null);
    setMetrics(null);
    navigator.vibrate?.([30, 20, 30]);
    if (range > 4) {
      setPhase("failed");
      toast.error("Out of range — NFC requires the devices within 4 cm.");
      return;
    }
    const bytes = new TextEncoder().encode(payload).length;
    const txMs = Math.max(1, Math.round(((bytes * 8) / (NFC_KBPS * 1000)) * 1000 + range * 2));
    setPhase("transmitting");
    await new Promise((r) => setTimeout(r, 900));
    setPhase("verifying");
    try {
      const out = await verifyPayloadText(payload);
      await new Promise((r) => setTimeout(r, 350));
      setOutcome(out);
      setMetrics({ txMs, verifyMs: out.ms, bytes });
      setPhase("done");
      navigator.vibrate?.(out.result === "verified" ? 60 : [80, 40, 80]);
    } catch (e) {
      setPhase("failed");
      toast.error(errorMessage(e));
    }
  }, [payload, range]);

  const writeTag = async () => {
    if (!payload) return;
    if (!window.NDEFReader) {
      toast.info("Web NFC is not supported in this browser (Android Chrome only). The simulation above shows the same flow.");
      return;
    }
    try {
      const reader = new window.NDEFReader();
      await reader.write({ records: [{ recordType: "mime", mediaType: "application/vnd.vaultzk.proof+json", data: new TextEncoder().encode(payload) }] });
      toast.success("Proof written to NFC tag");
    } catch (e) {
      toast.error(`Web NFC write failed: ${errorMessage(e)}`);
    }
  };

  const active = phase === "transmitting" || phase === "verifying";

  return (
    <div className="space-y-8">
      <PageHero title="Offline NFC Tap-to-Prove" subtitle="Verify in <200ms. No internet required. Ever." />

      <Card className="flex flex-wrap items-center gap-4 border-ok/30 bg-ok/5">
        <Badge tone="ok" className="px-3 py-1 text-sm">📵 OFFLINE MODE</Badge>
        <span className="relative inline-flex">
          <WifiOff className="h-7 w-7 text-mute" aria-hidden />
          <SignalZero className="absolute -right-2 -top-2 h-4 w-4 text-danger" aria-hidden />
        </span>
        <p className="font-mono text-sm">Internet connectivity used by this tap: <span className="font-bold text-ok">0 Kbps</span></p>
        <span className="text-xs text-mute">Browser link state: {online ? "network present (unused)" : "no network"}</span>
      </Card>

      <Card>
        <div className="grid items-center gap-6 lg:grid-cols-[1fr_1.2fr_1fr]">
          <Phone title="Prover · VaultZK" glow={active}>
            <div className="flex flex-1 flex-col items-center justify-between">
              <div className="w-full rounded-lg border border-line bg-panel/60 p-2 text-center">
                <p className="text-[9px] uppercase text-mute">Selected proof</p>
                <p className="mt-0.5 line-clamp-3 text-[11px] font-semibold">{current?.label ?? (demoPayload ? "Balance ≥ $50,000 (demo)" : "None selected")}</p>
              </div>
              <div className="relative flex h-20 w-20 items-center justify-center">
                {payload ? <span className="absolute inset-0 animate-pulse-ring rounded-full border-2 border-accent" /> : null}
                <Nfc className={cn("h-10 w-10", payload ? "text-accent" : "text-slate-600")} aria-hidden />
              </div>
              <Badge tone={phase === "transmitting" ? "accent" : payload ? "ok" : "neutral"}>{phase === "transmitting" ? "Transmitting…" : payload ? "Ready to transmit" : "No proof"}</Badge>
            </div>
          </Phone>

          <div className="relative flex h-56 flex-col items-center justify-center" aria-label="NFC transmission field">
            <svg viewBox="0 0 300 120" className="w-full" aria-hidden>
              {active || phase === "done"
                ? [0, 1, 2].map((i) => (
                    <motion.circle key={i} cx="40" cy="60" r="10" className="fill-none stroke-accent" strokeWidth="2" initial={{ r: 10, opacity: 0.9 }} animate={{ r: 90, opacity: 0 }} transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.6 }} />
                  ))
                : null}
              <line x1="40" y1="60" x2="260" y2="60" className="stroke-line" strokeDasharray="4 6" />
              {phase === "transmitting"
                ? [0, 1, 2, 3, 4].map((i) => (
                    <motion.rect key={i} y="56" width="8" height="8" rx="2" className="fill-ok" initial={{ x: 40, opacity: 0 }} animate={{ x: 250, opacity: [0, 1, 1, 0] }} transition={{ duration: 0.9, delay: i * 0.12, ease: "easeInOut" }} />
                  ))
                : null}
              <Nfc x="28" y="48" width="24" height="24" className="text-accent" />
              <Nfc x="248" y="48" width="24" height="24" className={phase === "done" ? "text-ok" : "text-slate-600"} />
            </svg>
            <Badge tone={active ? "accent" : "neutral"} className="mt-2">{active ? "● NFC Field Active" : "NFC field idle"}</Badge>
            <p className={cn("mt-2 font-mono text-2xl font-black", range > 4 ? "text-danger" : "text-ink")}>{range} cm</p>
            <p className="text-xs text-mute">{NFC_KBPS} kbps · ISO 14443 / 13.56 MHz</p>
          </div>

          <Phone title="Verifier terminal" glow={phase === "done" && outcome?.result === "verified"}>
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <AnimatePresence mode="wait">
                {phase === "done" && outcome ? (
                  <motion.div key="res" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="space-y-2">
                    {outcome.result === "verified" ? <ShieldCheck className="mx-auto h-16 w-16 text-ok" /> : <ShieldX className="mx-auto h-16 w-16 text-danger" />}
                    <p className={cn("text-sm font-black", outcome.result === "verified" ? "text-ok" : "text-danger")}>{outcome.result === "verified" ? "VERIFIED" : outcome.result.toUpperCase()}</p>
                    <p className="text-[11px] text-ink">{outcome.label}</p>
                  </motion.div>
                ) : phase === "failed" ? (
                  <motion.div key="fail" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="space-y-2">
                    <ShieldAlert className="mx-auto h-14 w-14 text-warn" />
                    <p className="text-xs font-bold text-warn">No signal — move within 4 cm</p>
                  </motion.div>
                ) : phase === "verifying" ? (
                  <motion.p key="ver" className="text-xs text-accent" animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 0.8, repeat: Infinity }}>Checking pairing equation…</motion.p>
                ) : (
                  <motion.div key="wait" className="space-y-2">
                    <Nfc className="mx-auto h-12 w-12 animate-pulse text-slate-600" />
                    <p className="text-xs text-mute">{phase === "transmitting" ? "Receiving…" : "Awaiting signal"}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </Phone>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-5">
          <CardTitle>Control panel</CardTitle>
          <div>
            <label htmlFor="proof-sel" className="mb-1.5 block text-xs font-medium text-mute">Proof on prover device</label>
            {proofs && proofs.length > 0 ? (
              <Select id="proof-sel" value={selected} onChange={(e) => setSelected(e.target.value)}>
                {proofs.map((p) => (
                  <option key={p.id} value={p.id}>{p.label} — {p.id}</option>
                ))}
              </Select>
            ) : (
              <EmptyState icon={<Zap className="h-6 w-6" />} title="No live proofs on this device" hint="Generate one in Generate Proof, or load a real demo proof." action={<Button variant="outline" size="sm" onClick={() => void makeDemo()}><Beaker className="h-4 w-4" /> Load demo proof</Button>} />
            )}
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium text-mute">Distance between devices</span>
              <span className={cn("font-mono font-bold", range > 4 ? "text-danger" : "text-ok")}>{range} cm {range > 4 ? "(out of NFC range)" : ""}</span>
            </div>
            <Slider min={0} max={10} step={1} value={[range]} onValueChange={([n]) => setRange(n)} aria-label="Distance in centimetres" />
          </div>
          <div className="flex items-center gap-2 text-sm text-mute"><Gauge className="h-4 w-4 text-accent" /> Transmission speed: <span className="font-mono text-ink">{NFC_KBPS} kbps</span> (NFC standard)</div>
          <motion.div whileTap={{ scale: 0.96 }}>
            <Button size="xl" className="w-full" onClick={() => void tap()} disabled={active || !payload} aria-label="Simulate NFC tap">
              🤝 SIMULATE NFC TAP
            </Button>
          </motion.div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void writeTag()} disabled={!payload}><Nfc className="h-4 w-4" /> Write to NFC tag (Web NFC)</Button>
            <Badge tone="neutral"><Bluetooth className="h-3 w-3" /> Bluetooth LE fallback &gt; 4 cm (roadmap)</Badge>
          </div>
        </Card>

        <Card>
          <CardTitle>Result</CardTitle>
          {metrics && outcome ? (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl bg-panel2/30 p-3"><p className="text-2xl font-black text-accent">{metrics.txMs}<span className="text-sm"> ms</span></p><p className="text-[11px] text-mute">Transmitted ({metrics.bytes} B @ {NFC_KBPS} kbps)</p></div>
                <div className="rounded-xl bg-panel2/30 p-3"><p className="text-2xl font-black text-ok">{metrics.verifyMs}<span className="text-sm"> ms</span></p><p className="text-[11px] text-mute">Verified (measured)</p></div>
                <div className="rounded-xl bg-panel2/30 p-3"><p className={cn("text-2xl font-black", metrics.txMs + metrics.verifyMs < 200 ? "text-ok" : "text-warn")}>{metrics.txMs + metrics.verifyMs}<span className="text-sm"> ms</span></p><p className="text-[11px] text-mute">Total {metrics.txMs + metrics.verifyMs < 200 ? "(< 200 ms ✓)" : ""}</p></div>
              </div>
              <p className="rounded-lg border border-line bg-bg/50 p-3 text-sm">
                <span className={cn("font-bold", outcome.result === "verified" ? "text-ok" : "text-danger")}>{outcome.result.toUpperCase()}</span> — {outcome.reason}
              </p>
              <p className="flex items-center gap-2 text-sm text-mute"><BatteryCharging className="h-4 w-4 text-ok" /> Battery impact: &lt;0.01% (NFC radio active for ~{metrics.txMs} ms; estimate)</p>
              <p className="text-xs text-slate-500">Transmission time is computed from payload size at the NFC data rate; verification time is the real Groth16 pairing check running in this tab.</p>
            </motion.div>
          ) : (
            <p className="mt-4 text-sm text-mute">Tap to see transmission and verification latency. Place devices ≤ 4 cm apart.</p>
          )}
        </Card>
      </div>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">How does offline verification work?</h2>
        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <div className="space-y-2">
            {STEPS.map((s, i) => (
              <button key={s.t} onClick={() => setStep(i)} aria-pressed={step === i} className={cn("w-full rounded-xl border p-4 text-left transition", step === i ? "border-accent bg-accent/10" : "border-line bg-panel/30 hover:border-accent/40")}>
                <p className="font-semibold">{s.t}</p>
                <AnimatePresence initial={false}>
                  {step === i ? <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pt-1 text-sm text-mute">{s.d}</motion.p> : null}
                </AnimatePresence>
              </button>
            ))}
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wider text-mute"><th className="py-2"></th><th>Online verification</th><th className="text-accent">VaultZK offline</th></tr></thead>
              <tbody className="divide-y divide-line/60">
                {[
                  ["Needs internet", "Yes", "No"],
                  ["Latency", "300 ms – seconds", "< 200 ms"],
                  ["Server sees who verified", "Yes", "No server"],
                  ["Works at a festival / border", "Rarely", "Always"],
                  ["Personal data shared", "Often a full ID", "Nothing"],
                  ["Revocation", "Live lookup", "Gossiped list (cached)"],
                ].map(([k, a, b]) => (
                  <tr key={k}><td className="py-2.5 font-medium">{k}</td><td className="text-mute">{a}</td><td className="font-semibold text-ok">{b}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-2xl font-bold"><Globe2 className="h-6 w-6 text-accent" /> Real-world use cases</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {USE_CASES.map((u) => (
            <Card key={u.title} className="glass-lift">
              <u.icon className="h-8 w-8 text-accent" aria-hidden />
              <p className="mt-3 font-semibold">{u.title}</p>
              <p className="mt-1 text-sm text-mute">{u.text}</p>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
