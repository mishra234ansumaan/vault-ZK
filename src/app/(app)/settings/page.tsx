"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { toast } from "sonner";
import { Activity, Brain, Code2, Download, Info, KeyRound, Lock, Palette, Save, ShieldCheck, Trash2, Upload, User, Wrench } from "lucide-react";
import { Badge, Bar, Button, Card, CardTitle, Input, Label, PageHero, Select, Slider, Switch, Textarea } from "@/components/ui";
import { GemmaConsole } from "@/components/gemma-parts";
import { useAppStore, DEFAULT_SETTINGS } from "@/lib/store";
import { getDb, getMeta, setMeta } from "@/lib/db";
import { removePin, setPin, sha256Hex, sealJson, openJson } from "@/lib/crypto";
import { exportBackup, importBackup, vaultBytesUsed, vaultId, wipeVault, logEvent } from "@/lib/vault";
import { refreshGemmaStatus, generate, fetchOllamaStatus } from "@/lib/gemma/engine";
import { clearTransformersCache, isTransformersReady, loadTransformers } from "@/lib/gemma/transformers";
import { generateExampleProof, verifyPayloadText } from "@/lib/proofs";
import { APP_VERSION, LICENSE_URL, REPO_URL, SKILL_URL } from "@/lib/constants";
import { cn, downloadBlob, errorMessage, formatBytes } from "@/lib/utils";

const SECTIONS = [
  { id: "account", label: "Account & Identity", icon: User },
  { id: "security", label: "Security & Authentication", icon: Lock },
  { id: "gemma", label: "Gemma AI Settings", icon: Brain },
  { id: "backup", label: "Backup & Recovery", icon: KeyRound },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "developer", label: "Developer Mode", icon: Code2 },
  { id: "about", label: "About & Legal", icon: Info },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/50 py-3 last:border-0">
      <div className="min-w-0 max-w-md">
        <p className="text-sm font-semibold">{title}</p>
        {hint ? <p className="text-xs text-mute">{hint}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Account() {
  const s = useAppStore((x) => x.settings);
  const update = useAppStore((x) => x.updateSettings);
  const [id, setId] = useState("");
  const [size, setSize] = useState(0);
  const [avatar, setAvatar] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      setId(await vaultId());
      setSize(await vaultBytesUsed());
      const row = await getDb().secrets.get("avatar");
      if (row) setAvatar(await openJson<string>(row).catch(() => null));
    })();
  }, []);
  const onFile = (f: File) => {
    if (!f.type.startsWith("image/") || f.size > 2_000_000) {
      toast.error("Choose an image under 2 MB.");
      return;
    }
    const r = new FileReader();
    r.onload = async () => {
      const url = String(r.result);
      const sealed = await sealJson(url);
      await getDb().secrets.put({ id: "avatar", ...sealed });
      setAvatar(url);
      toast.success("Profile picture encrypted & stored locally");
    };
    r.readAsDataURL(f);
  };
  return (
    <Card>
      <CardTitle>Account & Identity</CardTitle>
      <div className="mt-2">
        <Row title="Profile picture" hint="Encrypted with your vault key before storage.">
          <div className="flex items-center gap-3">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="Profile" className="h-12 w-12 rounded-full object-cover" />
            ) : (
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-panel2 text-mute"><User className="h-5 w-5" /></span>
            )}
            <label className="cursor-pointer rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-accent">
              Upload
              <input type="file" accept="image/*" className="sr-only" aria-label="Upload profile picture" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
          </div>
        </Row>
        <Row title="Display name (optional)" hint="Shown only on this device.">
          <Input value={s.displayName} maxLength={32} onChange={(e) => update({ displayName: e.target.value })} className="w-60" aria-label="Display name" />
        </Row>
        <Row title="Vault ID"><code className="font-mono text-sm text-accent">{id || "…"}</code></Row>
        <Row title="Total vault size"><span className="font-mono text-sm">{formatBytes(size)}</span></Row>
      </div>
    </Card>
  );
}

