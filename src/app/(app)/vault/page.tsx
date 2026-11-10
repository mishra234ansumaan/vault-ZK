"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLiveQuery } from "dexie-react-hooks";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Camera,
  FileBadge,
  FileText,
  GraduationCap,
  HeartPulse,
  IdCard,
  Landmark,
  Briefcase,
  Eye,
  Lock,
  RefreshCw,
  Receipt,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UploadCloud,
  Wallet,
  BookUser,
  Terminal,
  Pencil,
  type LucideIcon,
} from "lucide-react";
import { Badge, Button, Card, CardTitle, Dialog, DialogContent, EmptyState, Input, Label, PageHero, Select, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { BiometricDialog } from "@/components/biometric";
import { GemmaConsole, GemmaStatusPill } from "@/components/gemma-parts";
import { getDb, type DocCategory, type VaultDocument } from "@/lib/db";
import { ingestFile, type PipelineLog, type LogTone } from "@/lib/pipeline";
import { deleteDocument, getProfile, mergeProfile, reencryptDocument } from "@/lib/vault";
import { DOC_LABELS, type DocumentType } from "@/lib/gemma/heuristics";
import { COUNTRIES, EDUCATION_LEVELS, FIELD_DEFS, FIELD_KEYS, formatProfileValue, type Profile } from "@/lib/fields";
import { cn, errorMessage, formatBytes, mmss, shortHash, timeAgo } from "@/lib/utils";

const SAMPLES = [
  { file: "bank_statement.txt", label: "Bank statement (signed)", tone: "ok" },
  { file: "aadhaar_offline_kyc.xml", label: "Aadhaar XML (signed)", tone: "ok" },
  { file: "pan_card.txt", label: "PAN eKYC (signed)", tone: "ok" },
  { file: "tax_return_itr1.txt", label: "Tax return (signed)", tone: "ok" },
  { file: "forged_bank_statement.txt", label: "Forged statement", tone: "danger" },
] as const;

const SUPPORTED: Array<{ name: string; icon: LucideIcon; hint: string }> = [
  { name: "Aadhaar", icon: IdCard, hint: "Offline eKYC XML" },
  { name: "PAN", icon: BookUser, hint: "Income-tax eKYC" },
  { name: "Passport", icon: FileBadge, hint: "Scan / MRZ" },
  { name: "Bank Statement", icon: Landmark, hint: "PDF / image / text" },
  { name: "Tax Returns", icon: Receipt, hint: "ITR acknowledgements" },
  { name: "Degree Certificates", icon: GraduationCap, hint: "Education level" },
  { name: "Medical Records", icon: HeartPulse, hint: "Health clearance" },
  { name: "Employment", icon: Briefcase, hint: "Offer / experience letters" },
];

const toneClass: Record<LogTone, string> = {
  info: "text-slate-300",
  ok: "text-ok",
  warn: "text-warn",
  error: "text-danger",
  ai: "text-fuchsia-300",
};

function Typed({ text, animate }: { text: string; animate: boolean }) {
  const [n, setN] = useState(animate ? 0 : text.length);
  useEffect(() => {
    if (!animate) {
      setN(text.length);
      return;
    }
    setN(0);
    const t = setInterval(() => setN((c) => (c >= text.length ? (clearInterval(t), c) : c + 2)), 12);
    return () => clearInterval(t);
  }, [text, animate]);
  return (
    <span>
      {text.slice(0, n)}
      {animate && n < text.length ? <span className="animate-blink">▌</span> : null}
    </span>
  );
}

function CameraDialog({ open, onOpenChange, onCapture }: { open: boolean; onOpenChange: (v: boolean) => void; onCapture: (f: File) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setErr("");
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
      })
      .catch(() => setErr("Camera unavailable or permission denied. Use file upload instead."));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open]);

  const snap = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    c.toBlob((b) => {
      if (!b) return;
      onCapture(new File([b], `id_scan_${Date.now()}.png`, { type: "image/png" }));
      onOpenChange(false);
    }, "image/png");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Live ID scan" description="Frame the document. The image is OCR'd on-device and never uploaded.">
        {err ? (
          <p className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger" role="alert">
            {err}
          </p>
        ) : (
          <div className="relative overflow-hidden rounded-xl border border-line bg-black">
            <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline aria-label="Camera preview" />
            <div className="pointer-events-none absolute inset-6 rounded-lg border-2 border-accent/70" />
          </div>
        )}
        <Button className="mt-4 w-full" onClick={snap} disabled={!!err}>
          <Camera className="h-4 w-4" /> Capture & process
        </Button>
      </DialogContent>
    </Dialog>
  );
}

