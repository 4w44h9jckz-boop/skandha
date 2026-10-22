/**
 * ERC-8421's standard alternative mempool: exp-mempool-l2s
 * `docs/spec/14-erc-8421.md`, AM-2 to AM-14.
 *
 * A pool under the ruleset is the frame pool with FP-5, FP-6, FP-7, FP-9,
 * FP-11 and FP-12 replaced (AM-2): a prefix's frames are attributed to
 * entities (AM-3), which have their own budgets (AM-5), trace rules (AM-8)
 * and storage rules (AM-9), and stake and reputation decide how much of the
 * pool each may hold (AM-13). Nothing here runs the EVM; a frame carries what
 * a node's tracer would observe (MD-6). exp-mempool-l2s decision record 0061.
 */
import * as E from "./errors.js";
import { TxError } from "./errors.js";
import { FramePoolConfig } from "./config.js";
import { Deps, depKey } from "./deps.js";
import { admissionGas } from "./matcha.js";
import { Head, State } from "./model.js";
import { Entry, FramePool, isStaked } from "./pool.js";
import {
  BANNED_OPCODES,
  DEPLOY,
  EXPIRY,
  ONLY_VERIFY,
  PAY,
  Prefix,
  RECOGNIZED,
  SELF_VERIFY,
  Simulation,
  analyse,
  checkFp3,
  classify,
  classifyPayer,
  defaultCodeApproves,
} from "./prefix.js";
import {
  APPROVE_PAYMENT,
  APPROVE_SCOPE_MASK,
  ATOMIC_BATCH_FLAG,
  Frame,
  FrameTx,
  Read,
  VERIFY_MODE,
  Write,
  replaces,
  signatureGas,
} from "./tx.js";

export const PRE_VERIFY = "pre_verify"; // AM-4
export const STRAY = "stray";
const APPROVING = new Set([SELF_VERIFY, ONLY_VERIFY, PAY]);
const CREATION = new Set(["CREATE", "CREATE2", "SETDELEGATE"]);
const STAKED_ONLY = new Set(["BALANCE", "SELFBALANCE"]); // OPCODES-010
/** AM-8: EIP-8141's banned list without what OPCODES-020 and CREATION-010 take over. */
const BANNED = new Set(
  [...BANNED_OPCODES].filter((op) => !CREATION.has(op) && op !== "SSTORE")
);

/** A refusal attributed to an entity (AM-14): the address of the frame, or the budget, that failed. */
export class Refusal extends TxError {
  constructor(code: string, readonly entity: string | null) {
    super(code);
  }
}

function fail(code: string, entity: string | null = null): never {
  throw new Refusal(code, entity);
}

const resolved = (frame: Frame, sender: string): string =>
  frame.target !== null ? frame.target : sender;

// --- AM-4: structure -------------------------------------------------------------------

/** FP-3 with SIGNATURE-010 (AM-6), then AM-4's steps 1 to 5: everything decidable without state. */
export function structure(
  tx: FrameTx,
  gasLimit: bigint,
  cfg: FramePoolConfig
): Prefix {
  checkFp3(tx, gasLimit, cfg);
  const kinds0 = tx.frames.map((f) => classify(f, tx.sender, cfg));
  if (kinds0.slice(1).includes(EXPIRY)) fail(E.ErrFrameExpiryNotFirst); // PREFIX-010
  const prefix = analyse(tx, cfg);
  if (prefix === null) fail(E.ErrFrameNoPayer); // PREFIX-010
  if (prefix.frames.some((f) => (f.flags & ATOMIC_BATCH_FLAG) !== 0))
    fail(E.ErrFrameAtomicInPrefix); // PREFIX-040
  const frames = prefix.frames;
  const kinds = [...prefix.kinds];
  const first = kinds[0] === EXPIRY ? 1 : 0;
  kinds.forEach((kind, i) => {
    if (kind !== DEPLOY) return; // FP-5's DEFAULT frame with no approval scope
    if (
      i + 1 < kinds.length &&
      APPROVING.has(kinds[i + 1]) &&
      resolved(frames[i], tx.sender) === resolved(frames[i + 1], tx.sender)
    )
      kinds[i] = PRE_VERIFY;
    else if (i !== first) kinds[i] = STRAY;
  });
  if (kinds.includes(STRAY)) fail(E.ErrFrameStrayDefault); // PREFIX-120
  const shape = kinds.slice(first).filter((k) => k !== PRE_VERIFY);
  if (!RECOGNIZED.has(shape.join(","))) fail(E.ErrFrameUnrecognizedPrefix); // PREFIX-010
  if (prefix.rest.some((f) => f.mode === VERIFY_MODE))
    fail(E.ErrFrameVerifyAfterPrefix); // PREFIX-050
  return { ...prefix, kinds };
}

