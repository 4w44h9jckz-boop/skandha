/**
 * Sealed transactions (EIP-8184, LUCID): exp-mempool-l2s
 * `docs/spec/06-lucid.md`, LU-1 to LU-3, LU-6 and LU-7.
 *
 * The object, its ticket's fees, the order of commitments and what a builder
 * selects. The pool that holds sealed transactions is `sealedpool.ts`, and
 * the key round between the block that commits them and the one that runs
 * them is `lucidkeys.ts`.
 */
import { keccak256 } from "./keccak.js";
import { State } from "./model.js";
import { hashOf } from "./tx.js";

/** LU-1. */
export interface SealedPoolConfig {
  readonly name: string;
  readonly sealed: boolean;
  readonly tobGasFractionDenominator: bigint;
  readonly tobFeeFraction: bigint;
  readonly maxStCommits: number; // MAX_ST_COMMITS_PER_IL * IL_COMMITTEE_SIZE
  readonly maxBytesPerSt: number;
  readonly maxTxGas: bigint; // EIP-7825
  readonly calldataGasPerByte: bigint;
  readonly stSlots: number;
  readonly priceBump: number;
  readonly policy: "any" | "next-block" | "every-head";
  readonly evictFirst: "last" | "unplaced";
}

export const SEALED_OFF: SealedPoolConfig = {
  name: "off",
  sealed: false,
  tobGasFractionDenominator: 8n,
  tobFeeFraction: 128n,
  maxStCommits: 32,
  maxBytesPerSt: 2 ** 24 / 64,
  maxTxGas: 2n ** 24n,
  calldataGasPerByte: 64n,
  stSlots: 4096,
  priceBump: 10,
  policy: "any",
  evictFirst: "last",
};

export const EIP_8184: SealedPoolConfig = {
  ...SEALED_OFF,
  name: "eip-8184",
  sealed: true,
};

export const SEALED_PROFILES: ReadonlyMap<string, SealedPoolConfig> = new Map(
  [SEALED_OFF, EIP_8184].map((c) => [c.name, c])
);

/** LU-5: the ToB segment of a block with gas limit `gasLimit`. */
export function tobGasLimit(cfg: SealedPoolConfig, gasLimit: bigint): bigint {
  return gasLimit / cfg.tobGasFractionDenominator;
}

export interface SealedTxInit {
  sender: string;
  nonce?: bigint;
  maxFee?: bigint;
  tip?: bigint;
  gasLimit?: bigint;
  maxTobFee?: bigint;
  maxPreceding?: number;
  keyPublisher?: string;
  feeRecipient?: string;
  keyFee?: bigint;
  size?: number;
  signatureId?: number;
  validSignature?: boolean;
  ciphertextOk?: boolean;
  revealed?: boolean;
  used?: bigint | null;
  label?: string;
  kDem?: Uint8Array | null;
  keyCommitment?: Uint8Array | null;
  decrypts?: boolean | null;
}

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

/** LU-2. Defaults match exp-mempool-l2s's `conformance/README.md`. */
export class SealedTx {
  readonly sender: string;
  readonly nonce: bigint;
  readonly maxFee: bigint;
  readonly tip: bigint;
  readonly gasLimit: bigint;
  readonly maxTobFee: bigint;
  readonly maxPreceding: number;
  readonly keyPublisher: string;
  readonly feeRecipient: string;
  readonly keyFee: bigint;
  readonly size: number;
  readonly signatureId: number;
  readonly validSignature: boolean;
  readonly ciphertextOk: boolean;
  readonly revealed: boolean;
  readonly used: bigint | null;
  readonly label: string;
  /** LU-2 version 3: absent, each leaves the hash as it was. */
  readonly kDem: Uint8Array | null;
  readonly keyCommitment: Uint8Array | null;
  readonly decrypts: boolean | null;
  readonly hash: string;

