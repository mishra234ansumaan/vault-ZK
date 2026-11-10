import { z } from "zod";
import {
  COUNTRIES,
  FIELD_BY_CODE,
  FIELD_DEFS,
  describeCondition,
  type Condition,
  type FieldKey,
  type Profile,
  type ProofSpec,
} from "@/lib/fields";
import { randomBytes, randomFieldElement, sha256Hex, toHex } from "@/lib/crypto";

/* ------------------------------------------------------------------ */
/* snarkjs loader (vendored UMD bundle → works with Wi-Fi disabled)     */
/* ------------------------------------------------------------------ */

interface SnarkProof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
  curve: string;
}

interface SnarkJS {
  groth16: {
    prove(zkey: string, wtns: unknown): Promise<{ proof: SnarkProof; publicSignals: string[] }>;
    fullProve(input: Record<string, unknown>, wasm: string, zkey: string): Promise<{ proof: SnarkProof; publicSignals: string[] }>;
    verify(vkey: unknown, signals: string[], proof: SnarkProof): Promise<boolean>;
  };
  wtns: {
    calculate(input: Record<string, unknown>, wasm: string, wtns: { type: "mem" }): Promise<void>;
  };
}

declare global {
  interface Window {
    snarkjs?: SnarkJS;
  }
}

let snarkPromise: Promise<SnarkJS> | null = null;

export function loadSnarkjs(): Promise<SnarkJS> {
  if (typeof window === "undefined") return Promise.reject(new Error("snarkjs is browser-only"));
  if (window.snarkjs) return Promise.resolve(window.snarkjs);
  if (!snarkPromise) {
    snarkPromise = new Promise<SnarkJS>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/zk/snarkjs.min.js";
      s.async = true;
      s.onload = () => (window.snarkjs ? resolve(window.snarkjs) : reject(new Error("snarkjs failed to initialise")));
      s.onerror = () => {
        snarkPromise = null;
        reject(new Error("Could not load /zk/snarkjs.min.js"));
      };
      document.head.appendChild(s);
    });
  }
  return snarkPromise;
}

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export type CircuitName = "range" | "logic";

export const proofPayloadSchema = z.object({
  v: z.literal(1),
  id: z.string().min(4),
  circuit: z.enum(["range", "logic"]),
  proof: z.object({
    a: z.tuple([z.string(), z.string()]),
    b: z.tuple([z.tuple([z.string(), z.string()]), z.tuple([z.string(), z.string()])]),
    c: z.tuple([z.string(), z.string()]),
  }),
  signals: z.array(z.string()).min(5).max(16),
  issuedAt: z.number().int().positive(),
  verifier: z.string().max(40).optional(),
});

export type ProofPayload = z.infer<typeof proofPayloadSchema>;

export interface GeneratedProof {
  payload: ProofPayload;
  id: string;
  proofHash: string;
  circuit: CircuitName;
  expiresAt: number;
  sizeBytes: number;
  genMs: number;
  stageMs: { witness: number; prove: number };
  label: string;
  conditions: string[];
  vkFingerprint: string;
  constraints: number;
  nonce: string;
}

export interface DecodedProof {
  circuit: CircuitName;
  conditions: Condition[];
  conditionLabels: string[];
  formula: string;
  expiresAt: number;
  nonce: string;
  commitment: string;
}

export interface MathVerification {
  ok: boolean;
  reason: string;
  ms: number;
  decoded: DecodedProof | null;
}

const BITS = 48;
const MAX_VALUE = 2 ** BITS - 1;
export const CIRCUIT_CONSTRAINTS: Record<CircuitName, number> = { range: 291, logic: 536 };

/* ------------------------------------------------------------------ */
/* Witness construction                                                 */
/* ------------------------------------------------------------------ */

function witnessValue(profile: Profile, c: Condition): number {
  const def = FIELD_DEFS[c.field];
  const raw = profile[c.field];
  switch (def.kind) {
    case "flag":
      return raw === true ? 1 : 0;
    case "residency": {
      const idx = typeof raw === "string" ? COUNTRIES.indexOf(raw) + 1 : 0;
      return idx > 0 && idx === c.threshold ? idx : 0;
    }
    default: {
      if (typeof raw !== "number") throw new Error(`Your vault has no "${def.label}" value yet. Add a document or enter it in Vault Setup.`);
      return Math.max(0, Math.round(raw));
    }
  }
}

