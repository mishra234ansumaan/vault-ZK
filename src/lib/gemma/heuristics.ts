import { COUNTRIES, type Condition, type FieldKey, type Profile } from "@/lib/fields";
import type { DocCategory } from "@/lib/db";

export type DocumentType =
  | "bank_statement"
  | "aadhaar"
  | "pan"
  | "tax_return"
  | "passport"
  | "degree"
  | "medical"
  | "employment"
  | "unknown";

export type ExtractedFields = Record<string, string | number | boolean>;

export interface PredicateSuggestion {
  suggestedPredicate: string;
  explanation: string;
  hiddenFields: string[];
  conditions: Condition[];
  logic: "AND" | "OR";
  verifierType: string;
  source: "gemma" | "rules";
}

export const DOC_LABELS: Record<DocumentType, string> = {
  bank_statement: "Bank Statement",
  aadhaar: "Aadhaar eKYC",
  pan: "PAN Card",
  tax_return: "Tax Return",
  passport: "Passport",
  degree: "Degree Certificate",
  medical: "Medical Record",
  employment: "Employment Letter",
  unknown: "Unknown document",
};

export function categoryForDocType(t: DocumentType): DocCategory {
  switch (t) {
    case "aadhaar":
    case "pan":
    case "passport":
      return "identity";
    case "degree":
      return "educational";
    case "medical":
      return "medical";
    default:
      return "financial";
  }
}

export function detectDocumentType(text: string): DocumentType {
  const checks: Array<[DocumentType, RegExp[]]> = [
    ["aadhaar", [/aadhaar/i, /uidai/i, /OfflinePaperlessKyc/i, /<UidData/i]],
    ["tax_return", [/income tax return/i, /\bITR-?\d/i, /assessment year/i, /tax return/i]],
    ["pan", [/permanent account number/i, /\bPAN\b\s*[:=]/i]],
    ["bank_statement", [/account statement/i, /closing balance/i, /statement period/i, /\bIFSC\b/i, /bank/i]],
    ["passport", [/passport/i, /place of issue/i]],
    ["degree", [/degree/i, /university/i, /bachelor/i, /master of/i, /convocation/i]],
    ["medical", [/medical/i, /diagnosis/i, /patient/i, /clinic/i, /prescription/i]],
    ["employment", [/employment (?:letter|verification)/i, /offer letter/i, /salary slip/i, /employee id/i]],
  ];
  let best: DocumentType = "unknown";
  let bestScore = 0;
  for (const [type, patterns] of checks) {
    const score = patterns.filter((p) => p.test(text)).length;
    if (score > bestScore) {
      best = type;
      bestScore = score;
    }
  }
  return best;
}

const num = (s: string): number => Number(s.replace(/,/g, ""));