/** AM-4 step 6 [PREFIX-110]: a pre_verify frame's target has code at the head. */
export function checkPreVerify(
  tx: FrameTx,
  prefix: Prefix,
  state: State
): void {
  prefix.frames.forEach((frame, i) => {
    const target = resolved(frame, tx.sender);
    if (prefix.kinds[i] === PRE_VERIFY && state.code(target) === "")
      fail(E.ErrFramePreVerifyNoCode, target);
  });
}

// --- AM-3 and AM-5: entities, stake and budgets -----------------------------------------

/** AM-3: the roles, the entity each prefix frame is attributed to, and which entities are staked. */
export interface Entities {
  readonly sender: string;
  readonly payer: string;
  readonly factory: string | null;
  readonly ofFrame: readonly (string | null)[];
  readonly staked: ReadonlySet<string>;
  /** Each entity once, in the order sender, payer, factory. */
  readonly addresses: readonly string[];
}

/** AM-3 [STAKING-010]: never a default-code entity. */
/** AM-3. */
export function entities(
  tx: FrameTx,
  prefix: Prefix,
  state: State,
  cfg: FramePoolConfig
): Entities {
  let factory: string | null = null;
  const ofFrame = prefix.frames.map((frame, i) => {
    if (prefix.kinds[i] === EXPIRY) return null;
    const target = resolved(frame, tx.sender); // a pre_verify frame's is the next frame's (AM-4)
    if (prefix.kinds[i] === DEPLOY) factory = target;
    return target;
  });
  const payer = resolved(prefix.frames[prefix.frames.length - 1], tx.sender);
  const addresses: string[] = [];
  for (const a of [tx.sender, payer, factory])
    if (a !== null && !addresses.includes(a)) addresses.push(a);
  return {
    sender: tx.sender,
    payer,
    factory,
    ofFrame,
    staked: new Set(addresses.filter((a) => isStaked(a, state, cfg))),
    addresses,
  };
}

/** AM-5 [BUDGET-010]: exec_gas by entity, the signatures with the sender, the expiry frame with none. */
export function checkBudgets(
  tx: FrameTx,
  prefix: Prefix,
  ent: Entities,
  cfg: FramePoolConfig
): void {
  const sums = new Map(ent.addresses.map((a) => [a, 0n]));
  prefix.frames.forEach((frame, i) => {
    const who = ent.ofFrame[i];
    if (who !== null) sums.set(who, (sums.get(who) as bigint) + frame.execGas);
  });
  sums.set(
    tx.sender,
    (sums.get(tx.sender) as bigint) +
      tx.signatures.map(signatureGas).reduce((a, b) => a + b, 0n)
  );
  for (const a of ent.addresses) {
    const limit = ent.staked.has(a)
      ? cfg.maxVerifyGasStakedEntity
      : cfg.maxVerifyGasPerEntity;
    if ((sums.get(a) as bigint) > limit) fail(E.ErrEntityVerifyGas, a);
  }
}

// --- AM-7 to AM-9: simulation, trace and storage ---------------------------------------

