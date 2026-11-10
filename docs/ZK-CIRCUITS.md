# ZK circuits

Both circuits use circomlib `GreaterEqThan(48)` (values < 2^48 ≈ 2.8×10¹⁴) and Poseidon commitments, compiled with circom 2.1.9 and proven with Groth16 over BN254.

## `range.circom`

```
private: value, salt          public: threshold, nonce, expiry, predicate      output: commitment
assert value >= threshold
commitment = Poseidon(value, salt)
nonce², expiry², predicate² are constrained so the verifier’s public inputs are bound to the proof
```
291 non-linear constraints · 4 public inputs + 1 output.

`predicate` is the field code (Age = 1 … Health = 16), so a verifier decodes *what* was proven from the proof itself.
Flags (citizenship, no criminal record …) are 0/1 values with threshold 1. Residency uses value = country index if the holder resides there, else 0, with threshold = target index.

## `logic.circom`

```
c_i = GE(value_i, threshold_i), optionally negated by neg_i      (i = 0..3)
result = (c0∧c1) ⟨op⟩ (c2∧c3),   op ∈ {AND=0, OR=1}
assert result == 1
commitment = Poseidon(value_0..3, salt)
```
536 non-linear constraints · 15 public inputs + 1 output. Unused slots are padded with an always-true filler
(`threshold 0, field 0`), or an always-false filler for an empty group under OR, so groups of 1–2 conditions work.
The verifier sees the thresholds and fields but **not which branch of an OR held**, and nothing about the values.

## Time-bomb

`expiry` (unix seconds) is a public input. The verifier takes the expiry **from the verified signals**, so editing
the payload’s timestamps invalidates the proof. The UI exposes 10 s – 24 h.

## Trusted setup

`scripts/setup-zk.mjs` runs a single-party powers-of-tau (2^13) + phase-2 contribution. This is a **dev ceremony**.
For production run a multi-party ceremony or reuse the Hermez `powersOfTau28_hez_final_*` files and contribute to phase 2.

## Roadmap

* Verify the government RSA signature **inside** the circuit (or via a SNARK-friendly signature) so the proof binds directly to signed data.
* Merkle set-membership circuit (blacklists / allow-lists).
* Nullifiers for one-time-use proofs.
