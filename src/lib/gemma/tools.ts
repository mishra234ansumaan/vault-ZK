import { z } from "zod";
import { useAppStore } from "@/lib/store";
import { errorMessage } from "@/lib/utils";
import { generate, extractJson } from "@/lib/gemma/engine";
import {
  ALLOWED_FIELDS,
  detectDocumentType,
  extractFieldsRules,
  suggestPredicateRules,
  type DocumentType,
  type ExtractedFields,
  type PredicateSuggestion,
} from "@/lib/gemma/heuristics";
import { validateGovernmentSignature as validateSig, type SignatureValidationResult } from "@/lib/signature";
import { decodeSignals, type ProofPayload } from "@/lib/zk";
import { FIELD_DEFS, describeCondition, type Condition, type FieldKey } from "@/lib/fields";

export type ToolName = "parseDocumentOffline" | "validateGovernmentSignature" | "suggestPrivacyOptimalPredicate" | "explainProofInPlainEnglish";

export interface DocumentParseResult {
  documentType: DocumentType;
  extractedFields: ExtractedFields;
  governmentSignature: "valid" | "invalid" | "none";
  confidence: number;
  engine: string;
  groundedFromModel: number;
}

/* ------------------------------------------------------------------ */
/* Tool manifest (mirrors SKILL.md)                                     */
/* ------------------------------------------------------------------ */

export const TOOL_MANIFEST: Array<{ name: ToolName; description: string; parameters: Record<string, string>; returns: string }> = [
  {
    name: "parseDocumentOffline",
    description: "Extract structured fields from raw document text",
    parameters: { rawText: "string" },
    returns: "DocumentParseResult",
  },
  {
    name: "validateGovernmentSignature",
    description: "Verify RSA signatures on government documents",
    parameters: { docBytes: "Uint8Array" },
    returns: "SignatureValidationResult",
  },
  {
    name: "suggestPrivacyOptimalPredicate",
    description: "Suggest minimum disclosure for a user goal",
    parameters: { userGoal: "string" },
    returns: "PredicateSuggestion",
  },
  {
    name: "explainProofInPlainEnglish",
    description: "Translate a ZK proof into human-readable text",
    parameters: { zkProof: "ProofObject" },
    returns: "string",
  },
];

const log = (level: "info" | "tool" | "result" | "error" | "inference", message: string, tool?: ToolName, ms?: number): void =>
  useAppStore.getState().pushLog({ level, message, tool, ms });

/* ------------------------------------------------------------------ */
/* Tool 1 – parseDocumentOffline                                        */
/* ------------------------------------------------------------------ */

const llmDocSchema = z.object({
  documentType: z.string().optional(),
  extractedFields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});

const LLM_KEYS = ["name", "dob", "balance", "monthlyIncome", "annualIncome", "creditScore", "netWorth", "yearsExperience", "statementDate", "residencyCountry"];
const DOC_TYPES: DocumentType[] = ["bank_statement", "aadhaar", "pan", "tax_return", "passport", "degree", "medical", "employment", "unknown"];

function grounded(value: string | number, text: string): boolean {
  if (typeof value === "number") {
    const digits = String(Math.round(value));
    return text.replace(/[,\s]/g, "").includes(digits);
  }
  return text.toLowerCase().includes(String(value).toLowerCase());
}

