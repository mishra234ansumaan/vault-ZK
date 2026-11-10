"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, Brain, Cloud, FileText, Lock, Nfc, Pause, Play, ScanSearch, ShieldCheck, Sparkles, Wifi, WifiOff, Zap, Fingerprint, ScrollText, ShieldAlert, BarChart3 } from "lucide-react";
import { Badge, Button, Dialog, DialogContent } from "@/components/ui";
import { Logo } from "@/components/shell";
import { CountUp } from "@/components/widgets";
import { useOnline } from "@/components/gemma-parts";
import { useAppStore } from "@/lib/store";
import { DOCS_URL, REPO_URL, SKILL_URL, TEAM_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

function Github({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.76 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.59.23 2.76.11 3.05.74.8 1.18 1.82 1.18 3.08 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

const PHRASES = ["Prove your age without showing your birthdate", "Prove your income without exposing your balance", "Prove your identity without leaking your name"];

function useTyping(phrases: string[]): string {
  const [i, setI] = useState(0);
  const [n, setN] = useState(0);
  const [del, setDel] = useState(false);
  useEffect(() => {
    const full = phrases[i];
    const t = setTimeout(
      () => {
        if (!del && n < full.length) setN(n + 1);
        else if (!del) setDel(true);
        else if (n > 0) setN(n - 1);
        else {
          setDel(false);
          setI((i + 1) % phrases.length);
        }
      },
      !del && n === full.length ? 1600 : del ? 22 : 45,
    );
    return () => clearTimeout(t);
  }, [n, del, i, phrases]);
  return phrases[i].slice(0, n);
}

const SCENES = [
  { icon: FileText, title: "0:00 · Drop a signed bank statement", text: "Gemma parses it on-device. Tesseract OCR and the agent run with Wi-Fi off." },
  { icon: Brain, title: "0:10 · Tool calls, live", text: "parseDocumentOffline → validateGovernmentSignature. Every call is timestamped in the console." },
  { icon: Lock, title: "0:20 · AES-256-GCM seal", text: "A forged copy is rejected on signature mismatch. The real one is encrypted into IndexedDB." },
  { icon: Zap, title: "0:30 · Generate a Groth16 proof", text: "“Balance ≥ $50,000”, 60-second time-bomb. The QR carries a real SNARK, not the balance." },
  { icon: ScanSearch, title: "0:40 · Verify with any camera", text: "Pairing check in ~30 ms. Confetti — and zero data disclosed." },
  { icon: ShieldAlert, title: "0:50 · Panic button", text: "One click revokes every live proof. Verifying again says REVOKED." },
];

function DemoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!open) {
      setT(0);
      setPlaying(true);
      return;
    }
    if (!playing) return;
    const id = setInterval(() => setT((x) => (x >= 60 ? 0 : x + 0.1)), 100);
    return () => clearInterval(id);
  }, [open, playing]);
  const scene = Math.min(SCENES.length - 1, Math.floor(t / 10));
  const S = SCENES[scene];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="60-second demo" description="An animated walkthrough of the judge flow." className="max-w-xl">
        <div className="relative overflow-hidden rounded-xl border border-line bg-bg p-6">
          <AnimatePresence mode="wait">
            <motion.div key={scene} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="flex flex-col items-center gap-4 text-center">
              <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-accent/15 text-accent"><S.icon className="h-10 w-10" /></span>
              <h3 className="text-xl font-bold">{S.title}</h3>
              <p className="max-w-sm text-sm text-mute">{S.text}</p>
            </motion.div>
          </AnimatePresence>
          <svg className="mt-6 h-1.5 w-full overflow-hidden rounded-full" viewBox="0 0 60 1" preserveAspectRatio="none" role="progressbar" aria-valuenow={Math.round(t)} aria-valuemax={60}>
            <rect width="60" height="1" className="fill-panel2" />
            <rect width={t} height="1" className="fill-accent" />
          </svg>
          <div className="mt-3 flex items-center justify-between text-xs text-mute">
            <span className="font-mono">{Math.floor(t)}s / 60s</span>
            <Button size="sm" variant="ghost" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause demo" : "Play demo"}>{playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}</Button>
          </div>
        </div>
        <Button className="mt-4 w-full" asChild><Link href="/dashboard">Try it live <ArrowRight className="h-4 w-4" /></Link></Button>
      </DialogContent>
    </Dialog>
  );
}