/** FP-10's record, with the entities and every traced storage access as [address, associated]. */
export interface ErcSimulation extends Simulation {
  readonly entities: Entities;
  readonly accesses: readonly [string, string | undefined][];
}

/** AM-8, in its order. */
function trace(
  frame: Frame,
  kind: string,
  who: string | null,
  tx: FrameTx,
  ent: Entities,
  state: State,
  cfg: FramePoolConfig
): void {
  const ops = frame.opcodes;
  if (ops.has("UNASSIGNED")) fail(E.ErrFrameUnassignedOpcode, who); // OPCODES-030
  if (ops.has("OOG_REVERT")) fail(E.ErrFrameOutOfGasRevert, who); // OPCODES-040
  const staked = who !== null && ent.staked.has(who);
  for (const op of ops)
    if (BANNED.has(op) && !(staked && STAKED_ONLY.has(op)))
      fail(E.ErrFrameBannedOpcode, who); // OPCODES-010, OPCODES-020
  if (kind !== DEPLOY && [...ops].some((op) => CREATION.has(op)))
    fail(E.ErrFrameCreation, who); // CREATION-010
  for (const addr of frame.calls) {
    // CALLING-010, CALLING-040
    if (
      addr !== tx.sender &&
      !cfg.precompiles.has(addr) &&
      state.code(addr) === ""
    )
      fail(E.ErrFrameCallTarget, who);
  }
}

/** AM-9: STORAGE-010 to STORAGE-033. */
function allowed(
  access: Read | Write,
  write: boolean,
  who: string | null,
  ent: Entities
): boolean {
  const [addr, , , assoc] = access;
  const outside = !ent.addresses.includes(addr);
  if (addr === ent.sender) return true; // STORAGE-010
  if (
    assoc === ent.sender &&
    outside &&
    (ent.factory === null || ent.staked.has(ent.factory))
  )
    return true; // STORAGE-021, STORAGE-022
  if (who !== null && ent.staked.has(who)) {
    if (addr === who) return true; // STORAGE-031
    if (outside && (!write || assoc === who)) return true; // STORAGE-032, STORAGE-033
  }
  return false;
}

