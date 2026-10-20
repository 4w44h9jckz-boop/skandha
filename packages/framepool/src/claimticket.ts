/**
 * A claim's ticket: exp-mempool-l2s `docs/spec/10-claim-gated-admission.md`,
 * version 4. CG-8, the bytes an issuer signs; CG-9, when a node takes a
 * ticket as valid (a BLS12-381 signature in G1 under a key in G2, both in
 * EIP-2537's encoding); CG-10, the frame to a ticket paymaster that carries
 * it, the paymaster recognised by its code.
 *
 * The curve is @noble/curves'. EIP-2537's encoding is decoded here, with its
 * padding, range and infinity rules, before noble sees the points.
 */
import { bls12_381 as bls } from "@noble/curves/bls12-381";
import { keccak256 } from "./keccak.js";

export const NAMESPACE = new TextEncoder().encode("FRAME_TICKET_V1");
export const PAY_DATA = 168; // CG-10: epoch (8), salt (32), the signature (128)
const DST = "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_POP_";
const P = bls.fields.Fp.ORDER;
const U64 = BigInt(2) ** BigInt(64);
const U256 = BigInt(2) ** BigInt(256);
const VERIFY = 1;
// CG-10: the ticket-paymaster template, then a 256-byte key and 32 bytes
const TEMPLATE_LENGTH = 1105;
const TEMPLATE_KECCAK =
  "0xec9f3f855524392a3891f2f2eb554781236d5565520d68388e455be74bdf3fe0";

/** A claim's fields as a ticket names them, with the chain it is for. */
export interface TicketClaim {
  readonly chainId: bigint;
  readonly epoch: bigint;
  readonly sender: Uint8Array;
  readonly nonceSeq: bigint;
  readonly nonceKeys: readonly bigint[];
  readonly salt: Uint8Array;
}

function be(x: bigint, width: number): Uint8Array {
  const out = new Uint8Array(width);
  for (let i = width - 1, v = x; i >= 0; i--, v >>= BigInt(8))
    out[i] = Number(v & BigInt(0xff));
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const hex = (b: Uint8Array): string => "0x" + Buffer.from(b).toString("hex");

/** EIP-8250's, the word `TXPARAM(0x0F)` returns. */
export function nonceKeysHash(keys: readonly bigint[]): Uint8Array {
  return keccak256(
    concat([be(BigInt(keys.length), 32), ...keys.map((k) => be(k, 32))])
  );
}

/** CG-8: the message, or null when the claim has none. */
export function ticketMessage(c: TicketClaim): Uint8Array | null {
  if (c.chainId >= U256 || c.nonceKeys.some((k) => k >= U256)) return null;
  if (c.epoch >= U64 || c.nonceSeq >= U64) return null;
  if (c.sender.length !== 20 || c.salt.length !== 32) return null;
  return concat([
    be(c.chainId, 32),
    c.sender,
    nonceKeysHash(c.nonceKeys),
    be(c.nonceSeq, 8),
    be(c.epoch, 8),
    c.salt,
  ]);
}

/** EIP-2537: a field element in 64 bytes, its top 16 zero, below p; null if not. */
function fp(bytes: Uint8Array): bigint | null {
  if (bytes.subarray(0, 16).some((b) => b !== 0)) return null;
  const v = BigInt(hex(bytes.subarray(16)));
  return v < P ? v : null;
}

function coordinates(bytes: Uint8Array, n: number): bigint[] | null {
  const out: bigint[] = [];
  for (let i = 0; i < n; i++) {
    const v = fp(bytes.subarray(64 * i, 64 * (i + 1)));
    if (v === null) return null;
    out.push(v);
  }
  return out.every((v) => v === BigInt(0)) ? null : out; // zeros: infinity, refused
}

/** CG-9 step 3 for the signature: on the curve, in G1, not at infinity; null if not. */
function g1(
  bytes: Uint8Array
): InstanceType<typeof bls.G1.ProjectivePoint> | null {
  if (bytes.length !== 128) return null;
  const c = coordinates(bytes, 2);
  if (c === null) return null;
  const point = bls.G1.ProjectivePoint.fromAffine({ x: c[0], y: c[1] });
  point.assertValidity();
  return point;
}

/** CG-9 step 3 for the key: on the twist, in G2, not at infinity; null if not. */
function g2(
  bytes: Uint8Array
): InstanceType<typeof bls.G2.ProjectivePoint> | null {
  if (bytes.length !== 256) return null;
  const c = coordinates(bytes, 4);
  if (c === null) return null;
  const Fp2 = bls.fields.Fp2;
  const point = bls.G2.ProjectivePoint.fromAffine({
    x: Fp2.fromBigTuple([c[0], c[1]]),
    y: Fp2.fromBigTuple([c[2], c[3]]),
  });
  point.assertValidity();
  return point;
}

/** CG-9: step 1, then the points and the pairing check. */
export function ticketValid(
  c: TicketClaim,
  issuer: Uint8Array,
  signature: Uint8Array
): boolean {
  const m = ticketMessage(c);
  if (m === null) return false;
  try {
    const pk = g2(issuer);
    const sig = g1(signature);
    if (pk === null || sig === null) return false;
    if (!pk.isTorsionFree() || !sig.isTorsionFree()) return false;
    const u = concat([Uint8Array.of(NAMESPACE.length), NAMESPACE, m]);
    return bls.verifyShortSignature(sig, u, pk, { DST });
  } catch {
    return false;
  }
}

/** CG-10: the key of a ticket paymaster whose code this is, or null if it is not one. */
export function paymasterKey(code: Uint8Array): Uint8Array | null {
  if (code.length !== TEMPLATE_LENGTH + 256 + 32) return null;
  if (hex(keccak256(code.subarray(0, TEMPLATE_LENGTH))) !== TEMPLATE_KECCAK)
    return null;
  const key = code.subarray(TEMPLATE_LENGTH, TEMPLATE_LENGTH + 256);
  try {
    const point = g2(key);
    return point !== null && point.isTorsionFree() ? key : null;
  } catch {
    return null;
  }
}

/** A frame as CG-10 reads it. */
export interface TicketFrame {
  readonly mode: number;
  readonly target: string; // 0x-prefixed, lower case
  readonly data: Uint8Array;
}

/** What CG-10 finds: the claim's epoch and salt (null if the data is not a ticket's), its issuer, and CG-9's verdict. */
export interface CarriedTicket {
  readonly epoch: bigint | null;
  readonly salt: Uint8Array | null;
  readonly issuer: Uint8Array;
  readonly valid: boolean;
}

/**
 * CG-10: the claim a transaction carries, or null. `c` gives the
 * transaction's chain, sender and nonces; its epoch and salt are ignored.
 * `codes` is the code at the node's head of each account a frame targets;
 * an account it leaves out has none.
 */
export function carriedTicket(
  c: TicketClaim,
  frames: readonly TicketFrame[],
  codes: ReadonlyMap<string, Uint8Array>
): CarriedTicket | null {
  for (const f of frames) {
    if (f.mode !== VERIFY) continue;
    const issuer = paymasterKey(codes.get(f.target) ?? new Uint8Array(0));
    if (issuer === null) continue;
    if (f.data.length !== PAY_DATA)
      return { epoch: null, salt: null, issuer, valid: false };
    const epoch = BigInt(hex(f.data.subarray(0, 8)));
    const salt = f.data.subarray(8, 40);
    const claim = { ...c, epoch, salt };
    return {
      epoch,
      salt,
      issuer,
      valid: ticketValid(claim, issuer, f.data.subarray(40)),
    };
  }
  return null;
}