const FEATURES = [
  { icon: Brain, title: "Local Gemma AI", text: "An on-device Gemma agent calls four structured tools to parse documents, validate signatures, minimise disclosure and explain proofs. No cloud API wrappers.", tag: "Ollama · transformers.js" },
  { icon: ShieldCheck, title: "Real ZK-SNARKs", text: "Circom circuits compiled to Groth16 proofs with snarkjs. Range proofs, AND/OR logic chaining and time-bomb expiry bound inside the proof.", tag: "Groth16 · BN254" },
  { icon: Nfc, title: "Offline NFC Tap", text: "Verification needs only a cached key. Tap, transmit ~1 KB at 424 kbps and verify in tens of milliseconds — no internet, ever.", tag: "< 200 ms" },
];

const STEPS = [
  { icon: FileText, title: "Upload document locally", text: "Drop a PDF, photo, Aadhaar XML or PAN. OCR runs in WASM inside your browser." },
  { icon: Brain, title: "Gemma parses on-device", text: "The agent extracts fields, checks the RSA-2048 government signature and rejects forgeries." },
  { icon: Fingerprint, title: "Generate a mathematical proof", text: "Pick a predicate. A Groth16 proof is produced; the verifier learns yes/no and nothing else." },
];

function Architecture() {
  const nodes = [
    { x: 10, label: "Document", sub: "PDF · XML · photo", icon: "📄" },
    { x: 140, label: "OCR", sub: "Tesseract WASM", icon: "🔍" },
    { x: 270, label: "Gemma Agent", sub: "4 tools · Ollama", icon: "🧠" },
    { x: 400, label: "Signature", sub: "RSA-2048 verify", icon: "🔐" },
    { x: 530, label: "AES-256 Vault", sub: "IndexedDB", icon: "🗄️" },
    { x: 660, label: "ZK Prover", sub: "Groth16 · snarkjs", icon: "⚡" },
    { x: 790, label: "QR / NFC", sub: "time-bomb proof", icon: "📲" },
  ];
  return (
    <svg viewBox="0 0 920 230" className="w-full" role="img" aria-label="Architecture: document to OCR to Gemma agent to signature check to encrypted vault to ZK prover to QR or NFC. Cloud is disconnected.">
      <rect x="0" y="0" width="920" height="170" rx="16" className="fill-ok/5 stroke-ok/30" strokeDasharray="6 6" />
      <text x="16" y="22" className="fill-ok text-[11px] font-bold">DEVICE BOUNDARY — everything below runs locally</text>
      {nodes.map((n, i) => (
        <g key={n.label}>
          <rect x={n.x} y="50" width="116" height="84" rx="12" className="fill-panel stroke-accent/60" />
          <text x={n.x + 58} y="80" textAnchor="middle" className="text-[22px]">{n.icon}</text>
          <text x={n.x + 58} y="104" textAnchor="middle" className="fill-ink text-[12px] font-bold">{n.label}</text>
          <text x={n.x + 58} y="120" textAnchor="middle" className="fill-mute text-[9px]">{n.sub}</text>
          {i < nodes.length - 1 ? <path d={`M${n.x + 116} 92 H${nodes[i + 1].x}`} className="animate-flow fill-none stroke-accent stroke-2" strokeDasharray="6 6" /> : null}
        </g>
      ))}
      <g>
        <rect x="360" y="188" width="200" height="38" rx="10" className="fill-danger/10 stroke-danger/50" />
        <text x="460" y="212" textAnchor="middle" className="fill-danger text-[12px] font-bold">☁ CLOUD — 0 bytes</text>
        <path d="M460 134 V186" className="stroke-danger/60" strokeDasharray="3 5" fill="none" />
        <path d="M446 160 L474 174 M474 160 L446 174" className="stroke-danger stroke-2" />
      </g>
    </svg>
  );
}

