/**
 * Transactions: exp-mempool-l2s `docs/spec/00-model.md`, MD-5 to MD-7, FEE-3 and FEE-4.
 */
import { createHash } from "node:crypto";
import { effectiveTip } from "./model.js";

export const LEGACY = 0;
export const ACCESS_LIST = 1;
export const DYNAMIC_FEE = 2;
export const BLOB = 3;
export const SET_CODE = 4;
export const FRAME = 6;

export const DEFAULT_TO = "sink";

export type Rendered =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | ReadonlySet<string>
  | readonly Rendered[];

/** A deterministic rendering of a field value: sets sorted, integers tagged by kind. */
function render(value: Rendered): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof Set)
    return `{${[...value].sort().map(render).join(",")}}`;
  return `[${(value as readonly Rendered[]).map(render).join(",")}]`;
}

/**
 * MD-7: a deterministic function of every field, label included. The
 * reference hashes Python's rendering of the same fields; no vector depends
 * on the value, only on two transactions differing in a field having
 * different hashes.
 */
export function hashOf(kind: string, fields: readonly Rendered[]): string {
  return (
    "0x" +
    createHash("sha256")
      .update(render([kind, ...fields]))
      .digest("hex")
  );
}

// --- account-nonce transactions (types 0 to 4) -------------------------------

export const INTRINSIC_BASE = 21000n;
export const INTRINSIC_CREATE = 32000n;
export const CALLDATA_NONZERO = 16n;
export const PER_AUTHORIZATION = 25000n;
export const TOKENS_PER_NONZERO_BYTE = 4n;

/** MD-6: a state write; the fourth element, when present, is the address a tracer finds the slot associated with. */
export type Write = readonly [
  address: string,
  slot: bigint,
  value: bigint,
  associated?: string
];
export type RootWrite = readonly [
  sourceAddress: string,
  salt: string,
  root: string
];
export type Authority = string | readonly [address: string, nonce: bigint];

export interface TxInit {
  sender: string;
  nonce?: bigint;
  gas?: bigint;
  maxFee?: bigint;
  tip?: bigint;
  value?: bigint;
  to?: string | null;
  type?: number;
  dataSize?: number;
  size?: number | null;
  authorities?: readonly Authority[];
  delegate?: string | null;
  validSignature?: boolean;
  gasUsed?: bigint | null;
  writes?: readonly Write[];
  rootWrites?: readonly RootWrite[];
  label?: string;
}

/** MD-5. Defaults match exp-mempool-l2s `conformance/README.md`. */
export class Tx {
  readonly kind = "tx" as const;
  readonly sender: string;
  readonly nonce: bigint;
  readonly gas: bigint;
  readonly maxFee: bigint;
  readonly tip: bigint;
  readonly value: bigint;
  readonly to: string | null;
  readonly type: number;
  readonly dataSize: number;
  readonly size: number | null;
  readonly authorities: readonly Authority[];
  readonly delegate: string | null;
  readonly validSignature: boolean;
  readonly gasUsed: bigint | null;
  readonly writes: readonly Write[];
  readonly rootWrites: readonly RootWrite[];
  readonly label: string;
  readonly hash: string;

  constructor(init: TxInit) {
    this.sender = init.sender;
    this.nonce = init.nonce ?? 0n;
    this.gas = init.gas ?? 21000n;
    this.maxFee = init.maxFee ?? 100n;
    this.tip = init.tip ?? 10n;
    this.value = init.value ?? 0n;
    this.to = init.to === undefined ? DEFAULT_TO : init.to;
    this.type = init.type ?? DYNAMIC_FEE;
    this.dataSize = init.dataSize ?? 0;
    this.size = init.size ?? null;
    this.authorities = init.authorities ?? [];
    this.delegate = init.delegate ?? null;
    this.validSignature = init.validSignature ?? true;
    this.gasUsed = init.gasUsed ?? null;
    this.writes = init.writes ?? [];
    this.rootWrites = init.rootWrites ?? [];
    this.label = init.label ?? "";
    this.hash = hashOf("Tx", [
      this.sender,
      this.nonce,
      this.gas,
      this.maxFee,
      this.tip,
      this.value,
      this.to,
      this.type,
      this.dataSize,
      this.size,
      this.authorities.map((a) => (typeof a === "string" ? a : [...a])),
      this.delegate,
      this.validSignature,
      this.gasUsed,
      this.writes.map((w) => [...w]),
      this.rootWrites.map((w) => [...w]),
      this.label,
    ]);
  }

