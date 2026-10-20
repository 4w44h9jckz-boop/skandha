/**
 * The key round of EIP-8184 (LUCID): exp-mempool-l2s `docs/spec/06-lucid.md`,
 * LU-14 to LU-19, and exp-mempool-l2s decision record 0070.
 *
 * Between the block that commits sealed transactions and the block that runs
 * them: the commitments, a key message's validity, when a key publisher may
 * release (the key-publisher role), a committee member's vote, the next
 * slot's tally, and what the record says of a key the tally finds missing.
 *
 * Everything here reads tickets, the block, key messages, times and votes.
 * The one step that reads a ciphertext, LU-15's step 6, goes through a
 * `Decrypt` function, so a caller sees which ciphertexts were read and when.
 */
import { keccak256 } from "./keccak.js";
import { SealedPoolConfig, SealedTx, tobGasLimit } from "./sealed.js";

export type KeyReason =
  | "chain"
  | "block"
  | "index"
  | "length"
  | "key"
  | "decrypt"
  | "valid";
export type Treatment = "missing" | "observed";
export type MissingKey = "undecryptable" | "late" | "withheld" | "unvoted";

/** LU-14: one entry of the bid's `st_commitments`, for a standalone sealed transaction. */
export interface STCommitment {
  readonly root: string; // commitment_root, the ticket's hash
  readonly key: Uint8Array; // commitment_key
  readonly gasObligation: bigint;
  readonly executable: readonly number[];
}

/** A block that carries commitments, named by its root and slot (LU-14). */
export class SchedulingBlock {
  constructor(
    readonly root: string,
    readonly slot: number,
    readonly sealed: readonly SealedTx[], // LU-12's commitments, in commitment order
    readonly gasLimit: bigint = 30_000_000n,
    readonly attested: boolean = true
  ) {}

  /** LU-14: read from each ticket alone. */
  commitments(): STCommitment[] {
    return this.sealed.map((st) => ({
      root: st.hash,
      key: st.commitmentKey,
      gasObligation: st.gasLimit,
      executable: [],
    }));
  }
}

/** LU-15: a `LucidKeyMessage`. */
export interface KeyMessage {
  readonly chainId: bigint;
  readonly root: string;
  readonly slot: number;
  readonly commitIndex: number;
  readonly kDems: readonly Uint8Array[];
}

export type Decrypt = (
  block: SchedulingBlock,
  j: number,
  kDem: Uint8Array
) => boolean;

/** LU-15 step 6 in the model: whether commitment j's ciphertext decrypts under the key. */
export const readDecrypts: Decrypt = (block, j) =>
  block.sealed[j].decrypts !== false;

/** The scheduling blocks a node holds, by root and slot. */
export class Blocks {
  private byName = new Map<string, SchedulingBlock>();

  constructor(blocks: Iterable<SchedulingBlock>, readonly chainId = 1n) {
    for (const b of blocks) this.byName.set(`${b.root}/${b.slot}`, b);
  }

  get(root: string, slot: number): SchedulingBlock | undefined {
    return this.byName.get(`${root}/${slot}`);
  }
}

const equal = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** LU-15 steps 1 to 5: the reason a message is refused, or null. Reads no ciphertext. */
export function publicCheck(msg: KeyMessage, blocks: Blocks): KeyReason | null {
  if (msg.chainId !== blocks.chainId) return "chain";
  const block = blocks.get(msg.root, msg.slot);
  if (block === undefined) return "block";
  if (!(msg.commitIndex >= 0 && msg.commitIndex < block.sealed.length))
    return "index";
  if (msg.kDems.length !== 1) return "length";
  if (
    !equal(keccak256(msg.kDems[0]), block.sealed[msg.commitIndex].commitmentKey)
  )
    return "key";
  return null;
}

/** LU-15: `valid`, or the first check that applies. */
export function checkKeyMessage(
  msg: KeyMessage,
  blocks: Blocks,
  decrypt: Decrypt = readDecrypts
): KeyReason {
  const reason = publicCheck(msg, blocks);
  if (reason !== null) return reason;
  const block = blocks.get(msg.root, msg.slot) as SchedulingBlock;
  return decrypt(block, msg.commitIndex, msg.kDems[0]) ? "valid" : "decrypt";
}

/** LU-16: the indices of the commitments whose key `publisher` may release. */
export function mayRelease(
  block: SchedulingBlock,
  publisher: string,
  cfg: SealedPoolConfig,
  observed = true
): number[] {
  if (!observed || !block.attested) return [];
  const obligations = block.sealed.reduce((g, st) => g + st.gasLimit, 0n);
  if (obligations > tobGasLimit(cfg, block.gasLimit)) return [];
  return block.sealed.flatMap((st, j) =>
    (publisher === st.keyPublisher || publisher === st.sender) &&
    j <= st.maxPreceding
      ? [j]
      : []
  );
}

/**
 * The key-publisher role (LU-16): the key messages `publisher` may release
 * for a block it has observed, in commitment order. A publisher that
 * withholds simply does not send what this returns.
 */