export default function Landing() {
  const typed = useTyping(PHRASES);
  const [demo, setDemo] = useState(false);
  const [step, setStep] = useState(0);
  const online = useOnline();
  const network = useAppStore((s) => s.network);
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const y1 = useTransform(scrollYProgress, [0, 1], [0, -160]);
  const y2 = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const y3 = useTransform(scrollYProgress, [0, 1], [0, -60]);

  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 4500);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-line/60 bg-bg/70 backdrop-blur-lg">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/" aria-label="VaultZK home"><Logo /></Link>
          <nav aria-label="Landing" className="hidden items-center gap-6 text-sm text-mute md:flex">
            <a href="#features" className="hover:text-ink">Features</a>
            <a href="#how" className="hover:text-ink">How it works</a>
            <a href="#trust" className="hover:text-ink">Trust</a>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-ink"><Github className="h-4 w-4" /> GitHub</a>
          </nav>
          <Button asChild size="sm"><Link href="/dashboard">Enter App <ArrowRight className="h-4 w-4" /></Link></Button>
        </div>
      </header>

      <section ref={heroRef} className="mesh-bg grid-bg relative flex min-h-screen items-center overflow-hidden pt-20">
        <motion.div style={{ y: y1 }} className="absolute left-[8%] top-[22%] h-24 w-24 animate-float rounded-3xl border border-accent/40 bg-accent/10 backdrop-blur" aria-hidden />
        <motion.div style={{ y: y2 }} className="absolute right-[10%] top-[28%] h-32 w-32 animate-float rounded-full border border-ok/40 bg-ok/10 [animation-delay:1.5s]" aria-hidden />
        <motion.div style={{ y: y3 }} className="absolute bottom-[14%] left-[18%] h-16 w-16 rotate-45 animate-float border border-indigo-400/40 bg-indigo-500/10 [animation-delay:3s]" aria-hidden />
        <motion.div style={{ y: y1 }} className="absolute bottom-[22%] right-[20%] h-20 w-20 animate-float rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/10 [animation-delay:2s]" aria-hidden />

        <div className="relative mx-auto w-full max-w-6xl px-4 py-16 text-center sm:px-6">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <Badge tone="accent" className="mb-6 px-3 py-1 text-xs"><Sparkles className="h-3 w-3" /> Gemma on-device agent · MIT licensed · works offline</Badge>
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.6 }} className="text-5xl font-black leading-[1.05] tracking-tight sm:text-7xl lg:text-8xl">
            Prove Anything.<br />
            <span className="text-gradient">Reveal Nothing.</span>
          </motion.h1>
          <p className="mx-auto mt-6 h-8 max-w-2xl font-mono text-base text-slate-300 sm:text-lg" aria-live="polite">
            {typed}
            <span className="animate-blink text-accent">▌</span>
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="xl"><Link href="/dashboard">Enter Secure Vault <ArrowRight className="h-5 w-5" /></Link></Button>
            <Button size="xl" variant="outline" onClick={() => setDemo(true)}>▶ Watch 60s Demo</Button>
          </div>
          <div className="mx-auto mt-16 grid max-w-4xl grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { v: <CountUp to={0} />, l: "Bytes Uploaded to Cloud" },
              { v: <span>&lt;<CountUp to={1} /></span>, l: "Second Verification" },
              { v: <CountUp to={100} suffix="%" />, l: "On-Device Processing" },
              { v: <CountUp to={256} suffix="-bit" />, l: "Military-Grade Encryption" },
            ].map((s) => (
              <div key={s.l} className="glass rounded-2xl p-4">
                <p className="text-3xl font-black text-accent sm:text-4xl">{s.v}</p>
                <p className="mt-1 text-xs text-mute">{s.l}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <h2 className="text-center text-3xl font-bold sm:text-4xl">Privacy engineering, not privacy theatre</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-mute">Every layer runs on your device: the AI, the cryptography and the storage.</p>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.article key={f.title} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }} className="glass glass-lift rounded-2xl p-6">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/15 text-accent"><f.icon className="h-6 w-6" /></span>
              <h3 className="mt-4 text-xl font-bold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mute">{f.text}</p>
              <Badge className="mt-4" tone="accent">{f.tag}</Badge>
            </motion.article>
          ))}
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            { i: ScrollText, t: "Government signature validator", d: "RSA-2048 checks reject Photoshopped documents." },
            { i: ShieldAlert, t: "Revocable kill-switch", d: "Panic button invalidates every live proof, gossiped to verifiers." },
            { i: BarChart3, t: "Selective-disclosure audit", d: "Every proof and verification, with exportable privacy receipts." },
          ].map((x) => (
            <div key={x.t} className="flex items-start gap-3 rounded-xl border border-line bg-panel/30 p-4">
              <x.i className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-hidden />
              <div><p className="text-sm font-semibold">{x.t}</p><p className="text-xs text-mute">{x.d}</p></div>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="border-y border-line/60 bg-panel/20 py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-center text-3xl font-bold sm:text-4xl">How it works</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <button key={s.title} onClick={() => setStep(i)} aria-pressed={step === i} className={cn("relative rounded-2xl border p-6 text-left transition", step === i ? "border-accent bg-accent/10 shadow-[0_0_40px_-12px_var(--accent)]" : "border-line bg-panel/30 hover:border-accent/40")}>
                <span className={cn("absolute -top-4 left-6 flex h-8 w-8 items-center justify-center rounded-full text-sm font-black", step === i ? "bg-accent text-slate-950" : "bg-panel2 text-mute")}>{i + 1}</span>
                <s.icon className={cn("mt-2 h-9 w-9", step === i ? "text-accent" : "text-mute")} aria-hidden />
                <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
                <p className="mt-2 text-sm text-mute">{s.text}</p>
                {step === i ? <motion.span layoutId="step-bar" className="absolute inset-x-6 bottom-0 h-0.5 bg-accent" /> : null}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section id="trust" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className={cn("inline-flex items-center gap-3 rounded-full border px-5 py-2.5 font-mono text-sm font-bold", network === "offline" ? "border-ok/50 bg-ok/10 text-ok" : "border-warn/50 bg-warn/10 text-warn")}>
            <span className="relative flex h-3 w-3"><span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full", network === "offline" ? "bg-ok" : "bg-warn")} /><span className={cn("relative inline-flex h-3 w-3 rounded-full", network === "offline" ? "bg-ok" : "bg-warn")} /></span>
            {network === "offline" ? "OFFLINE MODE ACTIVE" : "ONLINE MODE (model downloads only)"}
          </div>
          <p className="flex items-center gap-2 text-xs text-mute">{online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5 text-ok" />} Browser link: {online ? "network present — VaultZK sends nothing over it" : "no network — VaultZK keeps working"}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Badge tone="ok">MIT Licensed</Badge><Badge tone="accent">Open Source</Badge><Badge tone="warn">Gemma Powered</Badge><Badge>Open Agent Skill (SKILL.md)</Badge><Badge>TypeScript strict</Badge>
          </div>
        </div>
        <div className="glass mt-10 rounded-2xl p-4 sm:p-6"><Architecture /></div>
        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-mute"><Cloud className="h-4 w-4 text-danger" /> Verify in your browser&apos;s Network tab: no request ever carries documents, proofs or keys.</div>
      </section>

      <section className="mesh-bg border-t border-line/60 py-20 text-center">
        <h2 className="text-3xl font-bold sm:text-4xl">Ready to stop over-sharing?</h2>
        <div className="mt-8 flex justify-center gap-3"><Button asChild size="xl"><Link href="/dashboard">Enter Secure Vault <ArrowRight className="h-5 w-5" /></Link></Button></div>
      </section>

      <footer className="border-t border-line/60 bg-bg px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 md:flex-row">
          <Logo />
          <nav aria-label="Footer" className="flex flex-wrap justify-center gap-5 text-sm text-mute">
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-ink">GitHub</a>
            <a href={DOCS_URL} target="_blank" rel="noreferrer" className="hover:text-ink">Documentation</a>
            <a href={SKILL_URL} target="_blank" rel="noreferrer" className="hover:text-ink">Agent Skill spec</a>
            <Link href="/settings" className="hover:text-ink">Settings</Link>
          </nav>
          <p className="text-sm text-mute">Built with ❤️ for privacy by {TEAM_NAME}</p>
        </div>
      </footer>
      <DemoDialog open={demo} onOpenChange={setDemo} />
    </div>
  );
}