/** AM-7 to AM-9, frame by frame, recording AM-14's dependencies. */
export function run(
  tx: FrameTx,
  prefix: Prefix,
  ent: Entities,
  head: Head,
  state: State,
  cfg: FramePoolConfig,
  expiryMargin = 0
): ErcSimulation {
  const sender = tx.sender;
  const deps = new Deps();
  for (const a of ent.addresses) {
    deps.set(depKey("code", a), state.code(a));
    deps.set(depKey("balance", a), state.balance(a));
    deps.set(depKey("stake", a), state.stake(a).join("|"));
  }
  let senderCode = state.code(sender);
  const written = new Map<string, bigint>(); // what deploy and pre_verify frames wrote, read by later frames
  const accesses: [string, string | undefined][] = [];
  let deadline: bigint | null = null;
  let payer: string | null = null;
  let payerCode = "";
  prefix.frames.forEach((frame, i) => {
    const kind = prefix.kinds[i];
    const who = ent.ofFrame[i];
    if (kind === EXPIRY) {
      // PREFIX-100, evaluated directly as FP-8 does
      const code = state.code(cfg.expiryVerifier);
      deps.set(depKey("code", cfg.expiryVerifier), code);
      if (code !== cfg.expiryVerifierCode) fail(E.ErrFramePrefixReverted);
      deadline = frame.deadline;
      if ((frame.deadline as bigint) < BigInt(head.timestamp + expiryMargin))
        fail(E.ErrFrameExpired); // PREFIX-080
      return;
    }
    const target = resolved(frame, sender);
    const code = target === sender ? senderCode : state.code(target);
    if (code !== "" && code !== cfg.canonicalPaymasterCode) {
      // PREFIX-100 exempts the rest from AM-8 and AM-9
      trace(frame, kind, who, tx, ent, state, cfg);
      if (frame.mode === VERIFY_MODE && frame.writes.length > 0)
        fail(E.ErrFramePrefixReverted, who); // static mode: the write reverts
      const all: [Read | Write, boolean][] = [
        ...frame.reads.map((r): [Read, boolean] => [r, false]),
        ...frame.writes.map((w): [Write, boolean] => [w, true]),
      ];
      for (const [access, write] of all) {
        if (!allowed(access, write, who, ent))
          fail(E.ErrFrameStorageAccess, who); // STORAGE-000
        accesses.push([access[0], access[3]]);
      }
    }
    if (code !== "") {
      // FP-8's outcome; the default code reads nothing
      for (const [addr, slot, expected] of frame.reads) {
        deps.set(depKey("storage", addr, slot), state.storage(addr, slot));
        const value =
          written.get(`${addr}|${slot}`) ?? state.storage(addr, slot);
        if (expected !== null && value !== expected)
          fail(E.ErrFramePrefixReverted, who);
      }
      if (frame.reverts) fail(E.ErrFramePrefixReverted, who); // PREFIX-060
    }
    if (kind === DEPLOY || kind === PRE_VERIFY) {
      if (kind === DEPLOY) {
        // PREFIX-020
        if (code === "" || frame.installsCode === null || senderCode !== "")
          fail(E.ErrFrameDeployNoCode, who);
        senderCode = frame.installsCode;
      }
      for (const [addr, slot, value] of frame.writes)
        written.set(`${addr}|${slot}`, value);
      return;
    }
    const scope = frame.flags & APPROVE_SCOPE_MASK;
    if (code === "") {
      if (!defaultCodeApproves(tx, scope, target))
        fail(E.ErrFramePrefixReverted, who);
    } else if (frame.approves !== scope) fail(E.ErrFrameMissingApprove, who); // PREFIX-060
    if (scope & APPROVE_PAYMENT) {
      if (state.balance(target) < tx.maxCost) fail(E.ErrInsufficientFunds, who); // APPROVE reverts [PREFIX-060]
      payer = target;
      payerCode = code;
    }
  });
  if (payer === null)
    throw new Error("the structure guarantees a payment frame");
  const payerClass = classifyPayer(payer, payerCode, sender, cfg);
  if (payerClass === "canonical")
    deps.set(depKey("withdrawal", payer), state.withdrawal(payer));
  return {
    payer,
    payerClass,
    deps,
    deadline,
    roots: null,
    entities: ent,
    accesses,
  };
}

/** AM-14: what revalidation re-runs, PREFIX-110, AM-3, AM-5 and AM-7 to AM-9 against `state`. */
export function validate(
  tx: FrameTx,
  prefix: Prefix,
  head: Head,
  state: State,
  cfg: FramePoolConfig,
  expiryMargin = 0
): ErcSimulation {
  checkPreVerify(tx, prefix, state);
  const ent = entities(tx, prefix, state, cfg);
  checkBudgets(tx, prefix, ent, cfg);
  return run(tx, prefix, ent, head, state, cfg, expiryMargin);
}

// --- the pool ----------------------------------------------------------------------------

const ents = (e: Entry): Entities => (e.sim as ErcSimulation).entities;

/** A frame pool under ERC-8421's standard ruleset (`config.ruleset === "erc-8421"`). */
export class StandardPool extends FramePool {
  // --- AM-13: reputation, with the counters the frame pool keeps -------------

  /** REPUTATION-220, in integers as written. */
  opsAllowed(addr: string): number {
    const cfg = this.config;
    const [seen, included] = this.counters.get(addr) ?? [0, 0];
    const extra =
      seen > 0
        ? Math.floor(
            (included * Math.min(included, cfg.maxTxsAllowedUnstakedEntity)) /
              seen
          )
        : 0;
    return cfg.sameUnstakedEntityMempoolCount + extra;
  }

