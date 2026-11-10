import Dexie, { type EntityTable } from "dexie";

export type DocCategory = "identity" | "financial" | "educational" | "medical";
export type SignatureState = "valid" | "invalid" | "none";
export type VerifyResult = "verified" | "expired" | "revoked" | "invalid";

export interface VaultDocument {
  id: string;
  name: string;
  mime: string;
  size: number;
  category: DocCategory;
  docType: string;
  /** SHA-256 of the plaintext (never leaves the device). */
  plainHash: string;
  /** SHA-256 of the AES-256-GCM ciphertext – safe to display. */
  cipherHash: string;
  iv: Uint8Array;
  cipher: ArrayBuffer;
  signature: SignatureState;
  authority?: string;
  confidence: number;
  fieldKeys: string[];
  engine: string;
  createdAt: number;
  reencryptedAt?: number;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface SecretRow {
  id: string;
  iv: Uint8Array;
  cipher: ArrayBuffer;
}

export interface ProofRecord {
  id: string;
  createdAt: number;
  expiresAt: number;
  circuit: "range" | "logic" | "synthetic";
  category: "identity" | "financial" | "qualification" | "background" | "custom";
  label: string;
  conditions: string[];
  verifierType: string;
  status: "active" | "revoked";
  revokedAt?: number;
  proofHash: string;
  sizeBytes: number;
  genMs: number;
  payload?: string;
  shares: number;
  synthetic?: boolean;
}

export interface VerificationRecord {
  id: string;
  at: number;
  proofId: string;
  label: string;
  result: VerifyResult;
  ms: number;
  synthetic?: boolean;
}

export interface EventRecord {
  id: string;
  at: number;
  kind: "proof" | "verify" | "vault" | "panic" | "revoke" | "security";
  message: string;
  status: "ok" | "warn" | "error";
}

export interface RevocationRecord {
  proofId: string;
  at: number;
  source: "local" | "gossip";
}

class VaultDB extends Dexie {
  documents!: EntityTable<VaultDocument, "id">;
  meta!: EntityTable<MetaRow, "key">;
  secrets!: EntityTable<SecretRow, "id">;
  proofs!: EntityTable<ProofRecord, "id">;
  verifications!: EntityTable<VerificationRecord, "id">;
  events!: EntityTable<EventRecord, "id">;
  revocations!: EntityTable<RevocationRecord, "proofId">;

  constructor() {
    super("vaultzk");
    this.version(1).stores({
      documents: "id, category, createdAt",
      meta: "key",
      secrets: "id",
      proofs: "id, createdAt, expiresAt, status, category",
      verifications: "id, at, result, proofId",
      events: "id, at, kind",
      revocations: "proofId, at",
    });
  }
}

let instance: VaultDB | null = null;

export function getDb(): VaultDB {
  if (!instance) instance = new VaultDB();
  return instance;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await getDb().meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await getDb().meta.put({ key, value });
}
