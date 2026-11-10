pragma circom 2.0.0;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// LogicProof: proves a two-group boolean formula over four range predicates
//
//     (c0 AND c1)  <op>  (c2 AND c3)          op: 0 = AND, 1 = OR
//
// where c_i = (value_i >= threshold_i), optionally negated by neg_i.
// The verifier learns that the formula holds, but NOT which branch of an OR
// was satisfied, and nothing about the private values themselves.
template LogicProof(n) {
    signal input value[4];       // private
    signal input salt;           // private
    signal input threshold[4];   // public
    signal input field[4];       // public (field identifiers, bind labels)
    signal input neg[4];         // public (1 = negate predicate)
    signal input op;             // public
    signal input nonce;          // public
    signal input expiry;         // public
    signal output commitment;

    component ge[4];
    signal flip[4];
    signal c[4];
    for (var i = 0; i < 4; i++) {
        neg[i] * (neg[i] - 1) === 0;
        ge[i] = GreaterEqThan(n);
        ge[i].in[0] <== value[i];
        ge[i].in[1] <== threshold[i];
        flip[i] <== neg[i] * (1 - 2 * ge[i].out);
        c[i] <== ge[i].out + flip[i];
    }

    op * (op - 1) === 0;

    signal g0;
    signal g1;
    signal both;
    signal anyOf;
    signal allOf;
    signal res;
    g0 <== c[0] * c[1];
    g1 <== c[2] * c[3];
    both <== g0 * g1;
    anyOf <== g0 + g1 - both;
    allOf <== both;
    res <== allOf + op * (anyOf - allOf);
    res === 1;

    component h = Poseidon(5);
    for (var j = 0; j < 4; j++) {
        h.inputs[j] <== value[j];
    }
    h.inputs[4] <== salt;
    commitment <== h.out;

    signal nonceSq;
    signal expirySq;
    signal fieldSq[4];
    nonceSq <== nonce * nonce;
    expirySq <== expiry * expiry;
    for (var k = 0; k < 4; k++) {
        fieldSq[k] <== field[k] * field[k];
    }
}

component main { public [threshold, field, neg, op, nonce, expiry] } = LogicProof(48);