  private count(test: (e: Entry) => boolean, replaced: string[]): number {
    let n = 0;
    for (const [h, e] of this.entries)
      if (!replaced.includes(h) && test(e)) n++;
    return n;
  }

  /** AM-13, for each entity in the order sender, payer, factory. */
  private checkReputation(
    tx: FrameTx,
    ent: Entities,
    replaced: string[]
  ): void {
    const cfg = this.config;
    for (const a of ent.addresses) {
      const status = this.stateOf(a);
      if (ent.staked.has(a) || (a === ent.payer && a !== tx.sender)) {
        if (status === "BANNED") throw new TxError(E.ErrEntityBanned); // REPUTATION-010
        if (status === "THROTTLED") {
          // REPUTATION-020
          if (
            this.count((e) => ents(e).addresses.includes(a), replaced) >=
            cfg.throttledEntityMempoolCount
          )
            throw new TxError(E.ErrEntityThrottled);
        } else if (!ent.staked.has(a)) {
          // REPUTATION-220
          if (
            this.count((e) => e.sim.payer === a, replaced) >= this.opsAllowed(a)
          )
            throw new TxError(E.ErrPayerOpsAllowed);
        }
      } else if (a === tx.sender && status === "THROTTLED") {
        // REPUTATION-210
        if (
          this.count((e) => e.tx.sender === a, replaced) >=
          cfg.throttledEntityMempoolCount
        )
          throw new TxError(E.ErrSenderThrottled);
      }
    }
  }

  // --- AM-10 to AM-12 -------------------------------------------------------

  private pendingOf(sender: string, leaveOut: string[] = []): FrameTx[] {
    return (this.bySender.get(sender) ?? [])
      .filter((h) => !leaveOut.includes(h))
      .map((h) => (this.entries.get(h) as Entry).tx);
  }

  /** LIFECYCLE-020: the sender's pending transactions with the same nonce_seq that share a key. */
  private conflicts(tx: FrameTx): string[] {
    return (this.bySender.get(tx.sender) ?? []).filter((h) => {
      const p = (this.entries.get(h) as Entry).tx;
      return (
        p.nonceSeq === tx.nonceSeq &&
        p.nonceKeys.some((k) => tx.nonceKeys.includes(k))
      );
    });
  }

  /** LIFECYCLE-010 against the chain and `pending`: null, or the code that refuses `tx`. */
  private contiguous(tx: FrameTx, pending: FrameTx[]): string | null {
    const chain = tx.nonceKeys.map((k) => this.state.nonceSeq(tx.sender, k));
    if (chain.some((c) => tx.nonceSeq < c)) return E.ErrNonceTooLow;
    for (let i = 0; i < tx.nonceKeys.length; i++) {
      const k = tx.nonceKeys[i];
      if (
        tx.nonceSeq !== chain[i] &&
        !pending.some(
          (p) => p.nonceKeys.includes(k) && p.nonceSeq + 1n === tx.nonceSeq
        )
      )
        return E.ErrNonceGap;
    }
    return null;
  }

  /** AM-12 [SOLVENCY-010, SOLVENCY-020]: not counting the transactions it replaces. */
  private checkSolvency(
    tx: FrameTx,
    sim: Simulation,
    replaced: string[]
  ): void {
    const payer = sim.payer;
    let reserved = this.reserved.get(payer) ?? 0n;
    for (const h of replaced) {
      const e = this.entries.get(h) as Entry;
      if (e.sim.payer === payer) reserved -= e.tx.maxCost;
    }
    const withdrawal =
      sim.payerClass === "canonical" ? this.state.withdrawal(payer) : 0n;
    if (this.state.balance(payer) - reserved - withdrawal < tx.maxCost)
      throw new TxError(E.ErrFramePayerExposure);
  }

