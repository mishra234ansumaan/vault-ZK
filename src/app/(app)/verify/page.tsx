"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useLiveQuery } from "dexie-react-hooks";
import confetti from "canvas-confetti";
import jsQR from "jsqr";
import { toast } from "sonner";
import { Camera, CheckCircle2, ClipboardPaste, Clock, FileDown, FlaskConical, ImageUp, Loader2, ScanLine, ShieldCheck, ShieldX, XCircle } from "lucide-react";
import { Badge, Bar, Button, Card, CardTitle, EmptyState, PageHero, Textarea } from "@/components/ui";
import { useNow } from "@/components/widgets";
import { getDb } from "@/lib/db";
import { generateExampleProof, verifyPayloadText, type ExampleKind, type VerifyOutcome } from "@/lib/proofs";
import { parsePayload } from "@/lib/zk";
import { cn, downloadBlob, errorMessage, formatDuration, mmss, timeAgo, toCsv } from "@/lib/utils";

type Mode = "scan" | "paste";
type Point = { x: number; y: number };

function highlightJson(text: string): ReactNode {
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?)|\b(true|false|null)\b/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<span key={i++} className={m[2] ? "text-cyan-300" : "text-emerald-300"}>{m[1]}</span>);
    else if (m[3]) out.push(<span key={i++} className="text-amber-300">{m[3]}</span>);
    else out.push(<span key={i++} className="text-fuchsia-300">{m[4]}</span>);
    if (m[2]) out.push(m[2]);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

