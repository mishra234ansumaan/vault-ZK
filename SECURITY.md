# Security policy

## Reporting a vulnerability

Please report privately via GitHub Security Advisories on the repository (do not open a public issue).
We aim to acknowledge within 72 hours.

## Threat model (summary)

| Asset | Protection | Limits |
|---|---|---|
| Documents & attributes at rest | AES-256-GCM, fresh 96-bit IV per record, non-extractable master `CryptoKey` in IndexedDB | A script running in the same origin can *use* the key (XSS = game over). The PIN/biometric gate protects the UI against casual access, not against a compromised origin |
| PIN | PBKDF2-SHA256, 210k iterations, random salt | 6 digits is low entropy; the gate is rate-limited only by UI |
| Backups | AES-256-GCM under PBKDF2(recovery phrase) | Anyone with file + phrase can decrypt |
| Proof privacy | Groth16 zero-knowledge; commitments are Poseidon(value, salt) with random salt | Public thresholds and field codes are revealed by design |
| Proof freshness | Expiry/nonce are public inputs bound by the SNARK | Replay inside the validity window is possible; use short expiries |
| Document authenticity | RSA-2048/SHA-256 signature check against trust anchors | **Shipped anchors are demo keys.** Circuit does not verify signatures in-circuit |
| Revocation | Local list + `BroadcastChannel` gossip | Verifiers on other devices only learn revocations they receive |

## Known limitations before production use

1. Replace demo trust anchors (`src/lib/trust-anchors.ts`) with real authority keys and pin them.
2. Replace the single-party Groth16 setup with a multi-party ceremony.
3. Biometric unlock is a simulation; wire WebAuthn for real device-bound authentication.
4. Ship a strict CSP (the app needs `wasm-unsafe-eval` and blob workers for snarkjs/Tesseract).
5. NFC is simulated; a native app is required for card emulation.