  /** MD-5: gas * max_fee + value. */
  get cost(): bigint {
    return this.gas * this.maxFee + this.value;
  }

  effectiveTip(baseFee: bigint): bigint {
    return effectiveTip(this.maxFee, this.tip, baseFee);
  }

  name(): string {
    return this.label || this.hash.slice(0, 10);
  }
}

/** FEE-3. */
export function intrinsicGas(tx: Tx): bigint {
  let gas =
    INTRINSIC_BASE +
    CALLDATA_NONZERO * BigInt(tx.dataSize) +
    PER_AUTHORIZATION * BigInt(tx.authorities.length);
  if (tx.to === null) gas += INTRINSIC_CREATE;
  return gas;
}

/** FEE-3, the EIP-7623 floor. */
export function floorDataGas(tx: Tx, floorCostPerToken: bigint): bigint {
  return (
    INTRINSIC_BASE +
    floorCostPerToken * TOKENS_PER_NONZERO_BYTE * BigInt(tx.dataSize)
  );
}

// --- frame transactions (type 6) ---------------------------------------------

export const DEFAULT_MODE = 0;
export const VERIFY_MODE = 1;
export const SENDER_MODE = 2;
export const DEP_VERIFY_MODE = 3; // EIP-8288, `docs/spec/05-aggregation.md`
export const LEANSPHINCS = 0x10;
export const LEANSTARK = 0x11;
export const APPROVE_PAYMENT = 0x1;
export const APPROVE_EXECUTION = 0x2;
export const APPROVE_SCOPE_MASK = 0x3;
export const ATOMIC_BATCH_FLAG = 0x4;

export const FRAME_TX_INTRINSIC_COST = 12000n;
export const FRAME_TX_PER_FRAME_COST = 475n;
export const TX_VALUE_COST = 6000n;
export const STANDARD_TOKEN_COST = 4n;
export const TOTAL_COST_FLOOR_PER_TOKEN = 16n;
export const TX_MAX_GAS_LIMIT = 16_777_216n;
export const MAX_FRAMES = 64;
export const MAX_NONCE_KEYS = 16; // EIP-8250

export const SIGNATURE_GAS: Readonly<Record<string, bigint>> = {
  secp256k1: 2800n,
  p256: 6700n,
  arbitrary: 100n,
};
export const SIGNATURE_BYTES: Readonly<Record<string, number>> = {
  secp256k1: 65,
  p256: 128,
};

/** MD-6. */
export interface Signature {
  readonly scheme: string;
  readonly signer: string | null;
  readonly canonicalMsg: boolean;
  readonly valid: boolean;
  readonly length: number;
}

export function signature(init: Partial<Signature> = {}): Signature {
  return {
    scheme: init.scheme ?? "secp256k1",
    signer: init.signer ?? null,
    canonicalMsg: init.canonicalMsg ?? true,
    valid: init.valid ?? true,
    length: init.length ?? 0,
  };
}

export function signatureBytes(s: Signature): number {
  const bytes =
    s.scheme in SIGNATURE_BYTES ? SIGNATURE_BYTES[s.scheme] : s.length;
  return (s.signer !== null ? 20 : 0) + (s.canonicalMsg ? 0 : 32) + bytes;
}

export function signatureGas(s: Signature): bigint {
  return SIGNATURE_GAS[s.scheme] ?? 0n;
}

/** MD-6, AG-2: a (scheme, data_hash, verification_key_hash) triple. */
export interface Dependency {
  readonly scheme: number;
  readonly dataHash: string;
  readonly vkHash: string;
}