function evalCondition(c: Condition, profile: Profile): boolean {
  const ge = witnessValue(profile, c) >= c.threshold;
  return c.negate ? !ge : ge;
}

export function evaluateSpec(spec: ProofSpec, profile: Profile): boolean {
  if (spec.mode === "single") return evalCondition(spec.condition, profile);
  const grp = (g: Condition[], empty: boolean) => (g.length === 0 ? empty : g.every((c) => evalCondition(c, profile)));
  const a = grp(spec.groupA, spec.op === "AND");
  const b = grp(spec.groupB, spec.op === "AND");
  return spec.op === "AND" ? a && b : a || b;
}

interface Slot {
  value: number;
  threshold: number;
  field: number;
  neg: number;
}

function fillerTrue(): Slot {
  return { value: 0, threshold: 0, field: 0, neg: 0 };
}
function fillerFalse(): Slot {
  return { value: 0, threshold: 1, field: 0, neg: 0 };
}

function toSlot(c: Condition, profile: Profile): Slot {
  return { value: witnessValue(profile, c), threshold: c.threshold, field: FIELD_DEFS[c.field].code, neg: c.negate ? 1 : 0 };
}

function groupSlots(g: Condition[], profile: Profile, op: "AND" | "OR"): [Slot, Slot] {
  if (g.length === 0) return op === "AND" ? [fillerTrue(), fillerTrue()] : [fillerFalse(), fillerTrue()];
  const first = toSlot(g[0], profile);
  const second = g[1] ? toSlot(g[1], profile) : fillerTrue();
  return [first, second];
}

function assertRanges(vals: number[]): void {
  for (const v of vals) {
    if (!Number.isInteger(v) || v < 0 || v > MAX_VALUE) throw new Error("A value is outside the supported range (0 – 2^48).");
  }
}

export function specLabel(spec: ProofSpec): { label: string; conditions: string[] } {
  if (spec.mode === "single") {
    const t = describeCondition(spec.condition);
    return { label: t, conditions: [t] };
  }
  const a = spec.groupA.map(describeCondition);
  const b = spec.groupB.map(describeCondition);
  const wrap = (x: string[]) => (x.length > 1 ? `(${x.join(" AND ")})` : x.join(""));
  const parts = [wrap(a), wrap(b)].filter(Boolean);
  return { label: parts.join(` ${spec.op} `), conditions: [...a, ...b] };
}

/* ------------------------------------------------------------------ */
/* Proof generation                                                     */
/* ------------------------------------------------------------------ */

export interface GenerateOptions {
  ttlSeconds: number;
  randomizeNonce: boolean;
  verifier?: string;
  expiresAtSec?: number;
  onStage?: (stage: "witness" | "prove" | "finalize") => void;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return (await res.json()) as T;
}

export async function getVkFingerprint(circuit: CircuitName): Promise<string> {
  const vk = await fetchJson<unknown>(`/zk/${circuit}_vkey.json`);
  return sha256Hex(JSON.stringify(vk));
}

function canonical(circuit: string, proof: ProofPayload["proof"], signals: string[]): string {
  return JSON.stringify({ circuit, proof, signals });
}

export async function computeProofId(p: Pick<ProofPayload, "circuit" | "proof" | "signals">): Promise<{ id: string; hash: string }> {
  const hash = await sha256Hex(canonical(p.circuit, p.proof, p.signals));
  return { id: `vzk_${hash.slice(0, 12)}`, hash };
}