async function parseDocument(rawText: string): Promise<DocumentParseResult> {
  const ruleType = detectDocumentType(rawText);
  const fields: ExtractedFields = extractFieldsRules(rawText);
  let docType: DocumentType = ruleType;
  let engineLabel = "rule-engine";
  let groundedCount = 0;
  let agreement = 0;

  const prompt = [
    {
      role: "system" as const,
      content:
        'You are an offline document parser. Reply with ONE JSON object only: {"documentType": one of ' +
        DOC_TYPES.join("|") +
        ', "extractedFields": {' +
        LLM_KEYS.join(", ") +
        "}}. Numbers must be plain numbers without currency symbols. Omit fields not present in the document. Never invent values.",
    },
    { role: "user" as const, content: `DOCUMENT TEXT:\n${rawText.slice(0, 3500)}` },
  ];
  const gen = await generate(prompt, { json: true, maxTokens: 420 });
  if (gen) {
    engineLabel = `${gen.engine}:${gen.model}`;
    log("inference", `Gemma replied in ${gen.ms} ms (${gen.tokens} tokens)`, "parseDocumentOffline", gen.ms);
    const parsed = llmDocSchema.safeParse(extractJson(gen.text));
    if (parsed.success) {
      const llmType = parsed.data.documentType as DocumentType | undefined;
      if (docType === "unknown" && llmType && DOC_TYPES.includes(llmType)) docType = llmType;
      for (const [k, v] of Object.entries(parsed.data.extractedFields)) {
        if (v === null || !LLM_KEYS.includes(k)) continue;
        if (typeof v === "boolean") continue;
        const existing = fields[k];
        if (existing !== undefined) {
          if (String(existing).toLowerCase() === String(v).toLowerCase()) agreement++;
          continue;
        }
        if (grounded(v, rawText)) {
          fields[k] = v;
          groundedCount++;
        } else {
          log("info", `Hallucination guard rejected "${k}=${String(v)}" (not present in source text)`, "parseDocumentOffline");
        }
      }
    } else {
      log("info", "Gemma output was not valid JSON — using rule-engine extraction only", "parseDocumentOffline");
    }
  }

  const sig = await validateSig(new TextEncoder().encode(rawText));
  const count = Object.keys(fields).length;
  let confidence = count === 0 ? 0.2 : Math.min(0.9, 0.5 + count * 0.05);
  if (gen) confidence = Math.min(0.99, confidence + 0.04 + agreement * 0.02 + groundedCount * 0.01);
  if (docType === "unknown") confidence = Math.min(confidence, 0.45);
  return {
    documentType: docType,
    extractedFields: fields,
    governmentSignature: sig.state,
    confidence: Math.round(confidence * 100) / 100,
    engine: engineLabel,
    groundedFromModel: groundedCount,
  };
}

/* ------------------------------------------------------------------ */
/* Tool 3 – suggestPrivacyOptimalPredicate                              */
/* ------------------------------------------------------------------ */

const llmPredicateSchema = z.object({
  suggestedPredicate: z.string().min(3).max(200),
  explanation: z.string().min(10).max(600),
  hiddenFields: z.array(z.string()).max(12).default([]),
  conditions: z
    .array(z.object({ field: z.string(), threshold: z.number() }))
    .min(1)
    .max(4),
  logic: z.enum(["AND", "OR"]).default("AND"),
  verifierType: z.string().default("govt"),
});