function first(text: string, patterns: RegExp[]): string | undefined {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

export function ageFromDob(iso: string, now: Date = new Date()): number | undefined {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age -= 1;
  return age >= 0 && age < 130 ? age : undefined;
}

/** Deterministic, high-precision field extractor (also used to ground-check Gemma output). */
export function extractFieldsRules(text: string): ExtractedFields {
  const f: ExtractedFields = {};
  const name = first(text, [/name\s*=\s*"([^"]{2,60})"/i, /(?:account holder|taxpayer name|full name|name)\s*[:]\s*([A-Za-z][A-Za-z .'-]{1,50})/i]);
  if (name) f.name = name.trim();

  let dob = first(text, [/dob\s*=\s*"(\d{4}-\d{2}-\d{2})"/i, /(?:date of birth|dob)\s*[:]\s*(\d{4}-\d{2}-\d{2})/i]);
  if (!dob) {
    const m = text.match(/(?:date of birth|dob)\s*[:]\s*(\d{2})[/-](\d{2})[/-](\d{4})/i);
    if (m) dob = `${m[3]}-${m[2]}-${m[1]}`;
  }
  if (dob) {
    f.dob = dob;
    const age = ageFromDob(dob);
    if (age !== undefined) f.age = age;
  }

  const balance = first(text, [
    /closing balance\s*[:]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:available|current|ending) balance\s*[:]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i,
  ]);
  if (balance) f.balance = Math.round(num(balance));

  const monthly = first(text, [/monthly income\s*[:]?\s*\$?\s*([\d,]+)/i, /monthly salary\s*[:]?\s*\$?\s*([\d,]+)/i]);
  if (monthly) f.monthlyIncome = num(monthly);
  const annual = first(text, [/(?:gross total income|annual income|total income)\s*[:]?\s*\$?\s*([\d,]+)/i]);
  if (annual) {
    f.annualIncome = num(annual);
    if (f.monthlyIncome === undefined) f.monthlyIncome = Math.round(num(annual) / 12);
  }

  const credit = first(text, [/credit score[^\d\n]{0,40}(\d{3})\b/i]);
  if (credit) f.creditScore = Number(credit);
  const nw = first(text, [/net worth[^\d\n$]{0,30}\$?\s*([\d,]+)/i]);
  if (nw) f.netWorth = num(nw);
  const yrs = first(text, [/years of (?:employment|experience|service)\s*[:]?\s*(\d{1,2})/i]);
  if (yrs) f.yearsExperience = Number(yrs);

  const date = first(text, [/statement date\s*[:]?\s*(\d{4}-\d{2}-\d{2})/i, /filing date\s*[:]?\s*(\d{4}-\d{2}-\d{2})/i]);
  if (date) f.statementDate = date;

  if (/citizen/i.test(text) && !/non-?citizen/i.test(text)) f.citizenship = true;
  const country = first(text, [/country\s*=\s*"([^"]+)"/i, /country\s*[:]\s*([A-Za-z ]+)/i]);
  if (country) f.residencyCountry = country.trim();

  const pan = text.match(/\b([A-Z]{5})(\d{4})([A-Z])\b/);
  if (pan) f.idNumber = `${pan[1].slice(0, 2)}XXXXXXX${pan[3]}`;
  if (/status\s*[:]\s*valid/i.test(text)) f.idStatusValid = true;
  return f;
}

export function mapToProfile(type: DocumentType, f: ExtractedFields, signatureValid: boolean): Partial<Profile> {
  const p: Partial<Profile> = {};
  if (typeof f.name === "string") p.name = f.name;
  if (typeof f.age === "number") p.age = f.age;
  if (typeof f.balance === "number") p.bankBalance = f.balance;
  if (typeof f.monthlyIncome === "number") p.monthlyIncome = f.monthlyIncome;
  if (typeof f.creditScore === "number") p.creditScore = f.creditScore;
  if (typeof f.netWorth === "number") p.netWorth = f.netWorth;
  if (typeof f.yearsExperience === "number") {
    p.yearsExperience = f.yearsExperience;
    p.employed = true;
  }
  if (f.citizenship === true) p.citizenship = true;
  if (typeof f.residencyCountry === "string") {
    const match = COUNTRIES.find((c) => c.toLowerCase() === String(f.residencyCountry).toLowerCase());
    if (match) p.residency = match;
  }
  if ((type === "aadhaar" || type === "pan" || type === "passport") && signatureValid) p.govId = true;
  return p;
}

/* ------------------------------------------------------------------ */
/* Privacy-optimal predicate rules                                      */
/* ------------------------------------------------------------------ */

const ALL_PRIVATE = ["exactAge", "birthDate", "fullName", "address", "idNumber", "bankDetails", "exactIncome", "employer", "exactBalance", "creditHistory"];

function numberIn(goal: string, re: RegExp): number | undefined {
  const m = goal.match(re);
  return m ? Number(m[1].replace(/,/g, "")) : undefined;
}