  /** FP-15 step 4 under the ruleset: AM-12's exposure, with no cap of FP-11's kind. */
  protected checkPayer(
    tx: FrameTx,
    payer: string,
    payerClass: string,
    old: Entry | null
  ): void {
    let reserved = this.reserved.get(payer) ?? 0n;
    if (old !== null && old.sim.payer === payer) reserved -= old.tx.maxCost;
    const withdrawal =
      payerClass === "canonical" ? this.state.withdrawal(payer) : 0n;
    if (this.state.balance(payer) - reserved - withdrawal < tx.maxCost)
      throw new TxError(E.ErrFramePayerExposure);
  }

  /** AM-11 [LOCAL-010, LOCAL-020]. */
  private checkLocal(
    tx: FrameTx,
    sim: ErcSimulation,
    replaced: string[]
  ): void {
    const ent = sim.entities;
    const senders = new Set(
      [...this.entries]
        .filter(([h]) => !replaced.includes(h))
        .map(([, e]) => e.tx.sender)
    );
    for (const a of [ent.factory, ent.payer])
      if (a !== null && a !== tx.sender && senders.has(a))
        throw new TxError(E.ErrEntityIsSender);
    const mine = new Set([tx.sender, ...ent.staked]);
    if (
      sim.accesses.some(
        ([addr, assoc]) =>
          assoc !== undefined && mine.has(assoc) && senders.has(addr)
      )
    )
      throw new TxError(E.ErrLocalStorage);
  }

  /** AM-10 [LIFECYCLE-030]: not counting the transactions it replaces. */
  private checkLimits(tx: FrameTx, ent: Entities, replaced: string[]): void {
    const cfg = this.config;
    const pending = this.pendingOf(tx.sender, replaced);
    for (const k of tx.nonceKeys)
      if (
        pending.filter((p) => p.nonceKeys.includes(k)).length >=
        cfg.sameNonceKeyMempoolCount
      )
        throw new TxError(E.ErrNonceKeyLimit);
    if (
      !ent.staked.has(tx.sender) &&
      pending.length >= cfg.sameSenderMempoolCount
    )
      throw new TxError(E.ErrSenderLimit);
  }

  /**
   * LIFECYCLE-020 and AM-14: remove, in the order received, every pending
   * transaction of `senders` that no longer meets LIFECYCLE-010, until none is left.
   */
  private evictGaps(senders: Iterable<string>): void {
    for (const sender of senders) {
      let changed = true;
      while (changed && this.bySender.has(sender)) {
        changed = false;
        for (const h of [...(this.bySender.get(sender) as string[])]) {
          const tx = (this.entries.get(h) as Entry).tx;
          if (this.contiguous(tx, this.pendingOf(sender, [h])) !== null) {
            this.remove(h, "gap");
            changed = true;
            break;
          }
        }
      }
    }
  }

  // --- admission (AM-2) -----------------------------------------------------