const numStr = (min: number, max: number) =>
  z.string().refine((v) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max), { message: `Enter a value between ${min.toLocaleString()} and ${max.toLocaleString()}` });

const editorSchema = z.object({
  age: numStr(0, 130),
  monthlyIncome: numStr(0, 1_000_000_000),
  bankBalance: numStr(0, 1_000_000_000_000),
  creditScore: numStr(300, 850),
  netWorth: numStr(0, 1_000_000_000_000),
  yearsExperience: numStr(0, 80),
  educationLevel: z.string(),
  residency: z.string(),
  citizenship: z.boolean(),
  govId: z.boolean(),
  employed: z.boolean(),
  professionalLicense: z.boolean(),
  noCriminalRecord: z.boolean(),
  noBankruptcy: z.boolean(),
  referencesVerified: z.boolean(),
  healthClear: z.boolean(),
});
type EditorValues = z.infer<typeof editorSchema>;

const numberFields = [
  { key: "age", label: "Age (years)" },
  { key: "monthlyIncome", label: "Monthly income ($)" },
  { key: "bankBalance", label: "Bank balance ($)" },
  { key: "creditScore", label: "Credit score (300–850)" },
  { key: "netWorth", label: "Net worth ($)" },
  { key: "yearsExperience", label: "Years of experience" },
] as const;

const flagFields = ["citizenship", "govId", "employed", "professionalLicense", "noCriminalRecord", "noBankruptcy", "referencesVerified", "healthClear"] as const;