  constructor(init: SealedTxInit) {
    this.sender = init.sender;
    this.nonce = init.nonce ?? 0n;
    this.maxFee = init.maxFee ?? 100n;
    this.tip = init.tip ?? 10n;
    this.gasLimit = init.gasLimit ?? 100_000n;
    this.maxTobFee = init.maxTobFee ?? 0n;
    this.maxPreceding = init.maxPreceding ?? 31;
    this.keyPublisher = init.keyPublisher ?? "kp";
    this.feeRecipient = init.feeRecipient ?? "kp";
    this.keyFee = init.keyFee ?? 0n;
    this.size = init.size ?? 512;
    this.signatureId = init.signatureId ?? 1;
    this.validSignature = init.validSignature ?? true;
    this.ciphertextOk = init.ciphertextOk ?? true;
    this.revealed = init.revealed ?? true;
    this.used = init.used ?? null;
    this.label = init.label ?? "";
    this.kDem = init.kDem ?? null;
    this.keyCommitment = init.keyCommitment ?? null;
    this.decrypts = init.decrypts ?? null;
    const optional = [
      this.kDem === null ? null : ["k_dem", hex(this.kDem)],
      this.keyCommitment === null
        ? null
        : ["key_commitment", hex(this.keyCommitment)],
      this.decrypts === null ? null : ["decrypts", this.decrypts],
    ].filter((x) => x !== null) as [string, string | boolean][];
    this.hash = hashOf("SealedTx", [
      this.sender,
      this.nonce,
      this.maxFee,
      this.tip,
      this.gasLimit,
      this.maxTobFee,
      this.maxPreceding,
      this.keyPublisher,
      this.feeRecipient,
      this.keyFee,
      this.size,
      this.signatureId,
      this.validSignature,
      this.ciphertextOk,
      this.revealed,
      this.used,
      this.label,
      ...optional.map(([k, v]) => [k, v]),
    ]);
  }

  /** LU-3: the most its ticket can be charged. */
  get cost(): bigint {
    return this.maxFee * this.gasLimit;
  }

  /** LU-2: the 32-byte key a key message for it releases. */
  get demKey(): Uint8Array {
    return this.kDem ?? new Uint8Array(32);
  }

  /** LU-2, LU-14: the ticket's key_commitment. */
  get commitmentKey(): Uint8Array {
    return this.keyCommitment ?? keccak256(this.demKey);
  }

  name(): string {
    return this.label || this.hash.slice(0, 10);
  }
}

/** LU-3, in wei for the whole ticket. */
export interface Fees {
  readonly priority: bigint;
  readonly tob: bigint;
  readonly ticketFee: bigint;
}

/** LU-3: the ticket's fees at `baseFee`, or null if it cannot pay. */
export function fees(st: SealedTx, baseFee: bigint): Fees | null {
  const g = st.gasLimit;
  const left = st.maxFee * g - baseFee * g - st.keyFee;
  if (left < 0n) return null;
  const priority = st.tip * g < left ? st.tip * g : left;
  const tob = st.maxTobFee < left - priority ? st.maxTobFee : left - priority;
  return { priority, tob, ticketFee: baseFee * g + st.keyFee + priority + tob };
}

/** LU-6, for ones that can pay: negative when `a` comes first. */
export function compareCommitment(
  a: SealedTx,
  b: SealedTx,
  baseFee: bigint
): number {
  const ta = fees(a, baseFee)?.tob ?? -1n;
  const tb = fees(b, baseFee)?.tob ?? -1n;
  if (ta !== tb) return ta > tb ? -1 : 1;
  if (a.gasLimit !== b.gasLimit) return a.gasLimit > b.gasLimit ? -1 : 1;
  return a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0;
}

/** LU-7, step 1. */
export function isCandidate(
  st: SealedTx,
  state: State,
  baseFee: bigint,
  minTip: bigint
): boolean {
  const f = fees(st, baseFee);
  return (
    f !== null &&
    st.nonce === state.nonce(st.sender) &&
    state.balance(st.sender) >= f.ticketFee &&
    f.priority >= minTip * st.gasLimit
  );
}

/** LU-7, step 2: whether a candidate is selected when `count` with `gas` in all are selected before it. */
export function takes(
  count: number,
  gas: bigint,
  st: SealedTx,
  room: bigint,
  cfg: SealedPoolConfig
): boolean {
  return (
    count < cfg.maxStCommits &&
    gas + st.gasLimit <= room &&
    count <= st.maxPreceding
  );
}

/** LU-7: the selection, in commitment order. */
export function select(
  sts: Iterable<SealedTx>,
  state: State,
  baseFee: bigint,
  minTip: bigint,
  gasLimit: bigint,
  cfg: SealedPoolConfig
): SealedTx[] {
  const candidates = [...sts]
    .filter((st) => isCandidate(st, state, baseFee, minTip))
    .sort((a, b) => compareCommitment(a, b, baseFee));
  const room = tobGasLimit(cfg, gasLimit);
  const selected: SealedTx[] = [];
  let gas = 0n;
  for (const st of candidates)
    if (takes(selected.length, gas, st, room, cfg)) {
      selected.push(st);
      gas += st.gasLimit;
    }
  return selected;
}
