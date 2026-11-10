---
name: vaultzk-eligibility-prover
version: 1.0.0
description: On-device Edge Agent Skill powered by Gemma for Zero-Knowledge eligibility verification
license: MIT
author: VaultZK team
repository: https://github.com/vaultzk/vaultzk-engine

metadata:
  target_model: Gemma (quantized GGUF via Ollama, default gemma2:2b; any Gemma tag is configurable)
  fallback_models:
    - onnx-community/gemma-3-270m-it-ONNX (transformers.js, in-browser)
    - deterministic rule engine (no model)
  execution_environment: Local On-Device
  network_requirement: Offline-capable (network only needed once to download model weights)
  minimum_ram: 4GB
  average_inference_time: 620ms (gemma2:2b Q4, 8-core laptop CPU, ~400-token JSON reply; measure yours in Settings → Gemma AI → Benchmark)

capabilities:
  - document_parsing
  - signature_validation
  - privacy_optimization
  - proof_explanation

tools:
  - name: parseDocumentOffline
    description: Extract structured fields from raw document text
    parameters:
      - rawText: string
    returns: DocumentParseResult

  - name: validateGovernmentSignature
    description: Verify RSA signatures on government documents
    parameters:
      - docBytes: Uint8Array
    returns: SignatureValidationResult

  - name: suggestPrivacyOptimalPredicate
    description: Suggest minimum disclosure for user goal
    parameters:
      - userGoal: string
    returns: PredicateSuggestion

  - name: explainProofInPlainEnglish
    description: Translate ZK proof into human-readable text
    parameters:
      - zkProof: ProofObject
    returns: string

examples:
  - input: "Parse this bank statement"
    workflow:
      - call: parseDocumentOffline
      - call: validateGovernmentSignature
      - output: Structured JSON with verified fields
  - input: "I want to rent an apartment for $1,800 a month"
    workflow:
      - call: suggestPrivacyOptimalPredicate
      - output: "monthlyIncome >= 5400 AND no_criminal_record, hiding exact income / bank details / employer"
---

# VaultZK Eligibility Prover — Agent Skill

This skill lets a **local** Gemma model act as an agent that turns sensitive documents into
zero-knowledge eligibility proofs. Nothing leaves the device.

## Harness

The reference harness lives in `src/lib/gemma/`:

| File | Role |
| --- | --- |
| `engine.ts` | Engine router: Ollama (`/api/gemma/generate` loopback proxy) → transformers.js → rule engine |
| `tools.ts` | The four tools, zod-validated arguments, structured timestamped logging, tool manifest |
| `harness.ts` | Planner loop: Gemma picks the next tool as JSON; harness validates, binds arguments, executes, applies guardrails |
| `heuristics.ts` | Deterministic extractor used both as fallback and as a grounding check on model output |

### Calling convention

The planner prompt contains the tool manifest and the completed-tool list. The model must answer
with a single JSON object:

```json
{"tool": "parseDocumentOffline"}
```

The harness (1) validates the name against an allow-list and the "not already run" rule,
(2) binds large arguments (document bytes) itself rather than trusting the model to echo them,
(3) validates arguments with zod, (4) executes locally, (5) logs
`→ tool(args)` / `← tool ✓ summary [ms]` to the visible console. If the model emits an invalid
choice a deterministic guardrail runs the next required tool and logs the intervention.

### Hallucination guard

Fields returned by Gemma in `parseDocumentOffline` are accepted only if the value literally appears
in the source text (numbers are compared digit-wise). Rejected fields are logged.

## Tool contracts

```ts
interface DocumentParseResult {
  documentType: "bank_statement" | "aadhaar" | "pan" | "tax_return" | "passport" | "degree" | "medical" | "employment" | "unknown";
  extractedFields: Record<string, string | number | boolean>; // balance, age, monthlyIncome, name, ...
  governmentSignature: "valid" | "invalid" | "none";
  confidence: number; // 0..1
  engine: string;
  groundedFromModel: number;
}

interface SignatureValidationResult {
  valid: boolean;
  state: "valid" | "invalid" | "none";
  authority: string;
  timestamp: Date | null;
  keyId?: string;
  reason: string;
  algorithm: string;
}

interface PredicateSuggestion {
  suggestedPredicate: string;      // "monthlyIncome >= 5400 AND no_criminal_record"
  explanation: string;
  hiddenFields: string[];          // ["exactIncome", "bankDetails", "employer", ...]
  conditions: { field: string; threshold: number; negate?: boolean }[];
  logic: "AND" | "OR";
  verifierType: string;
  source: "gemma" | "rules";
}

// ProofObject = the compact Groth16 payload (see docs/API.md)
```

## Running offline

```bash
ollama pull gemma2:2b        # once, online
# turn Wi-Fi off
npm run build && npm start   # everything — OCR, agent, proofs — keeps working
```

## Trust model

`validateGovernmentSignature` verifies RSA-2048 / SHA-256 (PKCS#1 v1.5) signatures with Web Crypto
against trust anchors in `src/lib/trust-anchors.ts`. The shipped anchors are **demo keys** generated by
`scripts/generate-samples.mjs`; replace them with real authority public keys for production.
