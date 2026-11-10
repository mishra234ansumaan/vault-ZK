import { TRUST_ANCHORS, type TrustAnchor } from "@/lib/trust-anchors";
import { base64ToBytes } from "@/lib/crypto";
import type { SignatureState } from "@/lib/db";

export interface SignatureValidationResult {
  valid: boolean;
  state: SignatureState;
  authority: string;
  timestamp: Date | null;
  keyId?: string;
  reason: string;
  algorithm: string;
}

const BEGIN = "-----BEGIN VZK SIGNATURE-----";
const END = "-----END VZK SIGNATURE-----";

function latin1(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return s;
}

function parseHeaders(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx > 0) out[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return out;
}

async function verifyWith(anchor: TrustAnchor, body: Uint8Array<ArrayBuffer>, sig: Uint8Array<ArrayBuffer>): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "spki",
    base64ToBytes(anchor.spki),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, body);
}

/**
 * Tool 2 – validateGovernmentSignature.
 * Verifies an RSA-2048 / SHA-256 (PKCS#1 v1.5) detached signature trailer against the
 * embedded authority trust anchors using the Web Crypto API. Fully offline.
 * Any modification of the signed bytes (e.g. an edited balance) fails verification.
 */
export async function validateGovernmentSignature(docBytes: Uint8Array): Promise<SignatureValidationResult> {
  const none: SignatureValidationResult = {
    valid: false,
    state: "none",
    authority: "Unsigned document",
    timestamp: null,
    reason: "No VaultZK/government signature block found in the document.",
    algorithm: "—",
  };
  const text = latin1(docBytes);
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start < 0 || end < 0 || end < start) return none;

  const headers = parseHeaders(text.slice(start + BEGIN.length, end));
  const sigB64 = headers["signature"];
  if (!sigB64) return { ...none, state: "invalid", reason: "Signature block present but signature value is missing." };

  let bodyEnd = start;
  if (bodyEnd > 0 && text[bodyEnd - 1] === "\n") bodyEnd -= 1;
  const body = new Uint8Array(docBytes.subarray(0, bodyEnd));

  let sig: Uint8Array<ArrayBuffer>;
  try {
    sig = base64ToBytes(sigB64);
  } catch {
    return { ...none, state: "invalid", reason: "Signature is not valid base64." };
  }

  const claimed = headers["key-id"];
  const candidates = claimed ? TRUST_ANCHORS.filter((a) => a.id === claimed) : TRUST_ANCHORS;
  if (candidates.length === 0) {
    return { ...none, state: "invalid", authority: headers["authority"] ?? "Unknown authority", reason: `Signing key "${claimed}" is not in the trust store.` };
  }
  const ts = headers["signed-at"] ? new Date(headers["signed-at"]) : null;
  for (const anchor of candidates) {
    try {
      if (await verifyWith(anchor, body, sig)) {
        return {
          valid: true,
          state: "valid",
          authority: anchor.authority,
          timestamp: ts && !Number.isNaN(ts.getTime()) ? ts : null,
          keyId: anchor.id,
          reason: "RSA-2048 / SHA-256 signature verified against embedded trust anchor.",
          algorithm: headers["algorithm"] ?? "RSA-SHA256-PKCS1v1.5",
        };
      }
    } catch {
      continue;
    }
  }
  return {
    valid: false,
    state: "invalid",
    authority: headers["authority"] ?? "Unknown authority",
    timestamp: ts,
    keyId: claimed,
    reason: "Signature does not match document contents — the document was modified or forged.",
    algorithm: headers["algorithm"] ?? "RSA-SHA256-PKCS1v1.5",
  };
}