async function suggestPredicate(userGoal: string): Promise<PredicateSuggestion> {
  const rules = suggestPredicateRules(userGoal);
  const fieldList = ALLOWED_FIELDS.map((f) => `${f}${FIELD_DEFS[f].kind === "flag" ? "(0/1 flag, threshold 1)" : ""}`).join(", ");
  const gen = await generate(
    [
      {
        role: "system",
        content:
          "You are a privacy engineer. Given a user goal, choose the MINIMUM set of range predicates needed. Reply with ONE JSON object: " +
          '{"suggestedPredicate": string, "explanation": string (2 sentences, second person), "hiddenFields": string[], "conditions": [{"field": string, "threshold": number}], "logic": "AND"|"OR", "verifierType": "landlord"|"bank"|"bar"|"govt"}. ' +
          `Allowed condition fields: ${fieldList}. educationLevel uses 1=High School,2=Bachelor's,3=Master's,4=PhD.`,
      },
      { role: "user", content: `Goal: ${userGoal}` },
    ],
    { json: true, maxTokens: 380 },
  );
  if (!gen) return rules;
  log("inference", `Gemma replied in ${gen.ms} ms`, "suggestPrivacyOptimalPredicate", gen.ms);
  const parsed = llmPredicateSchema.safeParse(extractJson(gen.text));
  if (!parsed.success) {
    log("info", "Gemma suggestion failed schema validation → using rule-based minimum-disclosure policy", "suggestPrivacyOptimalPredicate");
    return rules;
  }
  const conditions: Condition[] = [];
  for (const c of parsed.data.conditions) {
    if (!ALLOWED_FIELDS.includes(c.field as FieldKey)) continue;
    const def = FIELD_DEFS[c.field as FieldKey];
    const threshold = Math.round(Math.min(def.max, Math.max(def.kind === "flag" ? 1 : def.min, c.threshold)));
    conditions.push({ field: def.key, threshold: def.kind === "flag" ? 1 : threshold });
  }
  if (conditions.length === 0) return rules;
  return {
    suggestedPredicate: parsed.data.suggestedPredicate,
    explanation: parsed.data.explanation,
    hiddenFields: parsed.data.hiddenFields.length ? parsed.data.hiddenFields : rules.hiddenFields,
    conditions,
    logic: parsed.data.logic,
    verifierType: ["landlord", "bank", "bar", "govt"].includes(parsed.data.verifierType) ? parsed.data.verifierType : rules.verifierType,
    source: "gemma",
  };
}

/* ------------------------------------------------------------------ */
/* Tool 4 – explainProofInPlainEnglish                                  */
/* ------------------------------------------------------------------ */

function templateExplanation(p: ProofPayload): string {
  const d = decodeSignals(p.circuit, p.signals);
  if (!d) return "This proof is malformed, so nothing can be said about it.";
  const when = new Date(d.expiresAt).toLocaleString();
  const what = d.conditions.length > 1 ? `the statement “${d.formula}”` : `“${d.formula}”`;
  const hidden = d.conditions.length > 1 ? " It also does not say which part of the statement was the deciding one." : "";
  return `This proof shows that ${what} is true. The exact underlying number is never included — only a cryptographic commitment, so the verifier learns a yes/no answer and nothing else.${hidden} The proof stops being valid at ${when}.`;
}

async function explainProof(p: ProofPayload): Promise<string> {
  const fallback = templateExplanation(p);
  const d = decodeSignals(p.circuit, p.signals);
  if (!d) return fallback;
  const facts = `Statement proven: ${d.formula}. Circuit: ${p.circuit === "range" ? "single range proof" : "multi-condition boolean logic proof"} (Groth16). Expires: ${new Date(d.expiresAt).toISOString()}. Hidden: exact values behind every condition.`;
  const gen = await generate(
    [
      {
        role: "system",
        content:
          "Explain zero-knowledge proofs to a non-technical person in 2-3 short sentences. Use ONLY the facts provided. Do not invent numbers. Plain text, no markdown.",
      },
      { role: "user", content: facts },
    ],
    { maxTokens: 220 },
  );
  if (!gen) return fallback;
  log("inference", `Gemma replied in ${gen.ms} ms`, "explainProofInPlainEnglish", gen.ms);
  const text = gen.text.trim();
  if (text.length < 30 || text.length > 900) return fallback;
  return text;
}

/* ------------------------------------------------------------------ */
/* Dispatcher with structured logging                                   */
/* ------------------------------------------------------------------ */

const schemas = {
  parseDocumentOffline: z.object({ rawText: z.string().min(1, "rawText is empty") }),
  validateGovernmentSignature: z.object({ docBytes: z.instanceof(Uint8Array) }),
  suggestPrivacyOptimalPredicate: z.object({ userGoal: z.string().min(3, "Describe your goal in a few words") }),
  explainProofInPlainEnglish: z.object({ zkProof: z.custom<ProofPayload>((v) => typeof v === "object" && v !== null && "signals" in v) }),
} as const;

