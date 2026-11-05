#!/usr/bin/env bun
/**
 * A stub of `exp-e2e-frames` experiment 19's prover (`prover/src/main.rs` at
 * `47f5496`), for exp-mempool-l2s AG-11's vectors. It keeps the prover's
 * contract and not its cryptography (exp-mempool-l2s decision record 0083),
 * as exp-mempool-l2s's `conformance/prover-stub.py` does:
 *
 *   prover-stub.ts aggregate <claims.json> <out.bin>
 *   prover-stub.ts verify-aggregate <proof.bin> <claims.json>
 *   prover-stub.ts sphincs <seed hex> <message hex>
 *   prover-stub.ts verify-sphincs <publicKey hex> <message hex> <signature hex>
 *
 * Each prints one JSON line; a refusal is `{"error": ...}` and exit status 2.
 * Like the prover, it reads hex with or without 0x, and `sphincs` prints its
 * key and signature as bare hex.
 * A claim's `publicKey` and `message` are 32 bytes of hex. Its stand-in
 * signature is SHA-256 over "stub-leanSPHINCS", the key and the message; the
 * stand-in aggregate is "stub-aggregate" followed by SHA-256 over the sorted,
 * deduplicated keys and messages, each key before its message; and the
 * stand-in key of a 32-byte seed is SHA-256 over "stub-key" and the seed.
 */
/* eslint-disable no-console */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

function refuse(why: string): never {
  console.log(JSON.stringify({ error: why }));
  process.exit(2);
}

function raw(c: Record<string, unknown>, field: string, size?: number): Buffer {
  const v = c[field];
  if (typeof v !== "string") refuse(`no ${field}`);
  const hex = v.startsWith("0x") ? v.slice(2) : v;
  if (!/^([0-9a-fA-F]{2})*$/.test(hex)) refuse(`${field} is not hex`);
  const out = Buffer.from(hex, "hex");
  if (size !== undefined && out.length !== size)
    refuse(`a ${size}-byte ${field}`);
  return out;
}

const sha = (...parts: Buffer[]): Buffer =>
  createHash("sha256").update(Buffer.concat(parts)).digest();

function aggregateOf(pairs: [Buffer, Buffer][]): Buffer {
  const unique = [
    ...new Set(pairs.map(([k, m]) => Buffer.concat([k, m]).toString("hex"))),
  ].sort();
  return Buffer.concat([
    Buffer.from("stub-aggregate"),
    sha(...unique.map((h) => Buffer.from(h, "hex"))),
  ]);
}

function claimsOf(path: string): Record<string, unknown>[] {
  let claims: unknown;
  try {
    claims = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    refuse("the claims");
  }
  if (!Array.isArray(claims)) refuse("a list of claims");
  return claims as Record<string, unknown>[];
}

const args = process.argv.slice(2);
if (args.length === 3 && args[0] === "aggregate") {
  const pairs: [Buffer, Buffer][] = [];
  for (const c of claimsOf(args[1])) {
    const key = raw(c, "publicKey", 32);
    const message = raw(c, "message", 32);
    const signature = raw(c, "signature");
    if (!signature.equals(sha(Buffer.from("stub-leanSPHINCS"), key, message)))
      refuse("a signature that does not open at its message");
    pairs.push([key, message]);
  }
  const proof = aggregateOf(pairs);
  writeFileSync(args[2], proof);
  console.log(
    JSON.stringify({
      claims: pairs.length,
      proofBytes: proof.length,
      aggregateMs: 0,
      peakRssBytes: 0,
    })
  );
} else if (args.length === 3 && args[0] === "verify-aggregate") {
  let proof: Buffer;
  try {
    proof = readFileSync(args[1]);
  } catch {
    refuse("the proof");
  }
  const pairs = claimsOf(args[2]).map(
    (c) => [raw(c, "publicKey", 32), raw(c, "message", 32)] as [Buffer, Buffer]
  );
  if (!proof.equals(aggregateOf(pairs)))
    refuse("the proof does not cover these claims");
  console.log(JSON.stringify({ verified: true, verifyMs: 0 }));
} else if (args.length === 4 && args[0] === "verify-sphincs") {
  // exp-mempool-l2s `11-surface.md`, SF-10
  const key = raw({ publicKey: args[1] }, "publicKey", 32);
  const message = raw({ message: args[2] }, "message", 32);
  const signature = raw({ signature: args[3] }, "signature");
  console.log(
    JSON.stringify({
      verified: signature.equals(
        sha(Buffer.from("stub-leanSPHINCS"), key, message)
      ),
    })
  );
} else if (args.length === 3 && args[0] === "sphincs") {
  const seed = raw({ seed: args[1] }, "seed", 32);
  const message = raw({ message: args[2] }, "message", 32);
  const key = sha(Buffer.from("stub-key"), seed);
  const signature = sha(Buffer.from("stub-leanSPHINCS"), key, message);
  console.log(
    JSON.stringify({
      publicKey: key.toString("hex"),
      signature: signature.toString("hex"),
      signatureBytes: signature.length,
      verified: true,
    })
  );
} else {
  console.error(
    "usage: prover-stub.ts aggregate <claims.json> <out.bin> | verify-aggregate <proof.bin> <claims.json> | sphincs <seed> <message> | verify-sphincs <publicKey> <message> <signature>"
  );
  process.exit(1);
}
