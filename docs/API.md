# API reference

## HTTP routes (server)

| Route | Method | Description |
|---|---|---|
| `/api/health` | GET | Readiness probe (`{ok:true}`) |
| `/api/gemma/status` | GET | Probes local Ollama: `reachable`, `models[]`, `running[]`, host `system` stats (cpus, loadAvg1, mem), `defaultModel` |
| `/api/gemma/generate` | POST | Body `{model, messages[{role,content}], json?, maxTokens?}` → `{content, evalCount, evalDurationNs, totalDurationNs, model}`. Forwards to `OLLAMA_HOST/api/chat` (non-streaming, `format: json` when `json`). 502 if Ollama is unreachable |
| `/api/gemma/pull` | POST | Body `{model}` → NDJSON stream of `ollama pull` progress (needs internet once) |

## Proof payload (QR / NFC / share link)

```jsonc
{
  "v": 1,
  "id": "vzk_3f9a1c0b77de",          // sha256(circuit, proof, signals)[0:12]
  "circuit": "range",                  // "range" | "logic"
  "proof": { "a": [x, y], "b": [[x0, x1], [y0, y1]], "c": [x, y] },
  "signals": ["<commitment>", "50000", "<nonce>", "<expiry-unix-sec>", "5"],
  "issuedAt": 1767225600,
  "verifier": "bank"                   // optional tag, not security relevant
}
```

Public signal order — `range`: `[commitment, threshold, nonce, expiry, predicateFieldCode]`;
`logic`: `[commitment, t0..t3, field0..field3, neg0..neg3, op, nonce, expiry]`.
The share link is `/verify#p=<base64url(JSON)>`.

## Library (TypeScript)

```ts
// ZK
generateProof(spec: ProofSpec, profile: Profile, opts: GenerateOptions): Promise<GeneratedProof>
verifyProofMath(payload: ProofPayload): Promise<MathVerification>
decodeSignals(circuit, signals): DecodedProof | null      // what the proof actually states

// Proof lifecycle (src/lib/proofs.ts)
verifyPayloadText(text: string, record?: boolean): Promise<VerifyOutcome>
revokeProofs(ids: string[]): Promise<number>
panicRevokeAll(): Promise<number>

// Gemma tools (src/lib/gemma/tools.ts)
parseDocumentOffline(rawText: string): Promise<DocumentParseResult>
validateGovernmentSignature(docBytes: Uint8Array): Promise<SignatureValidationResult>
suggestPrivacyOptimalPredicate(userGoal: string): Promise<PredicateSuggestion>
explainProofInPlainEnglish(zkProof: ProofPayload): Promise<string>
runDocumentAgent({fileName, text, bytes}): Promise<DocumentAgentResult>

// Vault
storeDocument, reencryptDocument, deleteDocument, getProfile, mergeProfile, exportBackup, importBackup
```

## Signed document format

```
<document body>
-----BEGIN VZK SIGNATURE-----
Authority: <name>
Key-Id: <trust anchor id>
Algorithm: RSA-SHA256-PKCS1v1.5
Signed-At: 2024-10-31T18:00:00Z
Signature: <base64>
-----END VZK SIGNATURE-----
```

The signature covers every byte before the `-----BEGIN` line (minus one trailing `\n`).
Generate test fixtures with `node scripts/generate-samples.mjs`.