export function release(
  block: SchedulingBlock,
  publisher: string,
  cfg: SealedPoolConfig,
  chainId = 1n,
  observed = true
): KeyMessage[] {
  return mayRelease(block, publisher, cfg, observed).map((j) => ({
    chainId,
    root: block.root,
    slot: block.slot,
    commitIndex: j,
    kDems: [block.sealed[j].demKey],
  }));
}

/**
 * LU-17: `keys_observed` from the messages received, each with the time it
 * arrived. A message after the deadline is not checked, nor one for a bit
 * already set, so `decrypt` is asked only about a key received in time that
 * passed LU-15's public checks.
 */
export function vote(
  block: SchedulingBlock,
  blocks: Blocks,
  received: readonly (readonly [KeyMessage, number])[],
  deadline: number,
  decrypt: Decrypt = readDecrypts
): number[] {
  const bits = block.sealed.map(() => 0);
  const inOrder = received
    .map((r, i) => [r, i] as const)
    .sort((x, y) => x[0][1] - y[0][1] || x[1] - y[1]);
  for (const [[msg, at]] of inOrder) {
    if (at > deadline || msg.root !== block.root || msg.slot !== block.slot)
      continue;
    if (bits[msg.commitIndex] === 1) continue;
    if (checkKeyMessage(msg, blocks, decrypt) === "valid")
      bits[msg.commitIndex] = 1;
  }
  return bits;
}

/** LU-18 for one key. */
export class Counts {
  constructor(
    readonly t1 = 0,
    readonly t0 = 0,
    readonly l1 = 0,
    readonly l0 = 0,
    readonly e = 0
  ) {}

  /** The treatments the two conditions allow, sorted; at least one holds. */
  allowed(): Treatment[] {
    const { t1, t0, l1, l0, e } = this;
    const out: Treatment[] = [];
    if (2 * t1 <= t1 + t0 + l0 + e) out.push("missing");
    if (2 * (t1 + l1 + e) > t1 + t0 + l1 + e) out.push("observed");
    return out;
  }
}

/** LU-18: the counts for each of `n` commitments from the votes received, each `[member, bits, at]`. */
export function tally(
  n: number,
  ptc: Iterable<string>,
  voteDeadline: number,
  attestation: number,
  votes: readonly (readonly [string, readonly number[], number])[]
): Counts[] {
  const members = new Set(ptc);
  const first = new Map<string, [readonly number[], number]>();
  const equivocated = new Set<string>();
  const inOrder = votes
    .map((v, i) => [v, i] as const)
    .sort((x, y) => x[0][2] - y[0][2] || x[1] - y[1]);
  for (const [[member, bits, at]] of inOrder) {
    if (!members.has(member) || at > attestation || bits.length !== n) continue;
    const seen = first.get(member);
    if (seen === undefined) first.set(member, [bits, at]);
    else if (seen[0].some((b, i) => b !== bits[i])) equivocated.add(member);
  }
  const counts: Counts[] = [];
  for (let j = 0; j < n; j++) {
    let t1 = 0;
    let t0 = 0;
    let l1 = 0;
    let l0 = 0;
    for (const [member, [bits, at]] of first) {
      if (equivocated.has(member)) continue;
      const timely = at <= voteDeadline;
      if (bits[j] === 1 && timely) t1++;
      else if (bits[j] === 1) l1++;
      else if (timely) t0++;
      else l0++;
    }
    counts.push(new Counts(t1, t0, l1, l0, equivocated.size));
  }
  return counts;
}

/** LU-19: a builder here treats a key as observed wherever the tally allows it. */
export function treat(allowed: readonly Treatment[]): Treatment {
  return allowed.includes("observed") ? "observed" : "missing";
}

/** LU-19: the indices revealed, and for each key treated as missing what the record says of it. */
export function blame(
  block: SchedulingBlock,
  blocks: Blocks,
  counts: readonly Counts[],
  received: readonly (readonly [KeyMessage, number])[],
  deadline: number,
  decrypt: Decrypt = readDecrypts
): { revealed: number[]; missing: Map<number, MissingKey> } {
  const revealed: number[] = [];
  const missing = new Map<number, MissingKey>();
  counts.forEach((c, j) => {
    const passing = received.filter(
      ([m]) =>
        m.root === block.root &&
        m.slot === block.slot &&
        m.commitIndex === j &&
        publicCheck(m, blocks) === null
    );
    const inTime = passing.filter(([, at]) => at <= deadline);
    if (treat(c.allowed()) === "observed") {
      if (decrypt(block, j, block.sealed[j].demKey)) revealed.push(j);
      return;
    }
    if (inTime.length > 0 && !decrypt(block, j, inTime[0][0].kDems[0]))
      missing.set(j, "undecryptable");
    else if (inTime.length === 0)
      missing.set(j, passing.length > 0 ? "late" : "withheld");
    else missing.set(j, "unvoted");
  });
  return { revealed, missing };
}