function ManualEditor() {
  const [unlocked, setUnlocked] = useState(false);
  const [bio, setBio] = useState(false);
  const form = useForm<EditorValues>({
    resolver: zodResolver(editorSchema),
    defaultValues: { age: "", monthlyIncome: "", bankBalance: "", creditScore: "", netWorth: "", yearsExperience: "", educationLevel: "", residency: "", citizenship: false, govId: false, employed: false, professionalLicense: false, noCriminalRecord: false, noBankruptcy: false, referencesVerified: false, healthClear: false },
  });
  const { register, handleSubmit, reset, formState } = form;

  const load = useCallback(async () => {
    const p = await getProfile();
    const s = (n: number | undefined) => (n === undefined ? "" : String(n));
    reset({
      age: s(p.age),
      monthlyIncome: s(p.monthlyIncome),
      bankBalance: s(p.bankBalance),
      creditScore: s(p.creditScore),
      netWorth: s(p.netWorth),
      yearsExperience: s(p.yearsExperience),
      educationLevel: s(p.educationLevel),
      residency: p.residency ?? "",
      citizenship: !!p.citizenship,
      govId: !!p.govId,
      employed: !!p.employed,
      professionalLicense: !!p.professionalLicense,
      noCriminalRecord: !!p.noCriminalRecord,
      noBankruptcy: !!p.noBankruptcy,
      referencesVerified: !!p.referencesVerified,
      healthClear: !!p.healthClear,
    });
  }, [reset]);

  useEffect(() => {
    if (unlocked) void load();
  }, [unlocked, load]);

  const onSubmit = async (v: EditorValues) => {
    const n = (s: string) => (s === "" ? undefined : Number(s));
    const patch: Partial<Profile> = {
      age: n(v.age),
      monthlyIncome: n(v.monthlyIncome),
      bankBalance: n(v.bankBalance),
      creditScore: n(v.creditScore),
      netWorth: n(v.netWorth),
      yearsExperience: n(v.yearsExperience),
      educationLevel: n(v.educationLevel),
      residency: v.residency || undefined,
      citizenship: v.citizenship,
      govId: v.govId,
      employed: v.employed,
      professionalLicense: v.professionalLicense,
      noCriminalRecord: v.noCriminalRecord,
      noBankruptcy: v.noBankruptcy,
      referencesVerified: v.referencesVerified,
      healthClear: v.healthClear,
    };
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined)) as Partial<Profile>;
    try {
      await mergeProfile(clean, "Manual entry (self-asserted)");
      toast.success("Saved to encrypted vault (AES-256-GCM)");
    } catch (e) {
      toast.error(`Could not save: ${errorMessage(e)}`);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Manual Vault Editor</CardTitle>
          <p className="mt-1 text-sm text-mute">Self-asserted values. Prefer signed documents — verifiers can tell the difference.</p>
        </div>
        {!unlocked ? (
          <Button onClick={() => setBio(true)} variant="outline">
            <Lock className="h-4 w-4" /> Unlock with biometrics
          </Button>
        ) : (
          <Badge tone="ok">
            <ShieldCheck className="h-3 w-3" /> Biometric confirmed
          </Badge>
        )}
      </div>
      <BiometricDialog open={bio} onOpenChange={setBio} onConfirmed={() => setUnlocked(true)} reason="Biometric confirmation is required to edit raw vault values." />
      {unlocked ? (
        <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-5" noValidate>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {numberFields.map((f) => (
              <div key={f.key}>
                <Label htmlFor={f.key}>{f.label}</Label>
                <Input id={f.key} inputMode="decimal" {...register(f.key)} aria-invalid={!!formState.errors[f.key]} />
                {formState.errors[f.key] ? <p className="mt-1 text-xs text-danger">{formState.errors[f.key]?.message}</p> : null}
              </div>
            ))}
            <div>
              <Label htmlFor="educationLevel">Education level</Label>
              <Select id="educationLevel" {...register("educationLevel")}>
                <option value="">Not set</option>
                {EDUCATION_LEVELS.map((l, i) => (
                  <option key={l} value={i + 1}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="residency">Country of residence</Label>
              <Select id="residency" {...register("residency")}>
                <option value="">Not set</option>
                {COUNTRIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {flagFields.map((k) => (
              <label key={k} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-panel/40 px-3 py-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-cyan-500" {...register(k)} />
                {FIELD_DEFS[k].proveLabel}
              </label>
            ))}
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Changes are irreversible without backup. Export an encrypted backup from Settings → Backup & Recovery first.
          </div>
          <Button type="submit" disabled={formState.isSubmitting}>
            <Pencil className="h-4 w-4" /> Save to Encrypted Vault
          </Button>
        </form>
      ) : null}
    </Card>
  );
}