export function suggestPredicateRules(goal: string): PredicateSuggestion {
  const g = goal.toLowerCase();
  const mk = (
    suggestedPredicate: string,
    explanation: string,
    keep: string[],
    conditions: Condition[],
    verifierType: string,
    logic: "AND" | "OR" = "AND",
  ): PredicateSuggestion => ({
    suggestedPredicate,
    explanation,
    hiddenFields: ALL_PRIVATE.filter((x) => !keep.includes(x)),
    conditions,
    logic,
    verifierType,
    source: "rules",
  });

  if (/rent|apartment|landlord|lease|tenant|flat/.test(g)) {
    const rent = numberIn(goal, /\$?\s?([\d,]{3,7})/) ?? 1500;
    return mk(
      `monthlyIncome >= ${rent * 3} AND no_criminal_record`,
      `A landlord only needs to know that your income covers 3× the $${rent.toLocaleString("en-US")} rent and that you have no criminal record. Your exact salary, employer and bank details stay hidden.`,
      [],
      [
        { field: "monthlyIncome", threshold: rent * 3 },
        { field: "noCriminalRecord", threshold: 1 },
      ],
      "landlord",
    );
  }
  if (/\bbar\b|alcohol|club|drink|liquor|casino|pub\b|21\+|over 21/.test(g)) {
    return mk(
      "age >= 21",
      "The doorman only needs a yes/no answer to “are you at least 21?”. Your birth date, name and address never leave your phone.",
      [],
      [{ field: "age", threshold: 21 }],
      "bar",
    );
  }
  if (/loan|mortgage|borrow|credit card|lend|finance/.test(g)) {
    const inc = numberIn(goal, /income[^\d]{0,12}\$?\s?([\d,]{3,7})/i) ?? 3000;
    return mk(
      `creditScore >= 700 AND monthlyIncome >= ${inc}`,
      "A lender needs a creditworthiness threshold and an income floor — not your full credit report, bank statements or employer.",
      [],
      [
        { field: "creditScore", threshold: 700 },
        { field: "monthlyIncome", threshold: inc },
      ],
      "bank",
    );
  }
  if (/job|hire|hiring|employer|position|recruit|career|work\b|degree|education/.test(g)) {
    const yrs = numberIn(goal, /(\d{1,2})\s*\+?\s*(?:years|yrs)/i) ?? 3;
    return mk(
      `educationLevel >= Bachelor's AND yearsExperience >= ${yrs}`,
      "A recruiter only needs to confirm the degree level and minimum experience — not your transcripts, past employers or salary history.",
      [],
      [
        { field: "educationLevel", threshold: 2 },
        { field: "yearsExperience", threshold: yrs },
      ],
      "govt",
    );
  }
  if (/visa|travel|border|immigration|passport|citizen|vote|voting|government/.test(g)) {
    return mk(
      "citizenship_verified AND government_id_valid",
      "Authorities only need to know that your citizenship is verified and your government ID is valid — not the ID number, address or birth date.",
      [],
      [
        { field: "citizenship", threshold: 1 },
        { field: "govId", threshold: 1 },
      ],
      "govt",
    );
  }
  if (/senior|retire|pension|elder|60\+/.test(g)) {
    return mk("age >= 60", "A senior-discount check needs only the age threshold, never the birth date.", [], [{ field: "age", threshold: 60 }], "bar");
  }
  return mk(
    "government_id_valid",
    "When the goal is unclear the minimum-disclosure default is a single boolean: a valid government ID exists. Refine your goal for a tighter predicate.",
    [],
    [{ field: "govId", threshold: 1 }],
    "govt",
  );
}

export const ALLOWED_FIELDS: FieldKey[] = [
  "age",
  "citizenship",
  "residency",
  "govId",
  "bankBalance",
  "monthlyIncome",
  "creditScore",
  "netWorth",
  "educationLevel",
  "yearsExperience",
  "employed",
  "professionalLicense",
  "noCriminalRecord",
  "noBankruptcy",
  "referencesVerified",
  "healthClear",
];