/** AG-5's order: by scheme, then the data hash, then the key hash. */
export function compareDependencies(a: Dependency, b: Dependency): number {
  if (a.scheme !== b.scheme) return a.scheme - b.scheme;
  if (a.dataHash !== b.dataHash) return a.dataHash < b.dataHash ? -1 : 1;
  if (a.vkHash !== b.vkHash) return a.vkHash < b.vkHash ? -1 : 1;
  return 0;
}

export function dependencyId(d: Dependency): string {
  return `${d.scheme}/${d.dataHash}/${d.vkHash}`;
}

/** The sorted, deduplicated list of `deps`. */
export function sortedUnique(deps: Iterable<Dependency>): Dependency[] {
  const seen = new Map<string, Dependency>();
  for (const d of deps) seen.set(dependencyId(d), d);
  return [...seen.values()].sort(compareDependencies);
}

export type Read = readonly [
  address: string,
  slot: bigint,
  expected: bigint | null,
  associated?: string
];
export type RootReference = readonly [
  sourceId: string,
  slot: number,
  root: string
];

/** MD-6: the EIP-8141 fields, then what a node simulating the frame would observe. */
export interface Frame {
  readonly mode: number;
  readonly flags: number;
  readonly target: string | null;
  readonly execGas: bigint;
  readonly stateGas: bigint;
  readonly value: bigint;
  readonly dataSize: number;
  readonly approves: number | null;
  readonly reverts: boolean;
  readonly opcodes: ReadonlySet<string>;
  readonly reads: readonly Read[];
  readonly writes: readonly Write[];
  readonly calls: readonly string[];
  readonly installsCode: string | null;
  readonly deadline: bigint | null; // a uint64 (SF-3), so not a double
  readonly deps: readonly Dependency[]; // a dependency frame's triples (AG-2)
  readonly roots: readonly RootReference[]; // a recent root verifier frame's references (RR-4)
}

export function frame(init: Partial<Frame> & { mode: number }): Frame {
  return {
    mode: init.mode,
    flags: init.flags ?? 0,
    target: init.target ?? null,
    execGas: init.execGas ?? 0n,
    stateGas: init.stateGas ?? 0n,
    value: init.value ?? 0n,
    dataSize: init.dataSize ?? 0,
    approves: init.approves ?? null,
    reverts: init.reverts ?? false,
    opcodes: init.opcodes ?? new Set(),
    reads: init.reads ?? [],
    writes: init.writes ?? [],
    calls: init.calls ?? [],
    installsCode: init.installsCode ?? null,
    deadline: init.deadline ?? null,
    deps: init.deps ?? [],
    roots: init.roots ?? [],
  };
}

function frameFields(f: Frame): Rendered[] {
  return [
    f.mode,
    f.flags,
    f.target,
    f.execGas,
    f.stateGas,
    f.value,
    f.dataSize,
    f.approves,
    f.reverts,
    f.opcodes,
    f.reads.map((r) => [...r]),
    f.writes.map((w) => [...w]),
    [...f.calls],
    f.installsCode,
    f.deadline,
    f.deps.map((d) => [d.scheme, d.dataHash, d.vkHash]),
    f.roots.map((r) => [...r]),
  ];
}

function byteLength(x: bigint): number {
  let n = 0;
  for (let v = x; v > 0n; v >>= 8n) n++;
  return n;
}

/** FEE-4: the length of a canonical RLP integer; zero is the single byte 0x80. */
export function rlpIntLen(x: bigint): number {
  return x < 128n ? 1 : 1 + byteLength(x);
}

/** FEE-4: the length of an RLP list whose items encode in `payload` bytes. */
export function rlpListLen(payload: number): number {
  return payload <= 55
    ? 1 + payload
    : 1 + byteLength(BigInt(payload)) + payload;
}

/** FEE-4's N: rlp(nonce_keys) || rlp(nonce_seq), EIP-8250 "Transaction payload". */
export function nonceBytes(
  nonceKeys: readonly bigint[],
  nonceSeq: bigint
): number {
  return (
    rlpListLen(nonceKeys.reduce((n, k) => n + rlpIntLen(k), 0)) +
    rlpIntLen(nonceSeq)
  );
}