function DocRow({ doc, onView }: { doc: VaultDocument; onView: (d: VaultDocument) => void }) {
  const [busy, setBusy] = useState(false);
  const sigTone = doc.signature === "valid" ? "ok" : doc.signature === "invalid" ? "danger" : "warn";
  return (
    <motion.li layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel/40 p-3">
      <FileText className="h-8 w-8 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{doc.name}</p>
        <p className="font-mono text-[11px] text-mute" title="SHA-256 of ciphertext (plaintext is never shown)">
          🔒 {shortHash(doc.cipherHash, 14, 8)}
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Badge tone="accent">{DOC_LABELS[(doc.docType as DocumentType) in DOC_LABELS ? (doc.docType as DocumentType) : "unknown"]}</Badge>
          <Badge tone="neutral">{doc.category}</Badge>
          <Badge tone={sigTone}>signature {doc.signature}</Badge>
          <Badge tone="neutral">{formatBytes(doc.size)}</Badge>
        </div>
      </div>
      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" onClick={() => onView(doc)} aria-label={`View metadata for ${doc.name}`}>
          <Eye className="h-3.5 w-3.5" /> Metadata
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          aria-label={`Re-encrypt ${doc.name}`}
          onClick={async () => {
            setBusy(true);
            try {
              await reencryptDocument(doc.id);
              toast.success("Re-encrypted with a fresh IV");
            } catch (e) {
              toast.error(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} /> Re-encrypt
        </Button>
        <Button
          size="sm"
          variant="danger"
          aria-label={`Delete ${doc.name}`}
          onClick={async () => {
            await deleteDocument(doc.id);
            toast.success("Document deleted from vault");
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </motion.li>
  );
}

export default function VaultPage() {
  const [logs, setLogs] = useState<PipelineLog[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [selected, setSelected] = useState<{ name: string; size: number } | null>(null);
  const [camera, setCamera] = useState(false);
  const [view, setView] = useState<VaultDocument | null>(null);
  const [cat, setCat] = useState<"all" | DocCategory>("all");
  const inputRef = useRef<HTMLInputElement>(null);
  const termRef = useRef<HTMLDivElement>(null);
  const docs = useLiveQuery(() => getDb().documents.orderBy("createdAt").reverse().toArray(), []);
  const profile = useLiveQuery(() => getProfile(), [docs?.length]);

  useEffect(() => {
    termRef.current?.scrollTo({ top: termRef.current.scrollHeight, behavior: "smooth" });
  }, [logs.length]);

  const process = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setLogs([]);
    for (const f of files) {
      setSelected({ name: f.name, size: f.size });
      const res = await ingestFile(f, (l) => setLogs((prev) => [...prev, l]));
      if (res.accepted) toast.success(`${f.name} encrypted & stored locally`);
      else toast.error(`${f.name} rejected`, { description: res.reason });
    }
    setBusy(false);
  }, []);

  const loadSample = async (file: string) => {
    try {
      const res = await fetch(`/samples/${file}`);
      if (!res.ok) throw new Error("Sample not found");
      const blob = await res.blob();
      await process([new File([blob], file, { type: file.endsWith(".xml") ? "text/xml" : "text/plain" })]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const filtered = docs?.filter((d) => cat === "all" || d.category === cat);

  return (
    <div className="space-y-6">
      <PageHero title="Your Encrypted Local Vault" subtitle="Documents stored on-device. Never uploaded. Ever.">
        <GemmaStatusPill />
      </PageHero>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle>Upload zone</CardTitle>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void process(Array.from(e.dataTransfer.files));
            }}
            className={cn(
              "relative mt-3 flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-6 text-center transition",
              drag ? "border-accent bg-accent/10 shadow-[0_0_40px_-10px_var(--accent)]" : "border-line hover:border-accent/60",
            )}
          >
            <motion.div animate={{ y: drag ? -6 : [0, -5, 0] }} transition={{ duration: 2.4, repeat: Infinity }}>
              <UploadCloud className="h-12 w-12 text-accent" aria-hidden />
            </motion.div>
            <p className="text-lg font-semibold">Drag & drop a document</p>
            <p className="text-sm text-mute">PDF · JPG · PNG · Aadhaar XML · PAN · TXT — auto-detected on-device</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => inputRef.current?.click()} disabled={busy}>
                Browse files
              </Button>
              <Button variant="outline" onClick={() => setCamera(true)} disabled={busy}>
                <Camera className="h-4 w-4" /> Scan ID with camera
              </Button>
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.webp,.xml,.txt,.json,image/*,application/pdf"
              className="sr-only"
              aria-label="Choose documents to add to the vault"
              onChange={(e) => {
                void process(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            {selected ? (
              <p className="text-xs text-mute">
                Last file: <span className="text-ink">{selected.name}</span> · {formatBytes(selected.size)}
              </p>
            ) : null}
          </div>
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-mute">Try a sample (signed with demo trust anchors)</p>
            <div className="flex flex-wrap gap-2">
              {SAMPLES.map((s) => (
                <Button key={s.file} size="sm" variant={s.tone === "danger" ? "danger" : "outline"} onClick={() => void loadSample(s.file)} disabled={busy}>
                  {s.label}
                </Button>
              ))}
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-0">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="flex items-center gap-2 font-mono text-xs text-mute">
                <Terminal className="h-3.5 w-3.5 text-accent" /> gemma-agent — document pipeline
              </span>
              {busy ? <Badge tone="accent">processing…</Badge> : <Badge tone="neutral">idle</Badge>}
            </div>
            <div ref={termRef} className="h-72 overflow-y-auto bg-black/60 p-4 font-mono text-[13px] leading-relaxed" role="log" aria-live="polite">
              {logs.length === 0 ? <p className="text-slate-600">$ waiting for document…</p> : null}
              {logs.map((l, i) => (
                <div key={i} className={cn("flex gap-2", toneClass[l.tone])}>
                  <span className="shrink-0 text-slate-600">[{mmss(l.elapsedMs / 1000)}]</span>
                  <span className="shrink-0">{l.icon}</span>
                  <span className="break-all">
                    <Typed text={l.text} animate={i === logs.length - 1 && busy} />
                  </span>
                </div>
              ))}
            </div>
          </Card>
          <GemmaConsole height="h-40" />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Encrypted vault contents</CardTitle>
            <Tabs value={cat} onValueChange={(v) => setCat(v as typeof cat)}>
              <TabsList>
                {(["all", "identity", "financial", "educational", "medical"] as const).map((c) => (
                  <TabsTrigger key={c} value={c} className="px-2.5 py-1 text-xs capitalize">
                    {c}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <div className="mt-4">
            {!filtered ? (
              <Skeleton className="h-24" />
            ) : filtered.length === 0 ? (
              <EmptyState icon={<Lock className="h-6 w-6" />} title="Vault is empty" hint="Drop a document above or load a signed sample. Contents are encrypted before they touch IndexedDB." />
            ) : (
              <ul className="space-y-2.5">
                <AnimatePresence initial={false}>
                  {filtered.map((d) => (
                    <DocRow key={d.id} doc={d} onView={setView} />
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardTitle>Proof-ready attributes</CardTitle>
          <p className="mt-1 text-xs text-mute">Decrypted in memory only. Never displayed to verifiers.</p>
          <dl className="mt-3 divide-y divide-line/60 text-sm">
            {profile
              ? FIELD_KEYS.filter((k) => profile[k] !== undefined).map((k) => (
                  <div key={k} className="flex items-center justify-between gap-2 py-1.5">
                    <dt className="text-mute">{FIELD_DEFS[k].label}</dt>
                    <dd className="text-right">
                      <span className="font-semibold">{formatProfileValue(k, profile)}</span>
                      <span className="block text-[10px] text-slate-500">{profile.sources?.[k]}</span>
                    </dd>
                  </div>
                ))
              : null}
          </dl>
          {profile && FIELD_KEYS.every((k) => profile[k] === undefined) ? <p className="mt-3 text-sm text-mute">No attributes yet. Upload a document or use the manual editor.</p> : null}
        </Card>
      </div>

      <ManualEditor />

      <section aria-labelledby="supported">
        <h2 id="supported" className="mb-3 text-xl font-bold">
          Supported document types
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {SUPPORTED.map((s) => (
            <Card key={s.name} className="glass-lift flex items-center gap-3 p-4">
              <s.icon className="h-7 w-7 shrink-0 text-accent" aria-hidden />
              <div>
                <p className="text-sm font-semibold">{s.name}</p>
                <p className="text-xs text-mute">{s.hint}</p>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <CameraDialog open={camera} onOpenChange={setCamera} onCapture={(f) => void process([f])} />
      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        {view ? (
          <DialogContent title="Document metadata" description="Only metadata is shown. Plaintext stays encrypted.">
            <dl className="space-y-2 font-mono text-xs">
              {(
                [
                  ["Name", view.name],
                  ["Type", view.docType],
                  ["Category", view.category],
                  ["MIME", view.mime],
                  ["Size", formatBytes(view.size)],
                  ["Signature", `${view.signature}${view.authority ? ` · ${view.authority}` : ""}`],
                  ["Confidence", `${Math.round(view.confidence * 100)}%`],
                  ["Parsed by", view.engine],
                  ["Plaintext SHA-256", view.plainHash],
                  ["Ciphertext SHA-256", view.cipherHash],
                  ["IV (96-bit)", Array.from(view.iv, (b) => b.toString(16).padStart(2, "0")).join("")],
                  ["Added", `${new Date(view.createdAt).toLocaleString()} (${timeAgo(view.createdAt)})`],
                  ["Re-encrypted", view.reencryptedAt ? new Date(view.reencryptedAt).toLocaleString() : "never"],
                  ["Attributes derived", view.fieldKeys.join(", ") || "none"],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[130px_1fr] gap-2">
                  <dt className="text-mute">{k}</dt>
                  <dd className="break-all text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
