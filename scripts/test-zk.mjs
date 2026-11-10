#!/usr/bin/env node
// Smoke test: real Groth16 prove/verify against the shipped circuits and artifacts.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const snarkjs = require("snarkjs");
const zk = (f) => `public/zk/${f}`;
const vkey = (n) => JSON.parse(readFileSync(zk(`${n}_vkey.json`), "utf8"));

async function main() {
  const r = await snarkjs.groth16.fullProve(
    { value: "84250", salt: "12345", threshold: "50000", nonce: "99", expiry: "1999999999", predicate: "5" },
    zk("range.wasm"),
    zk("range_final.zkey"),
  );
  assert.equal(await snarkjs.groth16.verify(vkey("range"), r.publicSignals, r.proof), true, "range proof verifies");

  const tampered = [...r.publicSignals];
  tampered[1] = "10";
  assert.equal(await snarkjs.groth16.verify(vkey("range"), tampered, r.proof), false, "tampered threshold rejected");

  await assert.rejects(
    () => snarkjs.groth16.fullProve({ value: "100", salt: "1", threshold: "50000", nonce: "1", expiry: "1", predicate: "5" }, zk("range.wasm"), zk("range_final.zkey")),
    "unsatisfiable statement has no witness",
  );

  const l = await snarkjs.groth16.fullProve(
    { value: ["30", "80000", "0", "0"], salt: "5", threshold: ["21", "50000", "1", "0"], field: ["1", "6", "0", "0"], neg: ["0", "0", "0", "0"], op: "1", nonce: "1", expiry: "2" },
    zk("logic.wasm"),
    zk("logic_final.zkey"),
  );
  assert.equal(await snarkjs.groth16.verify(vkey("logic"), l.publicSignals, l.proof), true, "logic proof verifies");
  process.stdout.write("zk smoke test passed\n");
}

main().then(() => process.exit(0)).catch((e) => {
  process.stderr.write(`${e.stack ?? e}\n`);
  process.exit(1);
});
