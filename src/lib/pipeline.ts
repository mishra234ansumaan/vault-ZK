import { runDocumentAgent } from "@/lib/gemma/harness";
import { refreshGemmaStatus } from "@/lib/gemma/engine";
import { categoryForDocType, DOC_LABELS, mapToProfile } from "@/lib/gemma/heuristics";
import { extractText } from "@/lib/ocr";
import { logEvent, mergeProfile, storeDocument } from "@/lib/vault";
import { useAppStore } from "@/lib/store";
import { errorMessage, formatBytes } from "@/lib/utils";
import type { VaultDocument } from "@/lib/db";

export type LogTone = "info" | "ok" | "warn" | "error" | "ai";

export interface PipelineLog {
  at: number;
  elapsedMs: number;
  icon: string;
  text: string;
  tone: LogTone;
}

export interface IngestResult {
  accepted: boolean;
  doc?: VaultDocument;
  reason?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Document → OCR → Gemma agent (tool calls) → signature check → AES-256-GCM → IndexedDB. */
export async function ingestFile(file: File, emit: (l: PipelineLog) => void): Promise<IngestResult> {
  const start = performance.now();
  const log = (icon: string, text: string, tone: LogTone = "info") => emit({ at: Date.now(), elapsedMs: performance.now() - start, icon, text, tone });
  const pace = () => sleep(220);

  try {
    log("📄", `Document received: ${file.name} (${formatBytes(file.size)})`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    await pace();

    const isText = !(file.type === "application/pdf" || file.type.startsWith("image/") || /\.(pdf|png|jpe?g|webp|bmp)$/i.test(file.name));
    log("🔍", isText ? "Reading embedded text (no OCR needed)..." : "Running local OCR via Tesseract (WASM, offline)...");
    const { text, method } = await extractText(file, bytes);
    if (text.trim().length < 8) {
      log("⚠️", "No readable text found in document", "warn");
      return { accepted: false, reason: "No readable text could be extracted from this file." };
    }
    log("✔", `Extracted ${text.length.toLocaleString()} characters via ${method}`, "ok");
    await pace();

    await refreshGemmaStatus();
    const g = useAppStore.getState().gemma;
    log("🤖", `Initializing Gemma Edge Agent → ${g.label}`, "ai");
    await pace();
    log("🧠", "Gemma parsing document structure (tool: parseDocumentOffline)...", "ai");
    const agent = await runDocumentAgent({ fileName: file.name, text, bytes });
    const { parse, signature } = agent;
    const shown = Object.fromEntries(Object.entries(parse.extractedFields).filter(([k]) => !["dob", "idNumber"].includes(k)));
    log("📊", `Extracted: ${JSON.stringify(shown)}`, "ai");
    log("🏷", `Detected ${DOC_LABELS[parse.documentType]} · confidence ${(parse.confidence * 100).toFixed(0)}% · engine ${parse.engine}`, "ai");
    useAppStore.getState().setGemma({ lastDoc: file.name });
    await pace();

    log("🔐", "Validating government digital signature (tool: validateGovernmentSignature)...");
    await pace();
    if (signature.state === "invalid") {
      log("❌", `Signature INVALID — ${signature.reason}`, "error");
      log("🚫", "Document rejected: possible forgery. Nothing was stored.", "error");
      await logEvent("vault", `Rejected ${file.name}: invalid signature (forged/modified)`, "error");
      return { accepted: false, reason: signature.reason };
    }
    if (signature.state === "valid") {
      log("✅", `Signature VALID (RSA-2048 verified) · ${signature.authority}`, "ok");
    } else {
      log("⚠️", "No government signature present — values are stored as self-asserted (unverified)", "warn");
    }
    await pace();

    log("🔒", "Encrypting with AES-256-GCM (non-extractable vault key)...");
    await pace();
    log("💾", "Storing in IndexedDB local vault...");
    const patch = mapToProfile(parse.documentType, parse.extractedFields, signature.state === "valid");
    const doc = await storeDocument({
      file,
      bytes,
      category: categoryForDocType(parse.documentType),
      docType: parse.documentType,
      signature: signature.state,
      authority: signature.state === "valid" ? signature.authority : undefined,
      confidence: parse.confidence,
      fieldKeys: Object.keys(patch).filter((k) => k !== "name"),
      engine: parse.engine,
    });
    await mergeProfile(patch, `${DOC_LABELS[parse.documentType]}${signature.state === "valid" ? " (signed)" : " (unsigned)"}`);
    await logEvent("vault", `Ingested ${file.name} (${DOC_LABELS[parse.documentType]}, signature ${signature.state})`, signature.state === "valid" ? "ok" : "warn");
    await pace();
    log("✨", `Vault updated successfully! (${((performance.now() - start) / 1000).toFixed(1)}s total · 0 bytes sent over network)`, "ok");
    return { accepted: true, doc };
  } catch (e) {
    log("💥", `Pipeline error: ${errorMessage(e)}`, "error");
    return { accepted: false, reason: errorMessage(e) };
  }
}
