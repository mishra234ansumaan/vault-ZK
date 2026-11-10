import { getDb, getMeta, setMeta } from "@/lib/db";

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes: BufferSource = typeof data === "string" ? enc.encode(data) : (data as BufferSource);
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

/** Random element < BN254 scalar field (31 bytes) as decimal string. */
export function randomFieldElement(): string {
  return BigInt(`0x${toHex(randomBytes(31))}`).toString(10);
}

/**
 * The vault master key is a non-extractable AES-256-GCM CryptoKey persisted in
 * IndexedDB (structured clone). Raw key bytes are never readable by script.
 */
let cachedKey: CryptoKey | null = null;
export async function getVaultKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const stored = await getMeta<CryptoKey>("vaultKey");
  if (stored) {
    cachedKey = stored;
    return stored;
  }
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await setMeta("vaultKey", key);
  cachedKey = key;
  return key;
}

export interface Sealed {
  iv: Uint8Array<ArrayBuffer>;
  cipher: ArrayBuffer;
}

export async function seal(data: Uint8Array, key?: CryptoKey): Promise<Sealed> {
  const k = key ?? (await getVaultKey());
  const iv = randomBytes(12);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, data as BufferSource);
  return { iv, cipher };
}

export async function open(sealed: { iv: Uint8Array; cipher: ArrayBuffer }, key?: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  const k = key ?? (await getVaultKey());
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv as BufferSource }, k, sealed.cipher);
  return new Uint8Array(plain);
}

export async function sealJson(value: unknown, key?: CryptoKey): Promise<Sealed> {
  return seal(enc.encode(JSON.stringify(value)), key);
}

export async function openJson<T>(sealed: { iv: Uint8Array; cipher: ArrayBuffer }, key?: CryptoKey): Promise<T> {
  return JSON.parse(dec.decode(await open(sealed, key))) as T;
}

export async function deriveKey(secret: string, salt: Uint8Array, iterations = 210_000): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function hashPin(pin: string, salt: Uint8Array): Promise<string> {
  const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt as BufferSource, iterations: 210_000, hash: "SHA-256" }, base, 256);
  return toHex(bits);
}

export async function setPin(pin: string): Promise<void> {
  const salt = randomBytes(16);
  await setMeta("pin", { salt: toHex(salt), hash: await hashPin(pin, salt) });
}

export async function hasPin(): Promise<boolean> {
  return (await getMeta("pin")) !== undefined;
}

export async function verifyPin(pin: string): Promise<boolean> {
  const row = await getMeta<{ salt: string; hash: string }>("pin");
  if (!row) return true;
  const salt = new Uint8Array(row.salt.match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? []);
  return (await hashPin(pin, salt)) === row.hash;
}

export async function removePin(): Promise<void> {
  await getDb().meta.delete("pin");
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => {
    s += String.fromCharCode(b);
  });
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