export interface ToolResults {
  parseDocumentOffline: DocumentParseResult;
  validateGovernmentSignature: SignatureValidationResult;
  suggestPrivacyOptimalPredicate: PredicateSuggestion;
  explainProofInPlainEnglish: string;
}

export interface ToolArgs {
  parseDocumentOffline: { rawText: string };
  validateGovernmentSignature: { docBytes: Uint8Array };
  suggestPrivacyOptimalPredicate: { userGoal: string };
  explainProofInPlainEnglish: { zkProof: ProofPayload };
}

function summarize(name: ToolName, r: ToolResults[ToolName]): string {
  switch (name) {
    case "parseDocumentOffline": {
      const x = r as DocumentParseResult;
      return `type=${x.documentType} fields=${Object.keys(x.extractedFields).length} signature=${x.governmentSignature} confidence=${x.confidence}`;
    }
    case "validateGovernmentSignature": {
      const x = r as SignatureValidationResult;
      return `valid=${x.valid} authority="${x.authority}"`;
    }
    case "suggestPrivacyOptimalPredicate": {
      const x = r as PredicateSuggestion;
      return `predicate="${x.suggestedPredicate}" via ${x.source}`;
    }
    default:
      return `${(r as string).length} chars`;
  }
}

export async function callTool<N extends ToolName>(name: N, args: ToolArgs[N]): Promise<ToolResults[N]> {
  const check = schemas[name].safeParse(args);
  if (!check.success) {
    const msg = check.error.issues[0]?.message ?? "invalid arguments";
    log("error", `Rejected tool call ${name}: ${msg}`, name);
    throw new Error(`Tool ${name}: ${msg}`);
  }
  const preview =
    name === "validateGovernmentSignature"
      ? `docBytes=<${(args as ToolArgs["validateGovernmentSignature"]).docBytes.length} bytes>`
      : name === "parseDocumentOffline"
        ? `rawText=<${(args as ToolArgs["parseDocumentOffline"]).rawText.length} chars>`
        : name === "suggestPrivacyOptimalPredicate"
          ? `userGoal="${(args as ToolArgs["suggestPrivacyOptimalPredicate"]).userGoal}"`
          : `zkProof=${(args as ToolArgs["explainProofInPlainEnglish"]).zkProof.id}`;
  log("tool", `→ ${name}(${preview})`, name);
  const t0 = performance.now();
  try {
    let result: ToolResults[ToolName];
    switch (name) {
      case "parseDocumentOffline":
        result = await parseDocument((args as ToolArgs["parseDocumentOffline"]).rawText);
        break;
      case "validateGovernmentSignature":
        result = await validateSig((args as ToolArgs["validateGovernmentSignature"]).docBytes);
        break;
      case "suggestPrivacyOptimalPredicate":
        result = await suggestPredicate((args as ToolArgs["suggestPrivacyOptimalPredicate"]).userGoal);
        break;
      default:
        result = await explainProof((args as ToolArgs["explainProofInPlainEnglish"]).zkProof);
    }
    const ms = Math.round(performance.now() - t0);
    log("result", `← ${name} ✓ ${summarize(name, result)}`, name, ms);
    return result as ToolResults[N];
  } catch (e) {
    log("error", `← ${name} ✗ ${errorMessage(e)}`, name, Math.round(performance.now() - t0));
    throw e;
  }
}

export const parseDocumentOffline = (rawText: string) => callTool("parseDocumentOffline", { rawText });
export const validateGovernmentSignature = (docBytes: Uint8Array) => callTool("validateGovernmentSignature", { docBytes });
export const suggestPrivacyOptimalPredicate = (userGoal: string) => callTool("suggestPrivacyOptimalPredicate", { userGoal });
export const explainProofInPlainEnglish = (zkProof: ProofPayload) => callTool("explainProofInPlainEnglish", { zkProof });

export { describeCondition };
