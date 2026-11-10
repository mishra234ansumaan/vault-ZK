import { getDb, type ProofRecord, type VerifyResult } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto";
import { parsePayload, verifyProofMath, generateProof, DEMO_PROFILE, type GeneratedProof, type ProofPayload } from "@/lib/zk";
import type { ProofCategory, ProofSpec } from "@/lib/fields";
import { logEvent } from "@/lib/vault";
import { uid } from "@/lib/utils";

const CHANNEL = "vaultzk-revocations";
let channel: BroadcastChannel | null = null;
let gossipStarted = false;

/** Revocation gossip: BroadcastChannel peers (other tabs / verifier windows) merge revocation lists. */
export function startGossip(): void {
  if (gossipStarted || typeof BroadcastChannel === "undefined") return;
  gossipStarted = true;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = async (ev: MessageEvent<{ type: string; ids: string[] }>) => {
    if (ev.data?.type !== "revoke" || !Array.isArray(ev.data.ids)) return;
    const db = getDb();
    for (const id of ev.data.ids) {
      if (!(await db.revocations.get(id))) await db.revocations.put({ proofId: id, at: Date.now(), source: "gossip" });
    }
  };
}

function gossip(ids: string[]): void {
  startGossip();
  channel?.postMessage({ type: "revoke", ids });
}

export async function revocationDigest(): Promise<string> {
  const ids = (await getDb().revocations.toArray()).map((r) => r.proofId).sort();
  return sha256Hex(ids.join("|"));
}

export async function saveGeneratedProof(
  g: GeneratedProof,
  spec: ProofSpec,
  category: ProofCategory,
  verifierType: string,
): Promise<ProofRecord> {
  void spec;
  const rec: ProofRecord = {
    id: g.id,
    createdAt: Date.now(),
    expiresAt: g.expiresAt,
    circuit: g.circuit,
    category,
    label: g.label,
    conditions: g.conditions,
    verifierType,
    status: "active",
    proofHash: g.proofHash,
    sizeBytes: g.sizeBytes,
    genMs: g.genMs,
    payload: JSON.stringify(g.payload),
    shares: 0,
  };
  await getDb().proofs.put(rec);
  await logEvent("proof", `Generated ${g.circuit} proof: ${g.label}`);
  return rec;
}

export async function revokeProofs(ids: string[], reason = "Revoked by user"): Promise<number> {
  const db = getDb();
  const now = Date.now();
  let n = 0;
  for (const id of ids) {
    const p = await db.proofs.get(id);
    if (p && p.status !== "revoked") {
      await db.proofs.update(id, { status: "revoked", revokedAt: now });
      n++;
    }
    await db.revocations.put({ proofId: id, at: now, source: "local" });
  }
  if (ids.length) {
    gossip(ids);
    await logEvent("revoke", `${reason}: ${ids.length} proof(s) added to revocation list`, "warn");
  }
  return n;
}

/** Global kill-switch: revokes every non-expired proof instantly. */
export async function panicRevokeAll(): Promise<number> {
  const db = getDb();
  const now = Date.now();
  const active = await db.proofs.where("status").equals("active").filter((p) => p.expiresAt > now).toArray();
  const ids = active.map((p) => p.id);
  const n = await revokeProofs(ids, "PANIC KILL-SWITCH");
  await logEvent("panic", `Panic button pressed — ${n} active proof(s) invalidated`, "error");
  return n;
}

export interface VerifyOutcome {
  result: VerifyResult;
  reason: string;
  ms: number;
  id: string;
  circuit: "range" | "logic";
  label: string;
  conditionLabels: string[];
  issuedAt: number;
  expiresAt: number;
  revokedAt?: number;
  expiredAgoSec?: number;
  nonce?: string;
  verifier?: string;
}

/** Full verifier pipeline: structure → Groth16 math → revocation list → time-bomb window. */
export async function verifyPayloadText(text: string, record = true): Promise<VerifyOutcome> {
  const parsed = parsePayload(text);
  const t0 = performance.now();
  if (!parsed.ok) {
    const out: VerifyOutcome = {
      result: "invalid",
      reason: parsed.reason,
      ms: Math.round(performance.now() - t0),
      id: "—",
      circuit: "range",
      label: "Unparseable payload",
      conditionLabels: [],
      issuedAt: 0,
      expiresAt: 0,
    };
    if (record) await recordVerification(out);
    return out;
  }
  const payload: ProofPayload = parsed.payload;
  const math = await verifyProofMath(payload);
  const decoded = math.decoded;
  const base = {
    ms: 0,
    id: payload.id,
    circuit: payload.circuit,
    label: decoded?.formula ?? "Unknown condition",
    conditionLabels: decoded?.conditionLabels ?? [],
    issuedAt: payload.issuedAt * 1000,
    expiresAt: decoded?.expiresAt ?? 0,
    nonce: decoded?.nonce,
    verifier: payload.verifier,
  };
  let out: VerifyOutcome;
  if (!math.ok) {
    out = { ...base, result: "invalid", reason: math.reason, ms: math.ms };
  } else {
    const rev = await getDb().revocations.get(payload.id);
    const now = Date.now();
    if (rev) {
      out = { ...base, result: "revoked", reason: "The holder revoked this proof; it appears on the revocation list.", ms: math.ms, revokedAt: rev.at };
    } else if (base.expiresAt <= now) {
      out = { ...base, result: "expired", reason: "The time-bomb window bound into the proof has elapsed.", ms: math.ms, expiredAgoSec: Math.floor((now - base.expiresAt) / 1000) };
    } else {
      out = { ...base, result: "verified", reason: math.reason, ms: math.ms };
    }
  }
  if (record) await recordVerification(out);
  return out;
}

async function recordVerification(o: VerifyOutcome): Promise<void> {
  const db = getDb();
  await db.verifications.add({ id: uid("ver"), at: Date.now(), proofId: o.id, label: o.label, result: o.result, ms: o.ms });
  await logEvent("verify", `Verification ${o.result.toUpperCase()}: ${o.label}`, o.result === "verified" ? "ok" : "error");
  if (o.result === "verified") {
    const p = await db.proofs.get(o.id);
    if (p) await db.proofs.update(o.id, { shares: p.shares + 1 });
  }
}

export type ExampleKind = "valid" | "expired" | "tampered";

/** Generates a REAL Groth16 proof from a demo profile for testing the verifier. */
export async function generateExampleProof(kind: ExampleKind): Promise<string> {
  const spec: ProofSpec = { mode: "single", condition: { field: "bankBalance", threshold: 50000 } };
  const nowSec = Math.floor(Date.now() / 1000);
  const g = await generateProof(spec, DEMO_PROFILE, {
    ttlSeconds: 60,
    randomizeNonce: true,
    expiresAtSec: kind === "expired" ? nowSec - 125 : nowSec + 60,
  });
  const payload = { ...g.payload, signals: [...g.payload.signals] };
  if (kind === "tampered") payload.signals[1] = "10";
  return JSON.stringify(payload, null, 2);
}

export type DerivedStatus = "active" | "verified" | "expired" | "revoked";

export function deriveStatus(p: ProofRecord, verifiedCount: number, now = Date.now()): DerivedStatus {
  if (p.status === "revoked") return "revoked";
  if (verifiedCount > 0) return "verified";
  if (p.expiresAt <= now) return "expired";
  return "active";
}

export function proofCategoryLabel(c: ProofRecord["category"]): string {
  return { identity: "Identity", financial: "Financial", qualification: "Qualifications", background: "Background", custom: "Custom logic" }[c];
}