function Security() {
  const s = useAppStore((x) => x.settings);
  const update = useAppStore((x) => x.updateSettings);
  const pinSet = useAppStore((x) => x.pinSet);
  const setPinSetFlag = useAppStore((x) => x.setPinSet);
  const [pin, setPinValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const sessions = useLiveQuery(() => getDb().events.orderBy("at").reverse().filter((e) => e.kind === "security" || e.kind === "vault").limit(6).toArray(), [], []);
  const savePin = async () => {
    if (!/^\d{6}$/.test(pin)) return toast.error("PIN must be exactly 6 digits.");
    if (pin !== confirm) return toast.error("PINs do not match.");
    await setPin(pin);
    setPinSetFlag(true);
    setPinValue("");
    setConfirm("");
    await logEvent("security", "PIN code configured");
    toast.success("6-digit PIN set (PBKDF2-SHA256, 210k iterations)");
  };
  return (
    <Card>
      <CardTitle>Security & Authentication</CardTitle>
      <div className="mt-2">
        <Row title="Biometric unlock (FaceID / fingerprint simulation)" hint="Simulated on-device sensor check.">
          <Switch checked={s.biometricEnabled} onCheckedChange={(v) => update({ biometricEnabled: v })} aria-label="Biometric unlock" />
        </Row>
        <Row title="6-digit PIN" hint={pinSet ? "PIN is active — vault locks on start-up." : "Not set. Locks the UI behind a PIN on every start."}>
          {pinSet ? (
            <Button variant="danger" size="sm" onClick={async () => { await removePin(); setPinSetFlag(false); toast.success("PIN removed"); }}>Remove PIN</Button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Input value={pin} onChange={(e) => setPinValue(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="PIN" inputMode="numeric" type="password" className="w-28" aria-label="New PIN" />
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="Confirm" inputMode="numeric" type="password" className="w-28" aria-label="Confirm PIN" />
              <Button size="sm" onClick={() => void savePin()}>Set PIN</Button>
            </div>
          )}
        </Row>
        <Row title={`Auto-lock timeout: ${s.autoLockMinutes === 0 ? "never" : `${s.autoLockMinutes} min`}`}>
          <div className="w-60"><Slider min={0} max={30} step={1} value={[s.autoLockMinutes]} onValueChange={([n]) => update({ autoLockMinutes: n })} aria-label="Auto-lock minutes" /></div>
        </Row>
        <Row title="Two-factor authentication" hint="Require PIN and biometric together to unlock.">
          <Switch checked={s.twoFactor} onCheckedChange={(v) => update({ twoFactor: v })} aria-label="Two-factor authentication" />
        </Row>
        <Row title="Trusted devices" hint="Keys never leave this device, so there is only one.">
          <Badge tone="ok">This browser · {typeof navigator !== "undefined" ? navigator.platform || "device" : "device"}</Badge>
        </Row>
      </div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-mute">Session history</p>
      <ul className="mt-2 space-y-1 text-xs">
        {sessions?.length ? sessions.map((e) => <li key={e.id} className="flex justify-between gap-3"><span>{e.message}</span><span className="shrink-0 text-mute">{new Date(e.at).toLocaleString()}</span></li>) : <li className="text-mute">No sessions recorded.</li>}
      </ul>
    </Card>
  );
}

const MODELS = ["gemma2:2b", "gemma2:9b", "gemma3:1b", "gemma3:4b", "gemma:2b", "gemma:7b"];

function GemmaSettings() {
  const s = useAppStore((x) => x.settings);
  const update = useAppStore((x) => x.updateSettings);
  const g = useAppStore((x) => x.gemma);
  const network = useAppStore((x) => x.network);
  const [pull, setPull] = useState<{ status: string; pct: number } | null>(null);
  const [tjs, setTjs] = useState<{ pct: number } | null>(null);
  const [bench, setBench] = useState<{ runs: number[]; engine: string; tps: number | null } | null>(null);
  const [benching, setBenching] = useState(false);
  const online = network === "online";

  const pullModel = async () => {
    setPull({ status: "starting", pct: 0 });
    try {
      const res = await fetch("/api/gemma/pull", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: s.gemmaModel }) });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({ error: "Ollama not reachable" }))).error);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const j = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string };
          if (j.error) throw new Error(j.error);
          setPull({ status: j.status ?? "", pct: j.total ? ((j.completed ?? 0) / j.total) * 100 : 0 });
        }
      }
      toast.success(`${s.gemmaModel} is ready for offline use`);
      await refreshGemmaStatus();
    } catch (e) {
      toast.error(`Model download failed: ${errorMessage(e)}`);
    } finally {
      setPull(null);
    }
  };

  const prepTjs = async () => {
    setTjs({ pct: 0 });
    try {
      await loadTransformers((pct) => setTjs({ pct }));
      toast.success("In-browser Gemma fallback cached for offline use");
      await refreshGemmaStatus();
    } catch (e) {
      toast.error(`Could not load transformers.js model: ${errorMessage(e)}`);
    } finally {
      setTjs(null);
    }
  };

  const runBench = async () => {
    setBenching(true);
    try {
      await refreshGemmaStatus();
      const runs: number[] = [];
      let engine = "rules";
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        const r = await generate([{ role: "user", content: "List three privacy benefits of zero-knowledge proofs in one sentence." }], { maxTokens: 64 });
        if (!r) break;
        engine = `${r.engine}:${r.model}`;
        runs.push(Math.round(performance.now() - t0));
      }
      setBench({ runs, engine, tps: useAppStore.getState().gemma.tokensPerSec });
      if (runs.length === 0) toast.info("No model engine loaded — nothing to benchmark. Pull a Gemma model first.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBenching(false);
    }
  };

  return (
    <Card>
      <CardTitle>Gemma AI Settings</CardTitle>
      <div className="mt-2">
        <Row title="Active engine" hint={g.label}>
          <Badge tone={g.status === "ready" ? "ok" : "warn"}>{g.engine}</Badge>
        </Row>
        <Row title="Inference engine priority" hint="Auto = Ollama → transformers.js → rule engine">
          <Select value={s.engineMode} onChange={(e) => update({ engineMode: e.target.value as typeof s.engineMode })} className="w-52" aria-label="Engine mode">
            <option value="auto">Auto (recommended)</option>
            <option value="ollama">Ollama only</option>
            <option value="transformers">transformers.js only</option>
            <option value="rules">Rule engine only</option>
          </Select>
        </Row>
        <Row title="Model" hint={`Installed: ${g.installedModels.join(", ") || (g.ollamaReachable ? "none" : "Ollama offline")}`}>
          <div className="flex gap-2">
            <Select value={MODELS.includes(s.gemmaModel) ? s.gemmaModel : "custom"} onChange={(e) => e.target.value !== "custom" && update({ gemmaModel: e.target.value })} className="w-40" aria-label="Gemma model">
              {MODELS.map((m) => <option key={m}>{m}</option>)}
              <option value="custom">custom…</option>
            </Select>
            <Input value={s.gemmaModel} onChange={(e) => update({ gemmaModel: e.target.value.trim() })} className="w-36 font-mono text-xs" aria-label="Custom model tag" />
          </div>
        </Row>
        <Row title="Quantization" hint="Informational — set by the GGUF you pull.">
          <Select value={s.quantization} onChange={(e) => update({ quantization: e.target.value as typeof s.quantization })} className="w-28" aria-label="Quantization"><option>Q4</option><option>Q8</option><option>FP16</option></Select>
        </Row>
        <Row title="Inference device">
          <Select value={s.device} onChange={(e) => update({ device: e.target.value as typeof s.device })} className="w-28" aria-label="Inference device"><option value="cpu">CPU</option><option value="gpu">GPU</option></Select>
        </Row>
        <Row title={`Memory limit: ${s.memoryLimitGb} GB`}>
          <div className="w-60"><Slider min={2} max={32} step={1} value={[s.memoryLimitGb]} onValueChange={([n]) => update({ memoryLimitGb: n })} aria-label="Memory limit" /></div>
        </Row>
        <Row title="Download / update model" hint={online ? `ollama pull ${s.gemmaModel}` : "Switch the header toggle to ONLINE to download. One-time; inference is offline."}>
          <Button size="sm" onClick={() => void pullModel()} disabled={!online || !!pull}><Download className="h-3.5 w-3.5" /> {pull ? "Downloading…" : "Pull model"}</Button>
        </Row>
        {pull ? <div className="pb-3"><Bar value={pull.pct} /><p className="mt-1 text-xs text-mute">{pull.status} {pull.pct > 0 ? `${pull.pct.toFixed(0)}%` : ""}</p></div> : null}
        <Row title="In-browser fallback (transformers.js)" hint={isTransformersReady() ? "Cached — works with Wi-Fi off." : "Downloads a small ONNX Gemma once into the browser cache."}>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void prepTjs()} disabled={!online || !!tjs}>{tjs ? `${tjs.pct.toFixed(0)}%` : "Prepare"}</Button>
            <Button size="sm" variant="ghost" onClick={async () => { await clearTransformersCache(); await refreshGemmaStatus(); toast.success("Browser model cache cleared (Ollama models: `ollama rm <tag>`)"); }}><Trash2 className="h-3.5 w-3.5" /> Clear cache</Button>
          </div>
        </Row>
        <Row title="Performance benchmark" hint="3 short generations on the active engine.">
          <Button size="sm" onClick={() => void runBench()} disabled={benching}><Activity className="h-3.5 w-3.5" /> {benching ? "Running…" : "Run benchmark"}</Button>
        </Row>
        {bench ? (
          <p className="rounded-lg border border-line bg-bg/50 p-3 font-mono text-xs">
            {bench.runs.length ? `${bench.engine} → runs: ${bench.runs.join(" ms, ")} ms · avg ${Math.round(bench.runs.reduce((a, b) => a + b, 0) / bench.runs.length)} ms${bench.tps ? ` · ${bench.tps} tok/s` : ""}` : "No model engine available."}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function Backup() {
  const [phrase, setPhrase] = useState("");
  const [entered, setEntered] = useState("");
  const [contacts, setContacts] = useState<Array<{ name: string; contact: string }>>([]);
  const [cName, setCName] = useState("");
  const [cContact, setCContact] = useState("");
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    void (async () => {
      const row = await getDb().secrets.get("contacts");
      if (row) setContacts(await openJson<Array<{ name: string; contact: string }>>(row).catch(() => []));
      setRecovery(!!(await getMeta<string>("phraseHash")));
    })();
  }, []);

  const saveContacts = async (list: typeof contacts) => {
    const sealed = await sealJson(list);
    await getDb().secrets.put({ id: "contacts", ...sealed });
    setContacts(list);
  };

  const gen = async () => {
    const m = generateMnemonic(wordlist, 128);
    setPhrase(m);
    await setMeta("phraseHash", await sha256Hex(m));
    setRecovery(true);
    await logEvent("security", "Recovery phrase generated");
    toast.success("Write these 12 words down. They are shown only once.");
  };

  const doExport = async () => {
    const p = entered.trim().toLowerCase();
    if (!validateMnemonic(p, wordlist)) return toast.error("Enter a valid 12-word recovery phrase.");
    try {
      downloadBlob(`vaultzk-backup-${Date.now()}.vzkbak`, await exportBackup(p), "application/json");
      toast.success("Encrypted backup exported");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const doImport = async (f: File) => {
    const p = entered.trim().toLowerCase();
    if (!validateMnemonic(p, wordlist)) return toast.error("Enter the recovery phrase used for the backup.");
    try {
      const r = await importBackup(await f.text(), p);
      toast.success(`Imported ${r.documents} document(s)`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Card className="space-y-4">
      <CardTitle>Backup & Recovery</CardTitle>
      <Row title="Recovery phrase (12 words)" hint="BIP-39 words. Used to derive the backup encryption key (PBKDF2 → AES-256-GCM).">
        <Button size="sm" onClick={() => void gen()}><KeyRound className="h-3.5 w-3.5" /> {recovery ? "Regenerate" : "Generate"}</Button>
      </Row>
      {phrase ? (
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-warn/40 bg-warn/5 p-4 font-mono text-sm sm:grid-cols-3 md:grid-cols-4">
          {phrase.split(" ").map((w, i) => <span key={i}><span className="text-mute">{i + 1}.</span> {w}</span>)}
        </div>
      ) : null}
      <div>
        <Label htmlFor="phrase-in">Recovery phrase for export / import</Label>
        <Textarea id="phrase-in" rows={2} value={entered} onChange={(e) => setEntered(e.target.value)} placeholder="twelve words separated by spaces" className="font-mono text-xs" />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void doExport()}><Save className="h-4 w-4" /> Export encrypted backup</Button>
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-line px-4 text-sm font-semibold hover:border-accent">
            <Upload className="h-4 w-4" /> Import backup
            <input type="file" accept=".vzkbak,application/json" className="sr-only" aria-label="Import vault backup" onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ""; }} />
          </label>
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">Emergency contacts (encrypted)</p>
        <div className="flex flex-wrap gap-2">
          <Input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Name" className="w-40" aria-label="Contact name" />
          <Input value={cContact} onChange={(e) => setCContact(e.target.value)} placeholder="Email or phone" className="w-52" aria-label="Contact details" />
          <Button size="sm" onClick={() => { if (!cName.trim() || !cContact.trim()) return toast.error("Enter a name and contact."); void saveContacts([...contacts, { name: cName.trim(), contact: cContact.trim() }]); setCName(""); setCContact(""); }}>Add</Button>
        </div>
        <ul className="mt-2 space-y-1 text-sm">
          {contacts.map((c, i) => <li key={i} className="flex items-center justify-between rounded-lg bg-panel/40 px-3 py-1.5"><span>{c.name} · <span className="text-mute">{c.contact}</span></span><button aria-label={`Remove ${c.name}`} onClick={() => void saveContacts(contacts.filter((_, j) => j !== i))} className="text-mute hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button></li>)}
        </ul>
      </div>
      <Row title="Account recovery" hint="Status of recovery setup"><Badge tone={recovery ? "ok" : "warn"}>{recovery ? "Recovery phrase configured" : "Not configured"}</Badge></Row>
      <Row title="Wipe vault" hint="Deletes documents, attributes, proofs and history from this device."><Button variant="danger" size="sm" onClick={async () => { if (window.confirm("Permanently erase the entire vault on this device?")) { await wipeVault(); toast.success("Vault wiped"); } }}><Trash2 className="h-3.5 w-3.5" /> Wipe</Button></Row>
    </Card>
  );
}

function Appearance() {
  const s = useAppStore((x) => x.settings);
  const update = useAppStore((x) => x.updateSettings);
  const swatches = ["#06b6d4", "#22c55e", "#a78bfa", "#f472b6", "#eab308", "#38bdf8"];
  return (
    <Card>
      <CardTitle>Appearance</CardTitle>
      <div className="mt-2">
        <Row title="Theme"><Select value={s.theme} onChange={(e) => update({ theme: e.target.value as typeof s.theme })} className="w-40" aria-label="Theme"><option value="dark">Dark</option><option value="darker">Darker</option><option value="midnight">Midnight</option></Select></Row>
        <Row title="Accent color">
          <div className="flex items-center gap-2">
            {swatches.map((c) => (
              <button key={c} onClick={() => update({ accent: c })} aria-label={`Accent ${c}`} aria-pressed={s.accent === c} className={cn("h-7 w-7 rounded-full border-2 transition hover:scale-110", s.accent === c ? "border-white" : "border-transparent")}>
                <svg viewBox="0 0 10 10" className="h-full w-full"><circle cx="5" cy="5" r="5" fill={c} /></svg>
              </button>
            ))}
            <input type="color" value={s.accent} onChange={(e) => update({ accent: e.target.value })} aria-label="Custom accent color" className="h-8 w-10 cursor-pointer rounded border border-line bg-transparent" />
          </div>
        </Row>
        <Row title={`Font size: ${s.fontScale}%`}><div className="w-60"><Slider min={85} max={125} step={5} value={[s.fontScale]} onValueChange={([n]) => update({ fontScale: n })} aria-label="Font size" /></div></Row>
        <Row title="Animation intensity"><Select value={s.animation} onChange={(e) => update({ animation: e.target.value as typeof s.animation })} className="w-40" aria-label="Animation intensity"><option value="full">Full</option><option value="reduced">Reduced</option><option value="none">None</option></Select></Row>
        <Row title="Compact mode" hint="Slightly smaller type for dense screens."><Switch checked={s.compact} onCheckedChange={(v) => update({ compact: v })} aria-label="Compact mode" /></Row>
        <Row title="Reset appearance"><Button size="sm" variant="outline" onClick={() => update({ theme: DEFAULT_SETTINGS.theme, accent: DEFAULT_SETTINGS.accent, fontScale: 100, animation: "full", compact: false })}>Reset</Button></Row>
      </div>
    </Card>
  );
}

function Developer() {
  const s = useAppStore((x) => x.settings);
  const update = useAppStore((x) => x.updateSettings);
  const logs = useAppStore((x) => x.gemmaLogs);
  const [out, setOut] = useState("");
  const [prof, setProf] = useState("");
  const [busy, setBusy] = useState(false);

  const call = async (path: string) => {
    try {
      const res = await fetch(path, { cache: "no-store" });
      setOut(`${res.status} ${path}\n${JSON.stringify(await res.json(), null, 2)}`);
    } catch (e) {
      setOut(`ERROR ${path}: ${errorMessage(e)}`);
    }
  };

  const profile = async () => {
    setBusy(true);
    try {
      const gen: number[] = [];
      const ver: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        const payload = await generateExampleProof("valid");
        gen.push(performance.now() - t0);
        const t1 = performance.now();
        await verifyPayloadText(payload, false);
        ver.push(performance.now() - t1);
      }
      const avg = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
      setProf(`Groth16 range proof ×3\n  generate: ${gen.map(Math.round).join(", ")} ms (avg ${avg(gen)} ms)\n  verify:   ${ver.map(Math.round).join(", ")} ms (avg ${avg(ver)} ms)`);
    } catch (e) {
      setProf(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const exportLogs = async () => {
    const events = await getDb().events.orderBy("at").toArray();
    downloadBlob("vaultzk-logs.json", JSON.stringify({ gemma: logs, events }, null, 2), "application/json");
  };

  return (
    <Card className="space-y-4">
      <CardTitle>Developer Mode</CardTitle>
      <div>
        <Row title="Enable advanced features"><Switch checked={s.devMode} onCheckedChange={(v) => update({ devMode: v })} aria-label="Enable developer mode" /></Row>
        <Row title="Show ZK circuit internals" hint="Constraint counts and verification-key fingerprints."><Switch checked={s.showCircuit} onCheckedChange={(v) => update({ showCircuit: v })} aria-label="Show circuit internals" /></Row>
      </div>
      {s.devMode ? (
        <>
          {s.showCircuit ? (
            <pre className="overflow-x-auto rounded-lg border border-line bg-black/50 p-3 font-mono text-xs text-accent">{`range.circom  → GreaterEqThan(48) + Poseidon(2) · 291 non-linear constraints · 4 public inputs + 1 output
logic.circom  → 4×GreaterEqThan(48) + NOT/AND/OR gates + Poseidon(5) · 536 constraints · 15 public inputs + 1 output
curve bn128 · Groth16 · powers-of-tau 2^13 (dev ceremony — re-run scripts/setup-zk.mjs for production)`}</pre>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void call("/api/health")}><Wrench className="h-3.5 w-3.5" /> GET /api/health</Button>
            <Button size="sm" variant="outline" onClick={() => void call("/api/gemma/status")}>GET /api/gemma/status</Button>
            <Button size="sm" variant="outline" onClick={async () => setOut(JSON.stringify(await fetchOllamaStatus(), null, 2))}>Ollama probe</Button>
            <Button size="sm" variant="outline" onClick={() => void profile()} disabled={busy}><Activity className="h-3.5 w-3.5" /> {busy ? "Profiling…" : "Profile prover"}</Button>
            <Button size="sm" variant="outline" onClick={() => void exportLogs()}><Download className="h-3.5 w-3.5" /> Export logs</Button>
          </div>
          {out ? <pre className="max-h-64 overflow-auto rounded-lg border border-line bg-black/50 p-3 font-mono text-xs">{out}</pre> : null}
          {prof ? <pre className="rounded-lg border border-line bg-black/50 p-3 font-mono text-xs text-ok">{prof}</pre> : null}
          <div><p className="mb-2 text-sm font-semibold">Debug console</p><GemmaConsole /></div>
        </>
      ) : <p className="text-sm text-mute">Turn on advanced features to reveal the debug console, API tester and profiler.</p>}
    </Card>
  );
}

const DEPS = ["Next.js", "React", "TailwindCSS", "Radix UI", "Framer Motion", "Recharts", "Dexie.js", "snarkjs", "circomlib", "Zustand", "Zod", "React Hook Form", "jsQR", "qrcode / qrcode.react", "jsPDF", "pdf.js", "tesseract.js", "@huggingface/transformers", "@scure/bip39", "Lucide", "sonner", "canvas-confetti"];

function About() {
  return (
    <Card className="space-y-4">
      <CardTitle>About & Legal</CardTitle>
      <div>
        <Row title="Version"><Badge tone="accent">{APP_VERSION}</Badge></Row>
        <Row title="License"><a href={LICENSE_URL} target="_blank" rel="noreferrer" className="text-sm text-accent underline">MIT License</a></Row>
        <Row title="GitHub repository"><a href={REPO_URL} target="_blank" rel="noreferrer" className="text-sm text-accent underline">{REPO_URL.replace("https://", "")}</a></Row>
        <Row title="SKILL.md specification"><a href={SKILL_URL} target="_blank" rel="noreferrer" className="text-sm text-accent underline">Open Agent Skill manifest</a></Row>
      </div>
      <div className="rounded-xl border border-ok/30 bg-ok/5 p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold text-ok"><ShieldCheck className="h-4 w-4" /> Privacy policy</p>
        <p className="mt-1 text-mute">We don&apos;t collect anything. There is no analytics, telemetry, account system or cloud storage. Documents, keys, proofs and history live only in this browser&apos;s IndexedDB.</p>
      </div>
      <div className="rounded-xl border border-line p-4 text-sm text-mute">
        <p className="font-semibold text-ink">Terms of service</p>
        <p className="mt-1">VaultZK is provided “as is” under the MIT License, without warranty. The bundled trust anchors and powers-of-tau ceremony are for demonstration; production deployments must provision real authority keys and run a multi-party ceremony.</p>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">Open-source dependencies</p>
        <div className="flex flex-wrap gap-1.5">{DEPS.map((d) => <Badge key={d}>{d}</Badge>)}</div>
      </div>
      <div className="text-sm text-mute">
        <p className="font-semibold text-ink">Credits & acknowledgments</p>
        <p className="mt-1">Google Gemma open-weight models · Ollama · iden3 (circom, snarkjs, circomlib) · Hugging Face transformers.js · Tesseract OCR · Mozilla pdf.js.</p>
      </div>
      <Link href="/" className="inline-block text-sm text-accent underline">← Back to landing page</Link>
    </Card>
  );
}

export default function SettingsPage() {
  const [section, setSection] = useState<SectionId>("account");
  useEffect(() => {
    const h = window.location.hash.replace("#", "") as SectionId;
    if (SECTIONS.some((s) => s.id === h)) setSection(h);
  }, []);
  return (
    <div>
      <PageHero title="Settings & Security" subtitle="Configure your vault, Gemma agent and appearance." />
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto lg:flex-col">
          {SECTIONS.map((s) => (
            <button key={s.id} onClick={() => setSection(s.id)} aria-current={section === s.id} className={cn("flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition", section === s.id ? "bg-accent/15 text-accent" : "text-mute hover:bg-panel/60 hover:text-ink")}>
              <s.icon className="h-4 w-4 shrink-0" aria-hidden /> {s.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          {section === "account" ? <Account /> : null}
          {section === "security" ? <Security /> : null}
          {section === "gemma" ? <GemmaSettings /> : null}
          {section === "backup" ? <Backup /> : null}
          {section === "appearance" ? <Appearance /> : null}
          {section === "developer" ? <Developer /> : null}
          {section === "about" ? <About /> : null}
        </div>
      </div>
    </div>
  );
}
