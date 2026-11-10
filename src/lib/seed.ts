import { getDb, getMeta, setMeta, type ProofRecord, type VerificationRecord, type VerifyResult } from "@/lib/db";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEMPLATES: Array<{ cat: ProofRecord["category"]; label: string; verifier: string }> = [
  { cat: "identity", label: "Age ≥ 21", verifier: "bar" },
  { cat: "identity", label: "Age ≥ 18", verifier: "govt" },
  { cat: "identity", label: "Citizenship verified", verifier: "govt" },
  { cat: "financial", label: "Bank balance ≥ $50,000", verifier: "bank" },
  { cat: "financial", label: "Monthly income ≥ $4,500", verifier: "landlord" },
  { cat: "financial", label: "Credit score ≥ 700", verifier: "bank" },
  { cat: "qualification", label: "Education level ≥ Bachelor's", verifier: "govt" },
  { cat: "qualification", label: "Years of experience ≥ 3", verifier: "govt" },
  { cat: "background", label: "No criminal record", verifier: "landlord" },
  { cat: "custom", label: "(Age ≥ 21 AND Monthly income ≥ $5,000) OR Credit score ≥ 750", verifier: "bank" },
];

/** Seeds clearly-flagged synthetic history so the audit charts are populated on first launch. */
export async function seedDemoHistory(force = false): Promise<void> {
  if (!force && (await getMeta<boolean>("seeded"))) return;
  const db = getDb();
  const rand = mulberry32(2024);
  const now = Date.now();
  const proofs: ProofRecord[] = [];
  const verifs: VerificationRecord[] = [];
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("");

  for (let i = 0; i < 247; i++) {
    const day = Math.floor(Math.pow(rand(), 1.3) * 30);
    const hour = Math.min(23, Math.max(0, Math.round(13 + (rand() + rand() + rand() - 1.5) * 8)));
    const at = now - day * 86_400_000 - (rand() * 3_600_000) - Math.max(0, (new Date(now).getHours() - hour)) * 3_600_000;
    const t = TEMPLATES[Math.floor(rand() * TEMPLATES.length)];
    const ttl = [60, 60, 300, 900, 3600][Math.floor(rand() * 5)] * 1000;
    const id = `vzk_${hex(12)}`;
    const revoked = i % 49 === 7;
    proofs.push({
      id,
      createdAt: at,
      expiresAt: at + ttl,
      circuit: "synthetic",
      category: t.cat,
      label: t.label,
      conditions: [t.label],
      verifierType: t.verifier,
      status: revoked ? "revoked" : "active",
      revokedAt: revoked ? at + ttl / 3 : undefined,
      proofHash: hex(64),
      sizeBytes: 780 + Math.floor(rand() * 90),
      genMs: 280 + Math.floor(rand() * 320),
      shares: 0,
      synthetic: true,
    });
  }
  proofs.sort((a, b) => a.createdAt - b.createdAt);
  for (let i = 0; i < 198; i++) {
    const p = proofs[Math.floor(rand() * proofs.length)];
    const r = rand();
    const result: VerifyResult = p.status === "revoked" && r < 0.5 ? "revoked" : r < 0.88 ? "verified" : r < 0.97 ? "expired" : "invalid";
    verifs.push({
      id: `ver_${hex(12)}`,
      at: p.createdAt + 4000 + Math.floor(rand() * 40_000),
      proofId: p.id,
      label: p.label,
      result,
      ms: 18 + Math.floor(rand() * 40),
      synthetic: true,
    });
  }
  await db.proofs.bulkPut(proofs);
  await db.verifications.bulkPut(verifs);
  await setMeta("seeded", true);
}

export async function clearSyntheticHistory(): Promise<void> {
  const db = getDb();
  await db.proofs.filter((p) => p.synthetic === true).delete();
  await db.verifications.filter((v) => v.synthetic === true).delete();
  await setMeta("seeded", true);
}
