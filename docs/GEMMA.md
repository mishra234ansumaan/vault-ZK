# Gemma integration guide

## Engines (priority order)

1. **Ollama** — `ollama pull gemma2:2b` (or any Gemma tag). The browser calls `/api/gemma/generate`, a loopback proxy to `OLLAMA_HOST` (default `http://127.0.0.1:11434`). Both ends are on the same machine; works with Wi-Fi off.
2. **transformers.js** — a small ONNX Gemma (`onnx-community/gemma-3-270m-it-ONNX`) runs in the browser (WebGPU, else WASM). Use Settings → Gemma AI → *Prepare* once while online; afterwards it is served from the browser cache.
3. **Rule engine** — deterministic extractor / policy table so the app never breaks. The header badge says *Gemma · rule fallback* when no model is serving.

`Settings → Gemma AI → Inference engine priority` can pin a single engine. Status is probed every 30 s and on demand.

## Tools

See [SKILL.md](../SKILL.md) for contracts. Behaviour notes:

* **parseDocumentOffline** — Gemma returns JSON; keys outside an allow-list are dropped; values must literally occur in the source (digit-wise for numbers) or are rejected and logged. Rule-engine fields win on conflict. Confidence = base from field count + bonus for model/rule agreement.
* **validateGovernmentSignature** — pure Web Crypto, no model.
* **suggestPrivacyOptimalPredicate** — Gemma proposes conditions from the allowed field set; thresholds are clamped to each field’s range; invalid output falls back to the rule policy table. “Apply to generator” loads it into the proof builder.
* **explainProofInPlainEnglish** — facts are derived from the proof’s *public signals* (not from the payload’s labels) and Gemma only phrases them.

## Agent loop

`runDocumentAgent` → each turn Gemma gets the manifest and completed tools and replies `{"tool": "..."}`. The harness enforces the allow-list, injects `docBytes`, validates arguments (zod) and logs every call:

```
12:01:07.311  → parseDocumentOffline(rawText=<1002 chars>)
12:01:08.002  [inference] Gemma replied in 640 ms (212 tokens)
12:01:08.004  ← parseDocumentOffline ✓ type=bank_statement fields=5 signature=valid confidence=0.99 [693ms]
```

## Model facts shown in the UI

Engine, model tag, installed models (from `/api/tags`), tokens/s (from Ollama `eval_count / eval_duration`), last latency, resident model memory (`/api/ps`), host CPU/RAM.

## Tips

* Slow first call = Ollama loading weights; later calls are fast.
* To use a newer Gemma generation: `ollama pull <tag>` then set the tag in Settings (or `OLLAMA_MODEL`).
* Set `OLLAMA_HOST` if Ollama listens elsewhere on the **same machine**.
