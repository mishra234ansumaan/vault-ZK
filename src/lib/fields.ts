export type FieldKey =
  | "age"
  | "citizenship"
  | "residency"
  | "govId"
  | "bankBalance"
  | "monthlyIncome"
  | "creditScore"
  | "netWorth"
  | "educationLevel"
  | "yearsExperience"
  | "employed"
  | "professionalLicense"
  | "noCriminalRecord"
  | "noBankruptcy"
  | "referencesVerified"
  | "healthClear";

export type FieldKind = "number" | "flag" | "level" | "residency";
export type ProofCategory = "identity" | "financial" | "qualification" | "background" | "custom";

export interface FieldDef {
  key: FieldKey;
  code: number;
  label: string;
  kind: FieldKind;
  category: Exclude<ProofCategory, "custom">;
  prefix?: string;
  suffix?: string;
  min: number;
  max: number;
  proveLabel: string;
}

export const FIELD_DEFS: Record<FieldKey, FieldDef> = {
  age: { key: "age", code: 1, label: "Age", kind: "number", category: "identity", suffix: " yrs", min: 0, max: 130, proveLabel: "Age" },
  citizenship: { key: "citizenship", code: 2, label: "Citizenship", kind: "flag", category: "identity", min: 0, max: 1, proveLabel: "Citizenship verified" },
  residency: { key: "residency", code: 3, label: "Residency", kind: "residency", category: "identity", min: 0, max: 64, proveLabel: "Residency" },
  govId: { key: "govId", code: 4, label: "Government ID", kind: "flag", category: "identity", min: 0, max: 1, proveLabel: "Government ID valid" },
  bankBalance: { key: "bankBalance", code: 5, label: "Bank balance", kind: "number", category: "financial", prefix: "$", min: 0, max: 1_000_000_000_000, proveLabel: "Bank balance" },
  monthlyIncome: { key: "monthlyIncome", code: 6, label: "Monthly income", kind: "number", category: "financial", prefix: "$", min: 0, max: 1_000_000_000, proveLabel: "Monthly income" },
  creditScore: { key: "creditScore", code: 7, label: "Credit score", kind: "number", category: "financial", min: 300, max: 850, proveLabel: "Credit score" },
  netWorth: { key: "netWorth", code: 8, label: "Net worth", kind: "number", category: "financial", prefix: "$", min: 0, max: 1_000_000_000_000, proveLabel: "Net worth" },
  educationLevel: { key: "educationLevel", code: 9, label: "Education level", kind: "level", category: "qualification", min: 1, max: 4, proveLabel: "Education level" },
  yearsExperience: { key: "yearsExperience", code: 10, label: "Years of experience", kind: "number", category: "qualification", suffix: " yrs", min: 0, max: 80, proveLabel: "Years of experience" },
  employed: { key: "employed", code: 11, label: "Employment", kind: "flag", category: "qualification", min: 0, max: 1, proveLabel: "Currently employed" },
  professionalLicense: { key: "professionalLicense", code: 12, label: "Professional license", kind: "flag", category: "qualification", min: 0, max: 1, proveLabel: "Professional license valid" },
  noCriminalRecord: { key: "noCriminalRecord", code: 13, label: "Criminal record", kind: "flag", category: "background", min: 0, max: 1, proveLabel: "No criminal record" },
  noBankruptcy: { key: "noBankruptcy", code: 14, label: "Bankruptcy history", kind: "flag", category: "background", min: 0, max: 1, proveLabel: "No bankruptcy history" },
  referencesVerified: { key: "referencesVerified", code: 15, label: "References", kind: "flag", category: "background", min: 0, max: 1, proveLabel: "References verified" },
  healthClear: { key: "healthClear", code: 16, label: "Health status", kind: "flag", category: "background", min: 0, max: 1, proveLabel: "Health clearance" },
};

export const FIELD_KEYS = Object.keys(FIELD_DEFS) as FieldKey[];
export const FIELD_BY_CODE: Record<number, FieldDef> = Object.fromEntries(FIELD_KEYS.map((k) => [FIELD_DEFS[k].code, FIELD_DEFS[k]]));

export const COUNTRIES: readonly string[] = [
  "India",
  "United States",
  "United Kingdom",
  "Canada",
  "Germany",
  "France",
  "Singapore",
  "Australia",
  "United Arab Emirates",
  "Japan",
];

export const EDUCATION_LEVELS: readonly string[] = ["High School", "Bachelor's", "Master's", "PhD"];

export interface Profile {
  name?: string;
  age?: number;
  citizenship?: boolean;
  residency?: string;
  govId?: boolean;
  bankBalance?: number;
  monthlyIncome?: number;
  creditScore?: number;
  netWorth?: number;
  educationLevel?: number;
  yearsExperience?: number;
  employed?: boolean;
  professionalLicense?: boolean;
  noCriminalRecord?: boolean;
  noBankruptcy?: boolean;
  referencesVerified?: boolean;
  healthClear?: boolean;
  sources?: Partial<Record<FieldKey | "name", string>>;
}

export interface Condition {
  field: FieldKey;
  threshold: number;
  negate?: boolean;
}

export type ProofSpec =
  | { mode: "single"; condition: Condition }
  | { mode: "logic"; groupA: Condition[]; groupB: Condition[]; op: "AND" | "OR" };

export function describeCondition(c: Condition): string {
  const def = FIELD_DEFS[c.field];
  const fmt = (n: number) => {
    const body = n.toLocaleString("en-US");
    return `${def.prefix ?? ""}${body}${def.suffix ?? ""}`;
  };
  let text: string;
  switch (def.kind) {
    case "flag":
      text = def.proveLabel;
      return c.negate ? `NOT (${text})` : text;
    case "residency":
      text = `Resident of ${COUNTRIES[c.threshold - 1] ?? "unknown country"}`;
      return c.negate ? `NOT (${text})` : text;
    case "level":
      text = `${def.proveLabel} ≥ ${EDUCATION_LEVELS[c.threshold - 1] ?? c.threshold}`;
      return c.negate ? `NOT (${text})` : text;
    default:
      return c.negate ? `${def.proveLabel} < ${fmt(c.threshold)}` : `${def.proveLabel} ≥ ${fmt(c.threshold)}`;
  }
}

export function formatProfileValue(key: FieldKey, profile: Profile): string {
  const def = FIELD_DEFS[key];
  const v = profile[key];
  if (v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") return v;
  if (def.kind === "level") return EDUCATION_LEVELS[v - 1] ?? String(v);
  return `${def.prefix ?? ""}${v.toLocaleString("en-US")}${def.suffix ?? ""}`;
}

export function categoryOfSpec(spec: ProofSpec): ProofCategory {
  if (spec.mode === "logic") return "custom";
  return FIELD_DEFS[spec.condition.field].category;
}