export async function generateProof(spec: ProofSpec, profile: Profile, opts: GenerateOptions): Promise<GeneratedProof> {
  if (!evaluateSpec(spec, profile)) {
    throw new Error("Your vault data does not satisfy this condition — a valid proof cannot exist. (That is zero-knowledge soundness at work.)");
  }
  const snark = await loadSnarkjs();
  const t0 = performance.now();
  const nowSec = Math.floor(Date.now() / 1000);
  const expirySec = opts.expiresAtSec ?? nowSec + Math.max(5, Math.round(opts.ttlSeconds));
  const nonce = opts.randomizeNonce ? BigInt(`0x${toHex(randomBytes(6))}`).toString(10) : "1";
  const salt = randomFieldElement();

  let circuit: CircuitName;
  let input: Record<string, unknown>;
  if (spec.mode === "single" && !spec.condition.negate) {
    circuit = "range";
    const value = witnessValue(profile, spec.condition);
    assertRanges([value, spec.condition.threshold]);
    input = {
      value: String(value),
      salt,
      threshold: String(spec.condition.threshold),
      nonce,
      expiry: String(expirySec),
      predicate: String(FIELD_DEFS[spec.condition.field].code),
    };
  } else {
    circuit = "logic";
    const normalized: Extract<ProofSpec, { mode: "logic" }> =
      spec.mode === "single" ? { mode: "logic", groupA: [spec.condition], groupB: [], op: "AND" } : spec;
    if (normalized.groupA.length > 2 || normalized.groupB.length > 2) throw new Error("Each group supports at most two conditions.");
    if (normalized.groupA.length + normalized.groupB.length === 0) throw new Error("Add at least one condition to the circuit.");
    const slots = [...groupSlots(normalized.groupA, profile, normalized.op), ...groupSlots(normalized.groupB, profile, normalized.op)];
    assertRanges(slots.flatMap((s) => [s.value, s.threshold]));
    input = {
      value: slots.map((s) => String(s.value)),
      salt,
      threshold: slots.map((s) => String(s.threshold)),
      field: slots.map((s) => String(s.field)),
      neg: slots.map((s) => String(s.neg)),
      op: normalized.op === "OR" ? "1" : "0",
      nonce,
      expiry: String(expirySec),
    };
  }

  opts.onStage?.("witness");
  const tw = performance.now();
  let proofOut: { proof: SnarkProof; publicSignals: string[] };
  let witnessMs = 0;
  let proveMs = 0;
  if (typeof snark.wtns?.calculate === "function") {
    const wtns = { type: "mem" as const };
    await snark.wtns.calculate(input, `/zk/${circuit}.wasm`, wtns);
    witnessMs = performance.now() - tw;
    opts.onStage?.("prove");
    const tp = performance.now();
    proofOut = await snark.groth16.prove(`/zk/${circuit}_final.zkey`, wtns);
    proveMs = performance.now() - tp;
  } else {
    opts.onStage?.("prove");
    proofOut = await snark.groth16.fullProve(input, `/zk/${circuit}.wasm`, `/zk/${circuit}_final.zkey`);
    proveMs = performance.now() - tw;
  }
  const { proof, publicSignals } = proofOut;

  opts.onStage?.("finalize");
  const compact: ProofPayload["proof"] = {
    a: [proof.pi_a[0], proof.pi_a[1]],
    b: [
      [proof.pi_b[0][0], proof.pi_b[0][1]],
      [proof.pi_b[1][0], proof.pi_b[1][1]],
    ],
    c: [proof.pi_c[0], proof.pi_c[1]],
  };
  const { id, hash } = await computeProofId({ circuit, proof: compact, signals: publicSignals });
  const payload: ProofPayload = {
    v: 1,
    id,
    circuit,
    proof: compact,
    signals: publicSignals,
    issuedAt: nowSec,
    ...(opts.verifier ? { verifier: opts.verifier } : {}),
  };
  const { label, conditions } = specLabel(spec);
  const vkFingerprint = await getVkFingerprint(circuit);
  return {
    payload,
    id,
    proofHash: hash,
    circuit,
    expiresAt: expirySec * 1000,
    sizeBytes: new TextEncoder().encode(JSON.stringify(payload)).length,
    genMs: Math.round(performance.now() - t0),
    stageMs: { witness: Math.round(witnessMs), prove: Math.round(proveMs) },
    label,
    conditions,
    vkFingerprint,
    constraints: CIRCUIT_CONSTRAINTS[circuit],
    nonce,
  };
}

/* ------------------------------------------------------------------ */
/* Decoding + verification                                              */
/* ------------------------------------------------------------------ */