export interface FrameGas {
  readonly intrinsic: bigint;
  readonly floor: bigint;
  readonly maxGas: bigint;
}

/**
 * MD-6, CG-2: an admission claim for one slot in one epoch; `valid` is CG-9's
 * verdict on its ticket, and `bound` CG-12's on its binder (default true; a
 * claim with no binder from a real ticket is not bound).
 */
export interface Claim {
  readonly sender: string;
  readonly nonceKeys: readonly bigint[];
  readonly nonceSeq: bigint;
  readonly epoch: number;
  readonly valid: boolean;
  readonly salt: string;
  readonly binder?: string;
  readonly bound?: boolean;
}

/** CG-2: a transaction's or a claim's slot, as one string. */
export function slotId(
  sender: string,
  nonceKeys: readonly bigint[],
  nonceSeq: bigint
): string {
  return `${sender}/${nonceKeys.join(",")}/${nonceSeq}`;
}

/** CG-2: two claims with equal fields are one claim. */
export function claimId(c: Claim): string {
  const binder = c.binder ? `/${c.binder}` : "";
  const bound = c.bound === false ? "/unbound" : "";
  return `${slotId(c.sender, c.nonceKeys, c.nonceSeq)}/${c.epoch}/${c.valid}/${
    c.salt
  }${binder}${bound}`;
}

export interface FrameTxInit {
  sender: string;
  frames: readonly Frame[];
  nonceKeys?: readonly bigint[];
  nonceSeq?: bigint;
  signatures?: readonly Signature[];
  maxFee?: bigint;
  tip?: bigint;
  size?: number | null;
  writes?: readonly Write[];
  gasUsed?: bigint | null;
  label?: string;
  rootWrites?: readonly RootWrite[];
  /** MD-6, FEE-4's Z: how many of the D bytes are zero. */
  zeroBytes?: number;
  /** MD-6: a client's answer for the prefix at the pool's head; not part of the identity (MD-7). */
  verdict?: string | null;
  /** MD-6, CG-2: absent, it leaves the hash as it was. */
  claim?: Claim | null;
}

const max = (a: bigint, b: bigint): bigint => (a > b ? a : b);

/** MD-6. */
export class FrameTx {
  readonly kind = "frame" as const;
  readonly type = FRAME;
  readonly sender: string;
  readonly frames: readonly Frame[];
  readonly nonceKeys: readonly bigint[];
  readonly nonceSeq: bigint;
  readonly signatures: readonly Signature[];
  readonly maxFee: bigint;
  readonly tip: bigint;
  readonly size: number | null;
  readonly writes: readonly Write[];
  readonly gasUsed: bigint | null;
  readonly label: string;
  readonly rootWrites: readonly RootWrite[];
  readonly zeroBytes: number;
  readonly verdict: string | null;
  readonly claim: Claim | null;
  readonly hash: string;
  /** FEE-4's D: frame data, signature bytes and the nonce fields. */
  readonly dataBytes: number;
  /** FEE-4. */
  readonly gas: FrameGas;
  /** AG-4: the sorted, deduplicated triples of its dependency frames. */
  readonly dependencies: readonly Dependency[];
  /** AG-8: how many triples its dependency frames declare, duplicates included. */
  readonly declared: number;

