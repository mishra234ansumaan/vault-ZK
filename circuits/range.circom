pragma circom 2.0.0;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// RangeProof: proves  value >= threshold  without revealing `value`.
//   private: value, salt
//   public : threshold, nonce, expiry, predicate
//   output : commitment = Poseidon(value, salt)
// nonce / expiry / predicate are squared into dummy constraints so the
// verifier's public signals are cryptographically bound to the proof
// (tampering with expiry or nonce invalidates the Groth16 verification).
template RangeProof(n) {
    signal input value;
    signal input salt;
    signal input threshold;
    signal input nonce;
    signal input expiry;
    signal input predicate;
    signal output commitment;

    component ge = GreaterEqThan(n);
    ge.in[0] <== value;
    ge.in[1] <== threshold;
    ge.out === 1;

    component h = Poseidon(2);
    h.inputs[0] <== value;
    h.inputs[1] <== salt;
    commitment <== h.out;

    signal nonceSq;
    signal expirySq;
    signal predicateSq;
    nonceSq <== nonce * nonce;
    expirySq <== expiry * expiry;
    predicateSq <== predicate * predicate;
}

component main { public [threshold, nonce, expiry, predicate] } = RangeProof(48);
