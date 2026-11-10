import { getDb, getMeta, setMeta, type DocCategory, type VaultDocument } from "@/lib/db";
import { base64ToBytes, bytesToBase64, deriveKey, open, openJson, randomBytes, seal, sealJson, sha256Hex, toHex } from "@/lib/crypto";
import type { FieldKey, Profile } from "@/lib/fields";
import { uid } from "@/lib/utils";

export async function logEvent(kind: "proof" | "verify" | "vault" | "panic" | "revoke" | "security", message: string, status: "ok" | "warn" | "error" = "ok"): Promise<void> {
  await getDb().events.add({ id: uid("evt"), at: Date.now(), kind, message, status });
}

export async function getProfile(): Promise<Profile> {
  const row = await getDb().secrets.get("profile");
  if (!row) return {};
  try {
    return await openJson<Profile>(row);
  } catch {
    return {};
  }
}

export async function saveProfile(profile: Profile): Promise<void> {
  const sealed = await sealJson(profile);
  await getDb().secrets.put({ id: "profile", iv: sealed.iv, cipher: sealed.cipher });
}

export async function mergeProfile(patch: Partial<Profile>, source: string): Promise<Profile> {
  const current = await getProfile();
  const sources = { ...(current.sources ?? {}) };
  (Object.keys(patch) as Array<keyof Profile>).forEach((k) => {
    if (k !== "sources" && patch[k] !== undefined) sources[k as FieldKey | "name"] = source;
  });
  const merged: Profile = { ...current, ...patch, sources };
  await saveProfile(merged);
  return merged;
}

export interface StoreDocumentInput {
  file: File;
  bytes: Uint8Array;
  category: DocCategory;
  docType: string;
  signature: "valid" | "invalid" | "none";
  authority?: string;
  confidence: number;
  fieldKeys: string[];
  engine: string;
}

export async function storeDocument(input: StoreDocumentInput): Promise<VaultDocument> {
  const sealed = await seal(input.bytes);
  const doc: VaultDocument = {
    id: uid("doc"),
    name: input.file.name,
    mime: input.file.type || "application/octet-stream",
    size: input.file.size,
    category: input.category,
    docType: input.docType,
    plainHash: await sha256Hex(input.bytes),
    cipherHash: await sha256Hex(sealed.cipher),
    iv: sealed.iv,
    cipher: sealed.cipher,
    signature: input.signature,
    authority: input.authority,
    confidence: input.confidence,
    fieldKeys: input.fieldKeys,
    engine: input.engine,
    createdAt: Date.now(),
  };
  await getDb().documents.add(doc);
  return doc;
}

export async function reencryptDocument(id: string): Promise<VaultDocument> {
  const db = getDb();
  const doc = await db.documents.get(id);
  if (!doc) throw new Error("Document not found");
  const plain = await open(doc);
  const sealed = await seal(plain);
  const patch = { iv: sealed.iv, cipher: sealed.cipher, cipherHash: await sha256Hex(sealed.cipher), reencryptedAt: Date.now() };
  await db.documents.update(id, patch);
  await logEvent("vault", `Re-encrypted ${doc.name} with a fresh AES-256-GCM IV`);
  return { ...doc, ...patch };
}

export async function deleteDocument(id: string): Promise<void> {
  const doc = await getDb().documents.get(id);
  await getDb().documents.delete(id);
  if (doc) await logEvent("vault", `Deleted ${doc.name} from vault`, "warn");
}

export async function vaultId(): Promise<string> {
  let id = await getMeta<string>("vaultId");
  if (!id) {
    id = `VZK-${toHex(randomBytes(4)).toUpperCase()}-${toHex(randomBytes(4)).toUpperCase()}`;
    await setMeta("vaultId", id);
  }
  return id;
}

export async function vaultBytesUsed(): Promise<number> {
  const docs = await getDb().documents.toArray();
  return docs.reduce((n, d) => n + d.cipher.byteLength + 28, 0);
}

interface BackupFile {
  format: "vaultzk-backup";
  version: 1;
  salt: string;
  iv: string;
  data: string;
  createdAt: string;
}

interface BackupContent {
  profile: Profile;
  documents: Array<Omit<VaultDocument, "iv" | "cipher"> & { plain: string }>;
}

/** Exports the vault re-encrypted under a key derived from the recovery phrase. */
export async function exportBackup(phrase: string): Promise<string> {
  const db = getDb();
  const docs = await db.documents.toArray();
  const content: BackupContent = {
    profile: await getProfile(),
    documents: await Promise.all(
      docs.map(async (d) => {
        const { iv, cipher, ...rest } = d;
        void iv;
        void cipher;
        return { ...rest, plain: bytesToBase64(await open(d)) };
      }),
    ),
  };
  const salt = randomBytes(16);
  const key = await deriveKey(phrase, salt);
  const sealed = await sealJson(content, key);
  const file: BackupFile = {
    format: "vaultzk-backup",
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(sealed.iv),
    data: bytesToBase64(new Uint8Array(sealed.cipher)),
    createdAt: new Date().toISOString(),
  };
  return JSON.stringify(file);
}

export async function importBackup(text: string, phrase: string): Promise<{ documents: number }> {
  let file: BackupFile;
  try {
    file = JSON.parse(text) as BackupFile;
  } catch {
    throw new Error("Backup file is not valid JSON.");
  }
  if (file.format !== "vaultzk-backup") throw new Error("Not a VaultZK backup file.");
  const key = await deriveKey(phrase, base64ToBytes(file.salt));
  let content: BackupContent;
  try {
    content = await openJson<BackupContent>({ iv: base64ToBytes(file.iv), cipher: base64ToBytes(file.data).buffer }, key);
  } catch {
    throw new Error("Wrong recovery phrase or corrupted backup.");
  }
  await saveProfile(content.profile);
  for (const d of content.documents) {
    const { plain, ...rest } = d;
    const sealed = await seal(base64ToBytes(plain));
    await getDb().documents.put({ ...rest, iv: sealed.iv, cipher: sealed.cipher, cipherHash: await sha256Hex(sealed.cipher) });
  }
  await logEvent("vault", `Imported backup with ${content.documents.length} document(s)`);
  return { documents: content.documents.length };
}

export async function wipeVault(): Promise<void> {
  const db = getDb();
  await Promise.all([db.documents.clear(), db.secrets.clear(), db.proofs.clear(), db.verifications.clear(), db.events.clear(), db.revocations.clear()]);
  await logEvent("vault", "Vault wiped by user", "warn");
}