  protected addOne(tx: FrameTx, now: number): string {
    try {
      const cfg = this.config;
      if (this.entries.has(tx.hash)) throw new TxError(E.ErrAlreadyKnown); // FP-2
      const prefix = structure(tx, this.head.gasLimit, cfg); // FP-3 with AM-6, AM-4 steps 1 to 5
      checkPreVerify(tx, prefix, this.state); // AM-4 step 6
      const replaced = this.conflicts(tx);
      const ent = entities(tx, prefix, this.state, cfg); // AM-3
      this.checkReputation(tx, ent, replaced); // AM-13
      checkBudgets(tx, prefix, ent, cfg); // AM-5
      this.addWork(tx.sender, admissionGas(tx, prefix));
      const sim = run(
        tx,
        prefix,
        ent,
        this.head,
        this.state,
        cfg,
        cfg.expiryMargin
      ); // AM-7 to AM-9
      this.checkSolvency(tx, sim, replaced); // AM-12
      this.checkLocal(tx, sim, replaced); // AM-11
      const code = this.contiguous(tx, this.pendingOf(tx.sender, replaced));
      if (code !== null) throw new TxError(code); // AM-10 [LIFECYCLE-010]
      this.checkLimits(tx, ent, replaced); // AM-10 [LIFECYCLE-030]
      if (
        replaced.some(
          (h) => !replaces((this.entries.get(h) as Entry).tx, tx, cfg.priceBump)
        )
      )
        throw new TxError(E.ErrReplaceUnderpriced); // LIFECYCLE-020
      if (this.reserver.heldByOther(tx.sender, this))
        throw new TxError(E.ErrAlreadyReserved); // FP-13
      const seq = this.sequence();
      const gapped = replaced.length > 0 ? [tx.sender] : [];
      if (replaced.length === 0 && this.entries.size >= cfg.maxPending) {
        // FP-14
        const victim = this.victim(tx, seq, sim.deadline);
        if (victim === null) throw new TxError(E.ErrTxPoolOverflow);
        gapped.push((this.entries.get(victim) as Entry).tx.sender);
        this.remove(victim, "capacity");
      }
      const before = new Set(
        replaced.flatMap((h) => ents(this.entries.get(h) as Entry).addresses)
      );
      for (const h of replaced) this.remove(h, "replaced", false);
      this.insert({
        tx,
        seq,
        prefix,
        sim,
        admitted: now,
        charge: 0n,
        reads: new Set(),
        cls: new Set(),
      });
      for (const a of ent.addresses) if (!before.has(a)) this.bump(a, +1); // AM-13 [REPUTATION-040]
      for (const a of [...before].sort())
        if (!ent.addresses.includes(a)) this.bump(a, -1);
      this.evictGaps(gapped); // AM-10
      return E.OK;
    } catch (err) {
      if (err instanceof TxError) return err.code;
      throw err;
    }
  }

  // --- revalidation (AM-14) -------------------------------------------------

  protected simulate(
    tx: FrameTx,
    prefix: Prefix,
    head: Head,
    state: State
  ): Simulation {
    return validate(
      tx,
      prefix,
      head,
      state,
      this.config,
      this.config.expiryMargin
    );
  }

  /**
   * AM-14: the blamed entity keeps its `seen`, every other loses one, except a
   * staked factory when the sender is blamed [REPUTATION-320] and a staked
   * sender [REPUTATION-330].
   */
  protected invalidated(txHash: string, err: TxError): void {
    const ent = ents(this.entries.get(txHash) as Entry);
    const blamed = err instanceof Refusal ? err.entity : null;
    for (const a of ent.addresses) {
      if (
        a === blamed ||
        (a === ent.sender && ent.staked.has(a)) ||
        (a === ent.factory && ent.staked.has(a) && blamed === ent.sender)
      )
        continue;
      this.bump(a, -1);
    }
    super.invalidated(txHash, err);
  }

  protected remove(
    txHash: string,
    reason: string,
    release = true,
    account = true
  ): void {
    if (reason === "stale_nonce")
      // FP-15 step 1, read as inclusion (AM-13)
      for (const a of ents(this.entries.get(txHash) as Entry).addresses)
        this.bump(a, 0, +1);
    super.remove(txHash, reason, release, account);
  }

  /**
   * FP-15 with AM-14's dependencies and blame, then REPUTATION-010's removal
   * of what refers to a banned entity, then LIFECYCLE-010's of what has a gap.
   */
  reset(
    head: Head,
    state: State,
    now = 0,
    verdicts: ReadonlyMap<string, string> = new Map()
  ): void {
    const senders = new Map(
      [...this.entries].map(([h, e]) => [h, e.tx.sender])
    );
    super.reset(head, state, now, verdicts);
    for (const [h, e] of [...this.entries]) {
      const ent = ents(e);
      if (
        ent.addresses.some(
          (a) =>
            (ent.staked.has(a) || (a === ent.payer && a !== ent.sender)) &&
            this.stateOf(a) === "BANNED"
        )
      )
        this.remove(h, "banned");
    }
    this.evictGaps(
      [
        ...new Set(
          [...senders].filter(([h]) => !this.entries.has(h)).map(([, s]) => s)
        ),
      ].sort()
    );
  }
}
