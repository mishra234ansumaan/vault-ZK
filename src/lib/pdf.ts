import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import type { ProofRecord, VerificationRecord } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto";

async function qr(text: string): Promise<string> {
  return QRCode.toDataURL(text, { errorCorrectionLevel: "L", margin: 1, width: 520 });
}

function header(doc: jsPDF, title: string): void {
  doc.setFillColor(11, 15, 25);
  doc.rect(0, 0, 210, 34, "F");
  doc.setTextColor(6, 182, 212);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("VaultZK Engine", 14, 16);
  doc.setTextColor(226, 232, 240);
  doc.setFontSize(11);
  doc.text(title, 14, 25);
  doc.setTextColor(30, 41, 59);
}

function row(doc: jsPDF, y: number, k: string, v: string): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(k.toUpperCase(), 14, y);
  doc.setFont("courier", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  const lines = doc.splitTextToSize(v, 135) as string[];
  doc.text(lines, 62, y);
  return y + Math.max(7, lines.length * 4.6 + 2.4);
}

export async function downloadProofPdf(p: { id: string; label: string; hash: string; expiresAt: number; issuedAt: number; payload: string; circuit: string; verifier?: string }): Promise<void> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  header(doc, "Zero-Knowledge Proof Certificate");
  let y = 48;
  y = row(doc, y, "Statement", p.label);
  y = row(doc, y, "Proof ID", p.id);
  y = row(doc, y, "Proof hash", p.hash);
  y = row(doc, y, "Circuit", `${p.circuit} · Groth16 · BN254`);
  y = row(doc, y, "Issued", new Date(p.issuedAt).toISOString());
  y = row(doc, y, "Expires", new Date(p.expiresAt).toISOString());
  if (p.verifier) y = row(doc, y, "Verifier", p.verifier);
  doc.addImage(await qr(p.payload), "PNG", 55, y + 4, 100, 100);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  const note = "Scan with the VaultZK Verifier Portal (/verify) or paste the payload. This proof is time-bound: after the expiry above it is cryptographically rejected. It reveals only the statement above — no underlying personal data.";
  doc.text(doc.splitTextToSize(note, 170) as string[], 20, y + 114);
  doc.save(`vaultzk-proof-${p.id}.pdf`);
}

export async function downloadReceiptPdf(p: ProofRecord, verifs: VerificationRecord[]): Promise<void> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  header(doc, "Privacy Receipt");
  const receiptId = (await sha256Hex(`${p.id}|${p.proofHash}|${p.createdAt}`)).slice(0, 24);
  let y = 48;
  y = row(doc, y, "Receipt no.", `PR-${receiptId.toUpperCase()}`);
  y = row(doc, y, "Statement proven", p.label);
  y = row(doc, y, "Proof ID", p.id);
  y = row(doc, y, "Proof hash", p.proofHash);
  y = row(doc, y, "Generated", new Date(p.createdAt).toISOString());
  y = row(doc, y, "Expiry", new Date(p.expiresAt).toISOString());
  y = row(doc, y, "Verifier type", p.verifierType);
  y = row(doc, y, "Status", p.status === "revoked" ? `REVOKED ${p.revokedAt ? new Date(p.revokedAt).toISOString() : ""}` : p.expiresAt < Date.now() ? "EXPIRED" : "ACTIVE");
  y = row(doc, y, "Data disclosed", "None. 0 bytes of personal data left the device.");
  y = row(doc, y, "Verifications", `${verifs.length} (${verifs.filter((v) => v.result === "verified").length} verified)`);
  const verifyUrl = `vaultzk:receipt:${receiptId}:${p.proofHash}`;
  doc.addImage(await qr(verifyUrl), "PNG", 150, 40, 46, 46);
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text("Independent verification QR", 150, 90);
  doc.setFontSize(8.5);
  const legal =
    "This receipt attests that the holder generated the above zero-knowledge proof on their own device at the stated time, and records the verification events observed. The receipt hash binds the proof ID, proof hash and creation time (SHA-256). It contains no personal data. Retain for audit and compliance purposes.";
  doc.text(doc.splitTextToSize(legal, 180) as string[], 14, Math.max(y + 10, 120));
  doc.save(`vaultzk-receipt-${p.id}.pdf`);
}