  constructor(init: FrameTxInit) {
    this.sender = init.sender;
    this.frames = init.frames;
    this.nonceKeys = init.nonceKeys ?? [0n];
    this.nonceSeq = init.nonceSeq ?? 0n;
    this.signatures = init.signatures ?? [signature()];
    this.maxFee = init.maxFee ?? 100n;
    this.tip = init.tip ?? 10n;
    this.size = init.size ?? null;
    this.writes = init.writes ?? [];
    this.gasUsed = init.gasUsed ?? null;
    this.label = init.label ?? "";
    this.rootWrites = init.rootWrites ?? [];
    this.zeroBytes = init.zeroBytes ?? 0;
    this.verdict = init.verdict ?? null;
    this.claim = init.claim ?? null;
    const claim = this.claim;
    this.hash = hashOf("FrameTx", [
      this.sender,
      this.frames.map(frameFields),
      [...this.nonceKeys],
      this.nonceSeq,
      this.signatures.map((s) => [
        s.scheme,
        s.signer,
        s.canonicalMsg,
        s.valid,
        s.length,
      ]),
      this.maxFee,
      this.tip,
      this.size,
      this.writes.map((w) => [...w]),
      this.gasUsed,
      this.label,
      this.rootWrites.map((w) => [...w]),
      this.type,
      this.zeroBytes,
      ...(claim === null ? [] : [["claim", claimId(claim)]]),
    ]);

    this.dataBytes =
      this.frames.reduce((n, f) => n + f.dataSize, 0) +
      this.signatures.reduce((n, s) => n + signatureBytes(s), 0) +
      nonceBytes(this.nonceKeys, this.nonceSeq);
    const n = BigInt(this.frames.length);
    const sigGas = this.signatures.reduce((g, s) => g + signatureGas(s), 0n);
    const valueFrames = this.frames.filter(
      (f) => f.value > 0n && f.target !== null && f.target !== this.sender
    );
    const valueGas = TX_VALUE_COST * BigInt(valueFrames.length);
    const fixed =
      FRAME_TX_INTRINSIC_COST + n * FRAME_TX_PER_FRAME_COST + sigGas + valueGas;
    const d = BigInt(this.dataBytes);
    const z = BigInt(this.zeroBytes);
    // a zero byte is one token and any other four; the floor counts four for every byte
    const intrinsic =
      fixed + STANDARD_TOKEN_COST * (TOKENS_PER_NONZERO_BYTE * (d - z) + z);
    const floor =
      fixed + TOTAL_COST_FLOOR_PER_TOKEN * TOKENS_PER_NONZERO_BYTE * d;
    const execSum = this.frames.reduce((g, f) => g + f.execGas, 0n);
    const stateSum = this.frames.reduce((g, f) => g + f.stateGas, 0n);
    this.gas = {
      intrinsic,
      floor,
      maxGas: max(intrinsic + execSum + stateSum, floor + stateSum),
    };

    // only a dependency frame has deps (MD-6), whichever mode the profile gives it
    this.dependencies = sortedUnique(this.frames.flatMap((f) => f.deps));
    this.declared = this.frames.reduce((k, f) => k + f.deps.length, 0);
  }

  get maxGas(): bigint {
    return this.gas.maxGas;
  }

  get maxCost(): bigint {
    return this.gas.maxGas * this.maxFee;
  }

  get cost(): bigint {
    return this.maxCost;
  }

  get nonce(): bigint {
    return this.nonceSeq;
  }

  /** CG-2: the place only one transaction fills. */
  get slot(): string {
    return slotId(this.sender, this.nonceKeys, this.nonceSeq);
  }

  effectiveTip(baseFee: bigint): bigint {
    return effectiveTip(this.maxFee, this.tip, baseFee);
  }

  name(): string {
    return this.label || this.hash.slice(0, 10);
  }

  /** The same transaction with a new verdict: its hash does not change (MD-7). */
  withVerdict(verdict: string | null): FrameTx {
    const copy = Object.create(FrameTx.prototype) as FrameTx;
    Object.assign(copy, this, { verdict });
    return copy;
  }
}

/** NP-11 (and FP-12): both fee fields rise strictly and reach the floored threshold. */
export function replaces(
  old: { maxFee: bigint; tip: bigint },
  next: { maxFee: bigint; tip: bigint },
  priceBump: number
): boolean {
  if (old.maxFee >= next.maxFee || old.tip >= next.tip) return false;
  const bump = BigInt(100 + priceBump);
  return (
    next.maxFee >= (bump * old.maxFee) / 100n &&
    next.tip >= (bump * old.tip) / 100n
  );
}