function ResultPanel({ r, onRetry }: { r: VerifyOutcome; onRetry: () => void }) {
  const now = useNow(1000);
  const shake = r.result === "revoked" || r.result === "invalid";
  useEffect(() => {
    if (r.result === "verified") {
      void confetti({ particleCount: 180, spread: 100, origin: { y: 0.55 }, colors: ["#22c55e", "#06b6d4", "#a3e635", "#ffffff"] });
      setTimeout(() => void confetti({ particleCount: 90, spread: 140, origin: { y: 0.5 }, scalar: 0.8 }), 250);
    }
  }, [r]);

  const cfg = {
    verified: { tone: "border-ok/50 bg-ok/5", title: "✅ MATHEMATICALLY VERIFIED", color: "text-ok", icon: <CheckCircle2 className="h-24 w-24 text-ok" /> },
    expired: { tone: "border-warn/50 bg-warn/5", title: "⌛ PROOF EXPIRED", color: "text-warn", icon: <Clock className="h-24 w-24 text-warn" /> },
    revoked: { tone: "border-danger/50 bg-danger/5", title: "🚨 PROOF REVOKED BY USER", color: "text-danger", icon: <XCircle className="h-24 w-24 text-danger" /> },
    invalid: { tone: "border-danger/50 bg-danger/5", title: "❌ MATHEMATICAL VERIFICATION FAILED", color: "text-danger", icon: <ShieldX className="h-24 w-24 text-danger" /> },
  }[r.result];

  const window_ = r.expiresAt - r.issuedAt;
  const left = r.expiresAt - now;

  return (
    <motion.div
      key={`${r.id}-${r.result}`}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={shake ? { opacity: 1, scale: 1, x: [0, -12, 12, -12, 12, -12, 12, 0] } : { opacity: 1, scale: 1 }}
      transition={shake ? { duration: 0.7 } : { type: "spring", stiffness: 200, damping: 18 }}
      aria-live="assertive"
    >
      <Card className={cn("border-2", cfg.tone)}>
        <div className="flex flex-col items-center gap-3 text-center">
          <motion.div initial={{ scale: 0, rotate: -90 }} animate={r.result === "expired" ? { scale: 1, rotate: [0, 360] } : r.result === "invalid" ? { scale: [0, 1.2, 1], rotate: 0 } : { scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 180, damping: 12, duration: r.result === "expired" ? 1.2 : undefined }}>
            {cfg.icon}
          </motion.div>
          <h2 className={cn("text-2xl font-black tracking-tight sm:text-4xl", cfg.color)}>{cfg.title}</h2>
          <p className="max-w-xl text-sm text-mute">{r.reason}</p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-line bg-bg/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-mute">Condition tested</p>
            <p className="mt-1 text-lg font-bold text-ink">{r.label}</p>
            {r.conditionLabels.length > 1 ? (
              <ul className="mt-2 list-inside list-disc text-xs text-mute">
                {r.conditionLabels.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 font-mono text-[11px] text-mute">
              {r.id} · {r.circuit} circuit · verified in {r.ms} ms
            </p>
            {r.verifier ? <Badge className="mt-2">tagged for: {r.verifier}</Badge> : null}
          </div>
          <div className="rounded-xl border border-line bg-bg/50 p-4 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-mute">Timestamp verification</p>
            {r.issuedAt > 0 ? (
              <dl className="mt-2 space-y-1 font-mono text-xs">
                <div className="flex justify-between gap-2"><dt className="text-mute">Issued</dt><dd>{new Date(r.issuedAt).toLocaleTimeString()}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-mute">Expires</dt><dd>{r.expiresAt ? new Date(r.expiresAt).toLocaleTimeString() : "—"}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-mute">Verified at</dt><dd>{new Date(now).toLocaleTimeString()}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-mute">Window</dt><dd>{window_ > 0 ? formatDuration(window_ / 1000) : "—"}</dd></div>
                {r.revokedAt ? <div className="flex justify-between gap-2"><dt className="text-danger">Revoked</dt><dd className="text-danger">{new Date(r.revokedAt).toLocaleString()}</dd></div> : null}
                {r.expiredAgoSec !== undefined ? <div className="flex justify-between gap-2"><dt className="text-warn">Expired</dt><dd className="text-warn">{formatDuration(Math.max(1, r.expiredAgoSec))} ago</dd></div> : null}
              </dl>
            ) : (
              <p className="mt-2 text-xs text-mute">No timestamp available.</p>
            )}
            {r.result === "verified" && window_ > 0 ? (
              <div className="mt-3">
                <Bar value={(left / window_) * 100} tone="ok" className="h-1.5" />
                <p className="mt-1 text-xs text-ok">Valid for another {mmss(left / 1000)} (time-bomb)</p>
              </div>
            ) : null}
          </div>
        </div>

        {r.result === "verified" ? (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-ok/30 bg-ok/10 p-4 text-sm text-ok">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p>
              <strong>Zero data disclosure confirmed.</strong> The verifier received only a Groth16 proof and public thresholds. No name, birth date, balance, document or account identifier was transmitted or can be derived from this proof.
            </p>
          </div>
        ) : null}

        {r.result === "invalid" ? (
          <ul className="mt-4 list-inside list-disc rounded-xl border border-line bg-bg/50 p-4 text-sm text-mute">
            <li>Make sure the full JSON payload was copied (QR may be partially scanned).</li>
            <li>The proof or its public inputs (threshold, expiry, nonce) may have been edited.</li>
            <li>Ask the holder to generate a fresh proof from the VaultZK app.</li>
          </ul>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {r.result === "verified" ? (
            <Button variant="outline" asChild>
              <Link href="/audit">Audit trail →</Link>
            </Button>
          ) : null}
          {r.result === "expired" ? (
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(`Your VaultZK proof for "${r.label}" has expired. Please generate a fresh proof.`).then(() => toast.success("Request message copied — send it to the holder"));
              }}
            >
              Request new proof
            </Button>
          ) : null}
          {r.result === "revoked" ? (
            <Button variant="outline" onClick={() => toast.info("Contact the holder through the channel where you received this QR code.")}>
              Contact holder
            </Button>
          ) : null}
          <Button onClick={onRetry}>Verify another</Button>
        </div>
      </Card>
    </motion.div>
  );
}

export default function VerifyPage() {
  const [mode, setMode] = useState<Mode>("scan");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyOutcome | null>(null);
  const [camErr, setCamErr] = useState("");
  const [scanning, setScanning] = useState(false);
  const [box, setBox] = useState<Point[] | null>(null);
  const [dims, setDims] = useState({ w: 640, h: 480 });
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const history = useLiveQuery(() => getDb().verifications.orderBy("at").reverse().limit(12).toArray(), []);

  const runVerify = useCallback(async (payload: string) => {
    setBusy(true);
    try {
      setResult(await verifyPayloadText(payload));
    } catch (e) {
      toast.error(`Verifier error: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const m = window.location.hash.match(/^#p=(.+)$/);
    if (!m) return;
    try {
      const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
      const json = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
      setMode("paste");
      setText(json);
      void runVerify(json);
    } catch {
      toast.error("The share link is malformed.");
    }
  }, [runVerify]);

  /* Camera scanning loop */
  useEffect(() => {
    if (mode !== "scan" || result) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    setCamErr("");
    setBox(null);
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } } });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();
        setScanning(true);
        const tick = () => {
          if (stopped) return;
          const c = canvasRef.current;
          if (c && v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth > 0) {
            c.width = v.videoWidth;
            c.height = v.videoHeight;
            setDims({ w: v.videoWidth, h: v.videoHeight });
            const ctx = c.getContext("2d", { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(v, 0, 0);
              const img = ctx.getImageData(0, 0, c.width, c.height);
              const code = jsQR(img.data, c.width, c.height, { inversionAttempts: "dontInvert" });
              if (code) {
                const l = code.location;
                setBox([l.topLeftCorner, l.topRightCorner, l.bottomRightCorner, l.bottomLeftCorner]);
                stopped = true;
                setScanning(false);
                stream?.getTracks().forEach((t) => t.stop());
                toast.success("QR detected — verifying…");
                setTimeout(() => void runVerify(code.data), 450);
                return;
              }
              setBox(null);
            }
          }
          timer = setTimeout(() => (raf = requestAnimationFrame(tick)), 90);
        };
        tick();
      } catch {
        setCamErr("Camera unavailable or permission denied. Use “Upload QR image” or switch to Paste mode.");
      }
    };
    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      setScanning(false);
    };
  }, [mode, result, runVerify]);

  const decodeImage = async (file: File) => {
    try {
      const bmp = await createImageBitmap(file);
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.drawImage(bmp, 0, 0);
      const img = ctx.getImageData(0, 0, c.width, c.height);
      const code = jsQR(img.data, c.width, c.height);
      if (!code) {
        toast.error("No QR code found in that image.");
        return;
      }
      await runVerify(code.data);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const loadExample = async (kind: ExampleKind) => {
    setBusy(true);
    try {
      setText(await generateExampleProof(kind));
      toast.success(`Real Groth16 ${kind} example generated`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const validation = useMemo(() => {
    if (!text.trim()) return null;
    return parsePayload(text);
  }, [text]);
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }, [text]);

  const reset = () => {
    setResult(null);
    setBox(null);
    setText("");
    history_scrollTop();
  };

  return (
    <div className="space-y-6">
      <PageHero title="Universal Verifier Portal" subtitle="Verify any ZK-proof. No app installation required." />

      <div className="grid grid-cols-2 gap-3" role="tablist" aria-label="Verification mode">
        {(
          [
            { id: "scan", label: "📷 Scan QR Code", icon: Camera },
            { id: "paste", label: "📋 Paste Proof Payload", icon: ClipboardPaste },
          ] as const
        ).map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => {
              setMode(m.id);
              setResult(null);
            }}
            className={cn("rounded-xl border px-4 py-4 text-base font-bold transition sm:text-lg", mode === m.id ? "border-accent bg-accent/15 text-accent shadow-[0_0_30px_-10px_var(--accent)]" : "border-line bg-panel/40 text-mute hover:text-ink")}
          >
            {m.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {result ? (
          <ResultPanel key="result" r={result} onRetry={reset} />
        ) : mode === "scan" ? (
          <motion.div key="scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Card>
              <div className="relative mx-auto aspect-video w-full max-w-3xl overflow-hidden rounded-xl border border-line bg-black">
                <video ref={videoRef} className="h-full w-full object-contain" muted playsInline aria-label="Live camera feed for QR scanning" />
                <canvas ref={canvasRef} className="hidden" />
                {scanning ? (
                  <div className="pointer-events-none absolute inset-0">
                    <div className="absolute left-[12%] right-[12%] top-[12%] bottom-[12%] overflow-hidden">
                      <div className="absolute inset-x-0 top-0 h-0.5 animate-scan bg-accent shadow-[0_0_16px_var(--accent)]" />
                      {["left-0 top-0 border-l-4 border-t-4", "right-0 top-0 border-r-4 border-t-4", "left-0 bottom-0 border-l-4 border-b-4", "right-0 bottom-0 border-r-4 border-b-4"].map((c) => (
                        <span key={c} className={cn("absolute h-10 w-10 border-accent", c)} />
                      ))}
                    </div>
                  </div>
                ) : null}
                {box ? (
                  <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${dims.w} ${dims.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
                    <polygon points={box.map((p) => `${p.x},${p.y}`).join(" ")} className="fill-ok/20 stroke-ok" strokeWidth="6" />
                  </svg>
                ) : null}
                {!scanning && !camErr && !busy ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-accent" />
                  </div>
                ) : null}
                {busy ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-bg/80 backdrop-blur-sm">
                    <p className="flex items-center gap-2 font-semibold text-accent"><Loader2 className="h-5 w-5 animate-spin" /> Verifying Groth16 proof…</p>
                  </div>
                ) : null}
                {camErr ? (
                  <div className="absolute inset-0 flex items-center justify-center p-6">
                    <EmptyState icon={<Camera className="h-6 w-6" />} title="Camera not available" hint={camErr} />
                  </div>
                ) : null}
              </div>
              <p className="mt-3 flex items-center justify-center gap-2 text-sm text-mute">
                <ScanLine className="h-4 w-4 text-accent" aria-hidden /> Point camera at proof QR code — auto-captures when detected
              </p>
              <div className="mt-3 flex justify-center">
                <Button variant="outline" onClick={() => fileRef.current?.click()}>
                  <ImageUp className="h-4 w-4" /> Upload QR image
                </Button>
                <input ref={fileRef} type="file" accept="image/*" className="sr-only" aria-label="Upload an image containing a QR code" onChange={(e) => { const f = e.target.files?.[0]; if (f) void decodeImage(f); e.target.value = ""; }} />
              </div>
            </Card>
          </motion.div>
        ) : (
          <motion.div key="paste" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Card className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="mr-2">Proof payload</CardTitle>
                <Button size="sm" variant="outline" onClick={() => void loadExample("valid")} disabled={busy}><FlaskConical className="h-3.5 w-3.5" /> Example: valid</Button>
                <Button size="sm" variant="outline" onClick={() => void loadExample("expired")} disabled={busy}>Example: expired</Button>
                <Button size="sm" variant="outline" onClick={() => void loadExample("tampered")} disabled={busy}>Example: tampered</Button>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={14} spellCheck={false} placeholder='Paste the proof JSON here: {"v":1,"id":"vzk_…","circuit":"range",…}' className="min-h-72 font-mono text-xs" aria-label="Proof payload JSON" />
                <pre className="max-h-96 min-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-black/50 p-3 font-mono text-xs" aria-label="Syntax-highlighted preview">
                  {text.trim() ? highlightJson(pretty.length > 4000 ? pretty.slice(0, 4000) + "\n…" : pretty) : <span className="text-slate-600">Highlighted preview appears here</span>}
                </pre>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm">
                  {validation === null ? <span className="text-mute">Waiting for input…</span> : validation.ok ? <Badge tone="ok">✓ Structure valid · {validation.payload.circuit} circuit</Badge> : <Badge tone="danger">✗ {validation.reason}</Badge>}
                </div>
                <Button size="lg" onClick={() => void runVerify(text)} disabled={busy || !text.trim()}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Verify proof
                </Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Verifier history (anonymous)</CardTitle>
          <Button
            size="sm"
            variant="outline"
            disabled={!history?.length}
            onClick={() =>
              downloadBlob(
                "vaultzk-verifications.csv",
                toCsv((history ?? []).map((h) => ({ timestamp: new Date(h.at).toISOString(), condition: h.label, result: h.result, duration_ms: h.ms }))),
                "text/csv",
              )
            }
          >
            <FileDown className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>
        {!history?.length ? (
          <div className="mt-3"><EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="No verifications yet" hint="Results appear here — only timestamp, condition and outcome are stored." /></div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-mute">
                <tr><th className="py-2">Time</th><th>Condition</th><th>Result</th><th className="text-right">Duration</th></tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="py-2 text-mute">{timeAgo(h.at)}</td>
                    <td className="max-w-xs truncate pr-2">{h.label}</td>
                    <td><Badge tone={h.result === "verified" ? "ok" : h.result === "expired" ? "warn" : "danger"}>{h.result}</Badge></td>
                    <td className="text-right font-mono text-xs">{h.ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function history_scrollTop(): void {
  window.scrollTo({ top: 0, behavior: "smooth" });
}
