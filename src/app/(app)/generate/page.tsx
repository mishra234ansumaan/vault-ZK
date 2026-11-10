"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useLiveQuery } from "dexie-react-hooks";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { ChevronDown, Copy, Download, FileText, Link2, Nfc, Sparkles, Trash2, Wand2, ShieldOff, Brain, CheckCircle2, Circle, Loader2 } from "lucide-react";
import { Badge, Button, Card, CardTitle, Checkbox, Input, Label, PageHero, Ring, Select, Slider, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { EXAMPLE_LOGIC, LogicBuilder, logicToSpec, type LogicState } from "@/components/logic-builder";
import { useNow } from "@/components/widgets";
import {
  COUNTRIES,
  EDUCATION_LEVELS,
  FIELD_DEFS,
  categoryOfSpec,
  describeCondition,
  type Condition,
  type FieldKey,
  type ProofSpec,
} from "@/lib/fields";
import { evaluateSpec, generateProof, type GeneratedProof } from "@/lib/zk";
import { revokeProofs, saveGeneratedProof } from "@/lib/proofs";
import { getProfile } from "@/lib/vault";
import { getDb } from "@/lib/db";
import { explainProofInPlainEnglish, suggestPrivacyOptimalPredicate } from "@/lib/gemma/tools";
import type { PredicateSuggestion } from "@/lib/gemma/heuristics";
import { downloadProofPdf } from "@/lib/pdf";
import { cn, errorMessage, formatBytes, formatDuration, mmss, shortHash } from "@/lib/utils";

type TabId = "identity" | "financial" | "qualification" | "background" | "custom";

const TTL_MIN = 10;
const TTL_MAX = 86400;
const sliderToTtl = (v: number) => Math.round(TTL_MIN * Math.pow(TTL_MAX / TTL_MIN, v / 100));
const ttlToSlider = (t: number) => (Math.log(t / TTL_MIN) / Math.log(TTL_MAX / TTL_MIN)) * 100;

const TABS: Array<{ id: TabId; label: string; fields: FieldKey[] }> = [
  { id: "identity", label: "Identity", fields: ["age", "citizenship", "residency", "govId"] },
  { id: "financial", label: "Financial", fields: ["bankBalance", "monthlyIncome", "creditScore", "netWorth"] },
  { id: "qualification", label: "Qualifications", fields: ["educationLevel", "yearsExperience", "employed", "professionalLicense"] },
  { id: "background", label: "Background", fields: ["noCriminalRecord", "noBankruptcy", "referencesVerified", "healthClear"] },
  { id: "custom", label: "Custom Logic ✨", fields: [] },
];

const DEFAULTS: Record<FieldKey, number> = {
  age: 21,
  citizenship: 1,
  residency: 1,
  govId: 1,
  bankBalance: 50000,
  monthlyIncome: 5000,
  creditScore: 700,
  netWorth: 100000,
  educationLevel: 2,
  yearsExperience: 3,
  employed: 1,
  professionalLicense: 1,
  noCriminalRecord: 1,
  noBankruptcy: 1,
  referencesVerified: 1,
  healthClear: 1,
};

const STAGES = [
  { key: "witness", label: "Generating witness…" },
  { key: "prove", label: "Computing SNARK (Groth16)…" },
  { key: "finalize", label: "Finalizing proof…" },
] as const;

function CircuitAnimation({ stage }: { stage: number }) {
  const nodes = [40, 120, 200, 280, 360];
  return (
    <div className="space-y-4">
      <svg viewBox="0 0 400 90" className="w-full" role="img" aria-label="ZK circuit computing">
        {nodes.slice(0, -1).map((x, i) => (
          <path key={x} d={`M${x + 12} 45 H${nodes[i + 1] - 12}`} className={cn("fill-none stroke-2", stage > i ? "animate-flow stroke-accent" : "stroke-line")} strokeDasharray="6 6" />
        ))}
        {nodes.map((x, i) => (
          <g key={x}>
            <circle cx={x} cy="45" r="12" className={cn("transition-all", stage >= i - 1 ? "fill-accent/30 stroke-accent" : "fill-panel stroke-line")} strokeWidth="2" />
            {stage >= i - 1 ? <circle cx={x} cy="45" r="12" className="animate-pulse-ring origin-center fill-none stroke-accent" /> : null}
          </g>
        ))}
      </svg>
      <ol className="space-y-1.5">
        {STAGES.map((s, i) => (
          <li key={s.key} className={cn("flex items-center gap-2 text-sm", i < stage ? "text-ok" : i === stage ? "text-accent" : "text-slate-600")}>
            {i < stage ? <CheckCircle2 className="h-4 w-4" /> : i === stage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Circle className="h-4 w-4" />}
            {s.label}
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function GeneratePage() {
  const profile = useLiveQuery(() => getProfile(), []);
  const [tab, setTab] = useState<TabId>("financial");
  const [selected, setSelected] = useState<FieldKey>("bankBalance");
  const [values, setValues] = useState<Record<FieldKey, number>>(DEFAULTS);
  const [logic, setLogic] = useState<LogicState>({ chips: [], slots: [null, null, null, null], op: "AND" });
  const [ttlSlider, setTtlSlider] = useState(ttlToSlider(60));
  const [verifier, setVerifier] = useState("");
  const [randomNonce, setRandomNonce] = useState(true);
  const [save, setSave] = useState(true);
  const [goal, setGoal] = useState("");
  const [advisor, setAdvisor] = useState<PredicateSuggestion | null>(null);
  const [advising, setAdvising] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [result, setResult] = useState<GeneratedProof | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [explaining, setExplaining] = useState(false);
  const [showTech, setShowTech] = useState(false);
  const now = useNow(250);
  const ttl = sliderToTtl(ttlSlider);

  const selectField = useCallback((tabId: TabId, field: FieldKey, threshold?: number) => {
    setTab(tabId);
    setSelected(field);
    if (threshold !== undefined) setValues((v) => ({ ...v, [field]: threshold }));
  }, []);

  useEffect(() => {
    const preset = new URLSearchParams(window.location.search).get("preset");
    if (preset === "age") selectField("identity", "age", 21);
    else if (preset === "income") selectField("financial", "monthlyIncome", 5000);
    else if (preset === "id") selectField("identity", "govId");
    else if (preset === "custom") {
      setTab("custom");
      setLogic(EXAMPLE_LOGIC);
    }
  }, [selectField]);

  const spec: ProofSpec = useMemo(() => {
    if (tab === "custom") return logicToSpec(logic);
    const c: Condition = { field: selected, threshold: values[selected] };
    return { mode: "single", condition: c };
  }, [tab, logic, selected, values]);

  const specValid = spec.mode === "single" || spec.groupA.length + spec.groupB.length > 0;
  const satisfiable = useMemo(() => {
    if (!profile || !specValid) return null;
    try {
      return evaluateSpec(spec, profile);
    } catch {
      return null;
    }
  }, [spec, profile, specValid]);

  const suggest = async () => {
    setAdvising(true);
    try {
      setAdvisor(await suggestPrivacyOptimalPredicate(goal));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setAdvising(false);
    }
  };

  const applySuggestion = (s: PredicateSuggestion) => {
    if (s.conditions.length === 1) {
      const c = s.conditions[0];
      const t = TABS.find((x) => x.fields.includes(c.field));
      selectField(t?.id ?? "identity", c.field, c.threshold);
    } else {
      const chips = s.conditions.slice(0, 4).map((c, i) => ({ id: `s${i}`, ...c }));
      const slots: Array<string | null> = [null, null, null, null];
      if (s.logic === "AND") chips.forEach((c, i) => (slots[i] = c.id));
      else chips.forEach((c, i) => (slots[i < 2 ? i : i] = c.id));
      setLogic({ chips, slots, op: s.logic });
      setTab("custom");
    }
    if (s.verifierType) setVerifier(s.verifierType);
    toast.success("Suggested predicate applied");
  };

  const generate = async () => {
    if (!profile) return;
    setBusy(true);
    setResult(null);
    setRevoked(false);
    setExplanation("");
    setStage(0);
    const t0 = performance.now();
    try {
      const g = await generateProof(spec, profile, {
        ttlSeconds: ttl,
        randomizeNonce: randomNonce,
        verifier: verifier || undefined,
        onStage: (s) => setStage(s === "witness" ? 0 : s === "prove" ? 1 : 2),
      });
      const wait = 1500 - (performance.now() - t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      setStage(3);
      if (save) await saveGeneratedProof(g, spec, categoryOfSpec(spec), verifier || "unspecified");
      setResult(g);
      toast.success(`Proof generated in ${g.genMs} ms`);
    } catch (e) {
      toast.error("Could not generate proof", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const payloadText = result ? JSON.stringify(result.payload) : "";
  const secondsLeft = result ? Math.max(0, Math.ceil((result.expiresAt - now) / 1000)) : 0;
  const expired = result ? result.expiresAt <= now : false;
  const ringPct = result ? Math.max(0, Math.min(100, ((result.expiresAt - now) / (result.expiresAt - result.payload.issuedAt * 1000)) * 100)) : 0;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  const link = result && typeof window !== "undefined" ? `${window.location.origin}/verify#p=${btoa(payloadText).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}` : "";

  const explain = async () => {
    if (!result) return;
    setExplaining(true);
    try {
      setExplanation(await explainProofInPlainEnglish(result.payload));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExplaining(false);
    }
  };

  const fieldControl = (f: FieldKey) => {
    const def = FIELD_DEFS[f];
    const v = values[f];
    const set = (n: number) => setValues((x) => ({ ...x, [f]: n }));
    switch (f) {
      case "age":
        return (
          <div className="mt-3 flex items-center gap-4">
            <Slider min={18} max={100} step={1} value={[v]} onValueChange={([n]) => set(n)} aria-label="Minimum age" />
            <span className="w-16 text-right font-mono text-lg font-bold text-accent">≥ {v}</span>
          </div>
        );
      case "creditScore":
        return (
          <div className="mt-3 flex items-center gap-4">
            <Slider min={300} max={850} step={5} value={[v]} onValueChange={([n]) => set(n)} aria-label="Minimum credit score" />
            <span className="w-20 text-right font-mono text-lg font-bold text-accent">≥ {v}</span>
          </div>
        );
      case "residency":
        return (
          <Select className="mt-3" value={v} onChange={(e) => set(Number(e.target.value))} aria-label="Country of residence">
            {COUNTRIES.map((c, i) => (
              <option key={c} value={i + 1}>
                {c}
              </option>
            ))}
          </Select>
        );
      case "educationLevel":
        return (
          <Select className="mt-3" value={v} onChange={(e) => set(Number(e.target.value))} aria-label="Minimum education level">
            {EDUCATION_LEVELS.map((c, i) => (
              <option key={c} value={i + 1}>
                {c}
              </option>
            ))}
          </Select>
        );
      default:
        if (def.kind === "flag") return <p className="mt-2 text-xs text-mute">Boolean attribute — proves the statement is true.</p>;
        return (
          <div className="mt-3 flex items-center gap-2">
            {def.prefix ? <span className="text-mute">{def.prefix}</span> : null}
            <Input type="number" min={def.min} max={def.max} value={v} onChange={(e) => set(Math.max(0, Number(e.target.value) || 0))} aria-label={`Minimum ${def.label}`} className="max-w-48" />
            {def.suffix ? <span className="text-mute">{def.suffix}</span> : null}
          </div>
        );
    }
  };

  return (
    <div className="space-y-6">
      <PageHero title="Generate Zero-Knowledge Proof" subtitle="Choose what to prove. Choose what to hide." />

      <Card className="border-fuchsia-500/30 bg-gradient-to-br from-fuchsia-500/10 to-transparent">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-fuchsia-300" aria-hidden />
          <CardTitle className="text-fuchsia-200">Gemma privacy advisor</CardTitle>
          <Badge tone="neutral">tool: suggestPrivacyOptimalPredicate</Badge>
        </div>
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void suggest();
          }}
        >
          <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder='e.g. "I want to rent an apartment for $1,800 a month"' aria-label="Describe your goal" />
          <Button type="submit" disabled={advising || goal.trim().length < 3}>
            <Wand2 className="h-4 w-4" /> {advising ? "Thinking locally…" : "Suggest minimum disclosure"}
          </Button>
        </form>
        <AnimatePresence>
          {advisor ? (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 space-y-2 rounded-xl border border-line bg-bg/60 p-4">
              <p className="font-mono text-sm text-accent">{advisor.suggestedPredicate}</p>
              <p className="text-sm text-ink">{advisor.explanation}</p>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-mute">Stays hidden:</span>
                {advisor.hiddenFields.slice(0, 8).map((h) => (
                  <Badge key={h} tone="ok">
                    {h}
                  </Badge>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => applySuggestion(advisor)}>
                  <Sparkles className="h-3.5 w-3.5" /> Apply to generator
                </Button>
                <Badge tone={advisor.source === "gemma" ? "accent" : "neutral"}>via {advisor.source === "gemma" ? "Gemma" : "rule engine"}</Badge>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {TABS.filter((t) => t.id !== "custom").map((t) => (
              <TabsContent key={t.id} value={t.id} className="mt-4 grid gap-3 sm:grid-cols-2">
                {t.fields.map((f) => {
                  const def = FIELD_DEFS[f];
                  const active = selected === f && tab === t.id;
                  const c: Condition = { field: f, threshold: values[f] };
                  return (
                    <div
                      key={f}
                      role="radio"
                      aria-checked={active}
                      tabIndex={0}
                      onClick={() => setSelected(f)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSelected(f))}
                      className={cn("cursor-pointer rounded-xl border p-4 transition", active ? "border-accent bg-accent/10 shadow-[0_0_24px_-8px_var(--accent)]" : "border-line bg-panel/30 hover:border-accent/50")}
                    >
                      <div className="flex items-center justify-between">
                        <p className="font-semibold">Prove {describeCondition(c)}</p>
                        <span className={cn("h-4 w-4 rounded-full border-2", active ? "border-accent bg-accent" : "border-line")} />
                      </div>
                      <p className="mt-0.5 text-xs text-mute">Hides your exact {def.label.toLowerCase()}.</p>
                      <div onClick={(e) => e.stopPropagation()}>{fieldControl(f)}</div>
                    </div>
                  );
                })}
              </TabsContent>
            ))}
            <TabsContent value="custom" className="mt-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-mute">
                  Compose <span className="font-mono text-ink">(A AND B) OR (C AND NOT D)</span>. The verifier learns the formula holds — not which branch.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setLogic(EXAMPLE_LOGIC)}>
                    Load example
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setLogic({ chips: [], slots: [null, null, null, null], op: "AND" })}>
                    <Trash2 className="h-3.5 w-3.5" /> Reset
                  </Button>
                </div>
              </div>
              <LogicBuilder state={logic} onChange={setLogic} />
            </TabsContent>
          </Tabs>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardTitle>Proof configuration</CardTitle>
            <div className="mt-4 space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label className="mb-0">Time-bomb expiry</Label>
                  <span className="font-mono text-sm font-bold text-warn">{formatDuration(ttl)}</span>
                </div>
                <Slider min={0} max={100} step={0.5} value={[ttlSlider]} onValueChange={([n]) => setTtlSlider(n)} aria-label="Time-bomb expiry" />
                <div className="mt-1 flex justify-between text-[10px] text-mute">
                  <span>10 s</span>
                  <span>1 h</span>
                  <span>24 h</span>
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-mute">
                  <ShieldOff className="h-3.5 w-3.5 text-warn" /> Self-destructs in <span className="font-mono text-ink">{mmss(ttl)}</span>. Expiry is bound into the SNARK — it can&apos;t be edited.
                </p>
              </div>
              <div>
                <Label htmlFor="verifier">Verifier type (optional tag)</Label>
                <Select id="verifier" value={verifier} onChange={(e) => setVerifier(e.target.value)}>
                  <option value="">Unspecified</option>
                  <option value="landlord">Landlord</option>
                  <option value="bank">Bank</option>
                  <option value="bar">Bar / venue</option>
                  <option value="govt">Government</option>
                </Select>
              </div>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  Randomize nonce
                  <span className="block text-xs text-mute">Prevents proof linkability across sessions</span>
                </span>
                <Switch checked={randomNonce} onCheckedChange={setRandomNonce} aria-label="Randomize nonce" />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={save} onCheckedChange={(v) => setSave(v === true)} aria-label="Save to history" /> Save to history (enables revocation & audit)
              </label>
              <div className="rounded-lg border border-line bg-bg/50 p-3 text-xs">
                <p className="text-mute">Statement</p>
                <p className="mt-0.5 font-mono text-sm text-ink">{specValid ? (spec.mode === "single" ? describeCondition(spec.condition) : [...spec.groupA, ...spec.groupB].map(describeCondition).join(` ${spec.op} `) || "—") : "Add conditions in the builder"}</p>
                {satisfiable !== null ? (
                  <p className={cn("mt-2 font-semibold", satisfiable ? "text-ok" : "text-danger")}>{satisfiable ? "✓ Your vault satisfies this (checked locally)" : "✗ Your vault does not satisfy this — no valid proof exists"}</p>
                ) : null}
                {profile && Object.keys(profile).length === 0 ? (
                  <p className="mt-2 text-warn">
                    Your vault is empty. <Link href="/vault" className="underline">Add a document</Link> first.
                  </p>
                ) : null}
              </div>
            </div>
          </Card>
        </div>
      </div>

      <motion.div whileTap={{ scale: 0.99 }}>
        <Button size="xl" className="w-full text-lg shadow-[0_0_40px_-10px_var(--accent)]" onClick={generate} disabled={busy || !specValid || !profile} aria-label="Generate zero-knowledge proof">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "🔐"} {busy ? "Proving…" : "Generate Zero-Knowledge Proof"}
        </Button>
      </motion.div>

      <AnimatePresence>
        {busy ? (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <Card>
              <CircuitAnimation stage={stage} />
            </Card>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {result && !busy ? (
          <motion.div key={result.id} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="grid gap-6 lg:grid-cols-[auto_1fr]">
            <Card className="flex flex-col items-center gap-4">
              <CardTitle>Proof output</CardTitle>
              <Ring value={ringPct} size={344} stroke={8} tone={ringPct > 30 ? "ok" : ringPct > 10 ? "warn" : "danger"}>
                <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 160, damping: 14 }} className="relative rounded-xl bg-white p-3">
                  <span className="absolute inset-0 animate-pulse-ring rounded-xl border-2 border-accent" aria-hidden />
                  <QRCodeSVG value={payloadText} size={264} level="L" marginSize={0} bgColor="#ffffff" fgColor="#0b0f19" />
                  {expired || revoked ? (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-bg/90 text-center backdrop-blur-sm">
                      <p className={cn("text-2xl font-black", revoked ? "text-danger" : "text-warn")}>{revoked ? "REVOKED" : "EXPIRED"}</p>
                    </div>
                  ) : null}
                </motion.div>
              </Ring>
              <p className={cn("font-mono text-lg font-bold", expired ? "text-warn" : "text-ok")}>{expired ? "Self-destructed" : `Self-destructs in ${mmss(secondsLeft)}`}</p>
            </Card>

            <Card className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="ok">Proof ready</Badge>
                <Badge tone="accent">{result.circuit} circuit</Badge>
                <span className="font-mono text-sm text-ink">{result.id}</span>
              </div>
              <p className="text-lg font-semibold">{result.label}</p>
              <div>
                <Label>Proof hash (SHA-256)</Label>
                <div className="flex items-center gap-2 rounded-lg border border-line bg-bg/60 p-2">
                  <code className="min-w-0 flex-1 break-all font-mono text-xs text-accent">{result.proofHash}</code>
                  <Button size="icon" variant="ghost" onClick={() => void copy(result.proofHash, "Proof hash")} aria-label="Copy proof hash">
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div>
                <Label>Ephemeral share link</Label>
                <div className="flex items-center gap-2 rounded-lg border border-line bg-bg/60 p-2">
                  <Link2 className="h-4 w-4 shrink-0 text-mute" aria-hidden />
                  <code className="min-w-0 flex-1 truncate font-mono text-xs">{shortHash(link, 48, 14)}</code>
                  <Button size="icon" variant="ghost" onClick={() => void copy(link, "Link")} aria-label="Copy share link">
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => void copy(payloadText, "Proof payload")}>
                  <Copy className="h-4 w-4" /> Copy payload JSON
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    void downloadProofPdf({ id: result.id, label: result.label, hash: result.proofHash, expiresAt: result.expiresAt, issuedAt: result.payload.issuedAt * 1000, payload: payloadText, circuit: result.circuit, verifier: verifier || undefined }).catch((e) => toast.error(errorMessage(e)))
                  }
                >
                  <Download className="h-4 w-4" /> Download PDF
                </Button>
                <Button variant="outline" asChild>
                  <Link
                    href="/nfc"
                    onClick={() => {
                      sessionStorage.setItem("vaultzk-nfc-proof", result.id);
                    }}
                  >
                    <Nfc className="h-4 w-4" /> NFC broadcast
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href={`/verify#p=${link.split("#p=")[1] ?? ""}`}>
                    <FileText className="h-4 w-4" /> Open in verifier
                  </Link>
                </Button>
                {save ? (
                  <Button
                    variant="danger"
                    disabled={revoked}
                    onClick={async () => {
                      await revokeProofs([result.id]);
                      setRevoked(true);
                      toast.warning("Proof revoked");
                    }}
                  >
                    <ShieldOff className="h-4 w-4" /> Revoke
                  </Button>
                ) : null}
                <Button variant="subtle" onClick={explain} disabled={explaining}>
                  <Brain className="h-4 w-4" /> {explaining ? "Gemma explaining…" : "Explain in plain English"}
                </Button>
              </div>
              {explanation ? (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 p-3 text-sm text-ink">
                  🧠 {explanation}
                </motion.p>
              ) : null}
              <div>
                <button type="button" onClick={() => setShowTech((s) => !s)} className="flex w-full items-center justify-between rounded-lg border border-line px-3 py-2 text-sm font-semibold text-mute hover:text-ink" aria-expanded={showTech}>
                  Technical details <ChevronDown className={cn("h-4 w-4 transition", showTech && "rotate-180")} />
                </button>
                {showTech ? (
                  <dl className="mt-2 grid gap-1.5 rounded-lg border border-line bg-bg/60 p-3 font-mono text-xs sm:grid-cols-[160px_1fr]">
                    <dt className="text-mute">Circuit</dt>
                    <dd>circuits/{result.circuit}.circom · {result.constraints} non-linear constraints</dd>
                    <dt className="text-mute">Proving system</dt>
                    <dd>Groth16 · BN254 (snarkjs)</dd>
                    <dt className="text-mute">Proof size</dt>
                    <dd>{formatBytes(result.sizeBytes)} payload ({result.sizeBytes} bytes)</dd>
                    <dt className="text-mute">Generation time</dt>
                    <dd>
                      {result.genMs} ms (witness {result.stageMs.witness} ms · prove {result.stageMs.prove} ms)
                    </dd>
                    <dt className="text-mute">VK fingerprint</dt>
                    <dd className="break-all">{result.vkFingerprint}</dd>
                    <dt className="text-mute">Nonce</dt>
                    <dd className="break-all">{result.nonce}</dd>
                    <dt className="text-mute">Commitment (Poseidon)</dt>
                    <dd className="break-all">{result.payload.signals[0]}</dd>
                    <dt className="text-mute">Public signals</dt>
                    <dd className="break-all">[{result.payload.signals.slice(1).join(", ")}]</dd>
                  </dl>
                ) : null}
              </div>
            </Card>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
