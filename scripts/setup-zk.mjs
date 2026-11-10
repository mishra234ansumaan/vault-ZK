#!/usr/bin/env node
// Compiles the Circom circuits and runs a Groth16 trusted setup (dev ceremony).
// Usage: CIRCOM_BIN=/path/to/circom node scripts/setup-zk.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, copyFileSync, existsSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import path from "node:path";

const require = createRequire(import.meta.url);
const snarkjs = require("snarkjs");
const root = process.cwd();
const circom = process.env.CIRCOM_BIN || "circom";
const out = path.join(root, "public", "zk");
const build = path.join(root, ".zk-build");
mkdirSync(out, { recursive: true });
mkdirSync(build, { recursive: true });

const circuits = ["range", "logic"];
const ptauFinal = path.join(build, "pot13_final.ptau");

async function ptau() {
  if (existsSync(ptauFinal)) return;
  const p0 = path.join(build, "pot13_0.ptau");
  const p1 = path.join(build, "pot13_1.ptau");
  const { getCurveFromName } = await import("ffjavascript");
  const curve = await getCurveFromName("bn128");
  await snarkjs.powersOfTau.newAccumulator(curve, 13, p0);
  await snarkjs.powersOfTau.contribute(p0, p1, "vaultzk-contribution-1", randomBytes(32).toString("hex"));
  await snarkjs.powersOfTau.preparePhase2(p1, ptauFinal);
}

async function main() {
  await ptau();
  for (const name of circuits) {
    console.log(`compiling ${name}...`);
    execFileSync(
      circom,
      [path.join(root, "circuits", `${name}.circom`), "--r1cs", "--wasm", "-o", build, "-l", path.join(root, "node_modules")],
      { stdio: "inherit" },
    );
    const r1cs = path.join(build, `${name}.r1cs`);
    const zkey0 = path.join(build, `${name}_0.zkey`);
    const zkeyF = path.join(out, `${name}_final.zkey`);
    await snarkjs.zKey.newZKey(r1cs, ptauFinal, zkey0);
    await snarkjs.zKey.contribute(zkey0, zkeyF, "vaultzk-phase2", randomBytes(32).toString("hex"));
    const vkey = await snarkjs.zKey.exportVerificationKey(zkeyF);
    writeFileSync(path.join(out, `${name}_vkey.json`), JSON.stringify(vkey));
    copyFileSync(path.join(build, `${name}_js`, `${name}.wasm`), path.join(out, `${name}.wasm`));
    rmSync(zkey0, { force: true });
  }

  // Vendor offline assets.
  copyFileSync(path.join(root, "node_modules/snarkjs/build/snarkjs.min.js"), path.join(out, "snarkjs.min.js"));
  const meta = {
    generatedAt: new Date().toISOString(),
    curve: "bn128",
    protocol: "groth16",
    circuits: circuits.map((c) => ({ name: c, vkey: JSON.parse(readFileSync(path.join(out, `${c}_vkey.json`), "utf8")).nPublic })),
  };
  writeFileSync(path.join(out, "meta.json"), JSON.stringify(meta, null, 2));
  console.log("ZK artifacts ready in public/zk");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