export function decodeSignals(circuit: CircuitName, signals: string[]): DecodedProof | null {
  try {
    if (circuit === "range") {
      if (signals.length !== 5) return null;
      const def = FIELD_BY_CODE[Number(signals[4])];
      if (!def) return null;
      const c: Condition = { field: def.key, threshold: Number(signals[1]) };
      return {
        circuit,
        conditions: [c],
        conditionLabels: [describeCondition(c)],
        formula: describeCondition(c),
        expiresAt: Number(signals[3]) * 1000,
        nonce: signals[2],
        commitment: signals[0],
      };
    }
    if (signals.length !== 16) return null;
    const slots: Array<Condition | null | "false"> = [];
    for (let i = 0; i < 4; i++) {
      const thr = Number(signals[1 + i]);
      const code = Number(signals[5 + i]);
      const neg = signals[9 + i] === "1";
      if (code === 0) {
        slots.push(thr === 1 ? "false" : null);
        continue;
      }
      const def = FIELD_BY_CODE[code];
      if (!def) return null;
      slots.push({ field: def.key as FieldKey, threshold: thr, negate: neg });
    }
    const op = signals[13] === "1" ? "OR" : "AND";
    const real = (a: Condition | null | "false"): a is Condition => typeof a === "object" && a !== null;
    const gA = [slots[0], slots[1]].filter(real);
    const gB = [slots[2], slots[3]].filter(real);
    const wrap = (g: Condition[]) => (g.length > 1 ? `(${g.map(describeCondition).join(" AND ")})` : g.map(describeCondition).join(""));
    const formula = [wrap(gA), wrap(gB)].filter(Boolean).join(` ${op} `);
    const all = [...gA, ...gB];
    return {
      circuit,
      conditions: all,
      conditionLabels: all.map(describeCondition),
      formula,
      expiresAt: Number(signals[15]) * 1000,
      nonce: signals[14],
      commitment: signals[0],
    };
  } catch {
    return null;
  }
}

export async function verifyProofMath(payload: ProofPayload): Promise<MathVerification> {
  const t0 = performance.now();
  const done = (ok: boolean, reason: string, decoded: DecodedProof | null): MathVerification => ({
    ok,
    reason,
    ms: Math.max(1, Math.round(performance.now() - t0)),
    decoded,
  });
  const decoded = decodeSignals(payload.circuit, payload.signals);
  if (!decoded) return done(false, "Public signals are malformed for this circuit.", null);
  try {
    const { id } = await computeProofId(payload);
    if (id !== payload.id) return done(false, "Proof ID does not match proof contents (payload was altered).", decoded);
    const snark = await loadSnarkjs();
    const vkey = await fetchJson<unknown>(`/zk/${payload.circuit}_vkey.json`);
    const proof: SnarkProof = {
      pi_a: [payload.proof.a[0], payload.proof.a[1], "1"],
      pi_b: [
        [payload.proof.b[0][0], payload.proof.b[0][1]],
        [payload.proof.b[1][0], payload.proof.b[1][1]],
        ["1", "0"],
      ],
      pi_c: [payload.proof.c[0], payload.proof.c[1], "1"],
      protocol: "groth16",
      curve: "bn128",
    };
    const ok = await snark.groth16.verify(vkey, payload.signals, proof);
    return done(ok, ok ? "Groth16 pairing check passed." : "Groth16 pairing check failed — proof or public inputs were tampered with.", decoded);
  } catch (e) {
    return done(false, e instanceof Error ? `Verification error: ${e.message}` : "Verification error", decoded);
  }
}

export function parsePayload(text: string): { ok: true; payload: ProofPayload } | { ok: false; reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(text.trim());
  } catch {
    return { ok: false, reason: "Input is not valid JSON." };
  }
  const parsed = proofPayloadSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, reason: `Payload structure invalid: ${first?.path.join(".") || "root"} – ${first?.message ?? "unknown"}` };
  }
  return { ok: true, payload: parsed.data };
}

/** Demo profile used only by the verifier page's example generator. */
export const DEMO_PROFILE: Profile = { age: 29, bankBalance: 84250, monthlyIncome: 6400, creditScore: 782, citizenship: true };
