/**
 * The validation prefix: static checks and simulation, exp-mempool-l2s
 * `docs/spec/02-frame-pool.md` FP-3 to FP-10, with the dependency frames of
 * `05-aggregation.md` (AG-2 to AG-4), the recent root verifier frame of
 * `08-recent-roots.md` (RR-4, RR-5) and the expiring nonces of
 * `09-expiring-nonces.md` (EN-3 to EN-5) under a profile that admits them.
 *
 * Nothing here runs the EVM. A frame carries what a node simulating it would
 * observe (MD-6), and these functions apply the EIP-8141 rules to those
 * observations (exp-mempool-l2s decision record 0003).
 */
import * as E from "./errors.js";
import { TxError } from "./errors.js";
import * as recentroots from "./recentroots.js";
import { checkFrame, checkLimits } from "./dependencies.js";
import { FramePoolConfig } from "./config.js";
import { Deps, depKey } from "./deps.js";
import { Head, State, isDelegation } from "./model.js";
import {
  APPROVE_EXECUTION,
  APPROVE_PAYMENT,
  APPROVE_SCOPE_MASK,
  ATOMIC_BATCH_FLAG,
  DEFAULT_MODE,
  DEP_VERIFY_MODE,
  Frame,
  FrameTx,
  MAX_FRAMES,
  SENDER_MODE,
  SIGNATURE_GAS,
  TX_MAX_GAS_LIMIT,
  VERIFY_MODE,
  signatureGas,
} from "./tx.js";

export const EXPIRY = "expiry_verify";
export const DEPLOY = "deploy";
export const SELF_VERIFY = "self_verify";
export const ONLY_VERIFY = "only_verify";
export const PAY = "pay";
export const OTHER = "other";
export const ROOT = "recent_root_verify"; // RR-4

export const RECOGNIZED: ReadonlySet<string> = new Set(
  [
    [SELF_VERIFY],
    [DEPLOY, SELF_VERIFY],
    [ONLY_VERIFY, PAY],
    [DEPLOY, ONLY_VERIFY, PAY],
  ].map((shape) => shape.join(","))
);

export const BANNED_OPCODES: ReadonlySet<string> = new Set([
  "GASPRICE",
  "BLOCKHASH",
  "COINBASE",
  "TIMESTAMP",
  "NUMBER",
  "PREVRANDAO",
  "GASLIMIT",
  "BASEFEE",
  "BLOBBASEFEE",
  "SLOTNUM",
  "GAS",
  "INVALID",
  "SELFDESTRUCT",
  "BALANCE",
  "SELFBALANCE",
  "CREATE",
  "CREATE2",
  "SETDELEGATE",
  "SSTORE",
]);
export const ALLOWED_IN_DEPLOY: ReadonlySet<string> = new Set([
  "CREATE",
  "CREATE2",
  "SETDELEGATE",
  "SSTORE",
]);

function fail(code: string): never {
  throw new TxError(code);
}

const sum = (xs: readonly bigint[]): bigint => xs.reduce((a, b) => a + b, 0n);

/**
 * FP-4: the prefix's length, the classification (FP-5) of its frames, its
 * frames and those after it. The frames are the transaction's without its
 * dependency frames (AG-3), so `length` counts those the prefix runs.
 */
export interface Prefix {
  readonly length: number;
  readonly kinds: readonly string[];
  readonly frames: readonly Frame[];
  readonly rest: readonly Frame[];
}

/** FP-10: who pays, in which class, and what the prefix depends on. */
export interface Simulation {
  readonly payer: string;
  readonly payerClass: string;
  readonly deps: Deps;
  readonly deadline: bigint | null;
  readonly roots: readonly [number, number] | null; // RR-6: the oldest and newest slot referenced
  readonly verdict?: string | null; // FP-10: the client's verdict it was judged by, a dependency of its own
}

/** FP-5's frame classes, with RR-4's. */
export function classify(
  frame: Frame,
  sender: string,
  cfg: FramePoolConfig
): string {
  if (frame.mode === VERIFY_MODE && frame.target === cfg.expiryVerifier)
    return EXPIRY;
  if (cfg.recentRoots && recentroots.isVerifier(frame, cfg)) return ROOT;
  if (frame.mode === DEFAULT_MODE && (frame.flags & APPROVE_SCOPE_MASK) === 0)
    return DEPLOY;
  if (
    frame.mode === VERIFY_MODE &&
    (frame.target === null || frame.target === sender)
  ) {
    if (frame.flags === 0x3) return SELF_VERIFY;
    if (frame.flags === 0x2) return ONLY_VERIFY;
  }
  if (frame.mode === VERIFY_MODE && frame.flags === 0x1) return PAY;
  return OTHER;
}

/** AG-3: the frames FP-4 to FP-6 see, which are all of them unless the profile admits dependency frames. */
export function executed(tx: FrameTx, cfg: FramePoolConfig): readonly Frame[] {
  if (!cfg.dependencyFrames) return tx.frames;
  return tx.frames.filter((f) => f.mode !== DEP_VERIFY_MODE);
}

/** FP-4: the frames up to and including the first that carries APPROVE_PAYMENT. */
export function analyse(tx: FrameTx, cfg: FramePoolConfig): Prefix | null {
  const frames = executed(tx, cfg);
  const i = frames.findIndex((f) => (f.flags & APPROVE_PAYMENT) !== 0);
  if (i < 0) return null;
  const prefixFrames = frames.slice(0, i + 1);
  return {
    length: i + 1,
    kinds: prefixFrames.map((f) => classify(f, tx.sender, cfg)),
    frames: prefixFrames,
    rest: frames.slice(i + 1),
  };
}

/** FP-3: the EIP's static constraints, with EN-3's and AG-2's under a profile that admits them. */
export function checkFp3(
  tx: FrameTx,
  gasLimit: bigint,
  cfg: FramePoolConfig
): void {
  const frames = tx.frames;
  const sender = tx.sender;
  if (frames.length < 1 || frames.length > MAX_FRAMES)
    fail(E.ErrFrameMalformed);
  const keys = tx.nonceKeys;
  if (
    keys.length === 0 ||
    keys.some((k) => k < 0n) ||
    keys.some((k, i) => i > 0 && keys[i - 1] >= k)
  ) {
    fail(E.ErrFrameMalformed);
  }
  if (tx.nonceSeq < 0n || tx.nonceSeq >= 2n ** 64n) fail(E.ErrFrameMalformed);
  if (
    cfg.expiring &&
    keys.includes(cfg.expiringKey) &&
    (keys.length > 1 || tx.nonceSeq !== 0n)
  ) {
    fail(E.ErrFrameMalformed); // EN-3
  }
  let expiryFrames = 0;
  frames.forEach((f, i) => {
    if (f.mode === DEP_VERIFY_MODE && cfg.dependencyFrames) {
      checkFrame(f, cfg.maxDependenciesPerFrame); // AG-2 in place of the rules below
      return;
    }
    if (
      ![DEFAULT_MODE, VERIFY_MODE, SENDER_MODE].includes(f.mode) ||
      f.flags < 0 ||
      f.flags >= 8
    ) {
      fail(E.ErrFrameMalformed);
    }
    if (
      f.value < 0n ||
      f.execGas < 0n ||
      f.stateGas < 0n ||
      (f.value !== 0n && f.mode !== SENDER_MODE)
    ) {
      fail(E.ErrFrameMalformed);
    }
    if (f.flags & APPROVE_EXECUTION && f.target !== null && f.target !== sender)
      fail(E.ErrFrameMalformed);
    if (f.flags & ATOMIC_BATCH_FLAG) {
      if (
        f.mode === VERIFY_MODE ||
        i + 1 >= frames.length ||
        frames[i + 1].mode === VERIFY_MODE
      ) {
        fail(E.ErrFrameMalformed);
      }
    }
    const inBatch =
      (f.flags & ATOMIC_BATCH_FLAG) !== 0 ||
      (i > 0 && (frames[i - 1].flags & ATOMIC_BATCH_FLAG) !== 0);
    if (inBatch && (f.flags & APPROVE_SCOPE_MASK) !== 0)
      fail(E.ErrFrameMalformed);
    if (f.mode === VERIFY_MODE && f.target === cfg.expiryVerifier) {
      expiryFrames += 1;
      if (
        f.flags !== 0 ||
        f.value !== 0n ||
        f.stateGas !== 0n ||
        f.dataSize !== 8 ||
        f.deadline === null
      ) {
        fail(E.ErrFrameMalformed);
      }
    }
  });
  if (
    expiryFrames > 1 ||
    tx.signatures.some((s) => !(s.scheme in SIGNATURE_GAS))
  )
    fail(E.ErrFrameMalformed);
  const gas = tx.gas;
  const standard = gas.intrinsic + sum(frames.map((f) => f.execGas));
  if ((standard > gas.floor ? standard : gas.floor) > TX_MAX_GAS_LIMIT)
    fail(E.ErrGasLimitTooHigh);
  if (tx.signatures.some((s) => !s.valid)) fail(E.ErrInvalidSender);
  if (tx.tip > tx.maxFee) fail(E.ErrTipAboveFeeCap);
  if (tx.tip < cfg.priceLimit) fail(E.ErrTxGasPriceTooLow);
  if (gas.maxGas > gasLimit) fail(E.ErrGasLimit);
}

/** FP-3, FP-5 and FP-6: everything decidable without state. */
export function checkStatic(
  tx: FrameTx,
  head: Head,
  cfg: FramePoolConfig
): Prefix {
  const sender = tx.sender;
  checkFp3(tx, head.gasLimit, cfg);

  // AG-4: limits per transaction
  if (cfg.dependencyFrames)
    checkLimits(tx, cfg.maxSigsPerTx, cfg.maxStarksPerTx);

  // FP-5: structure, over the frames AG-3 leaves
  const kinds = executed(tx, cfg).map((f) => classify(f, sender, cfg));
  if (kinds.slice(1).includes(EXPIRY)) fail(E.ErrFrameExpiryNotFirst);
  const roots = kinds.flatMap((k, i) => (k === ROOT ? [i] : [])); // RR-4: at most one, first after an expiry frame
  if (
    roots.length > 1 ||
    (roots.length === 1 && roots[0] !== (kinds[0] === EXPIRY ? 1 : 0))
  ) {
    fail(E.ErrFrameRootPosition);
  }
  const prefix = analyse(tx, cfg);
  if (prefix === null) fail(E.ErrFrameNoPayer);
  if (prefix.frames.some((f) => (f.flags & ATOMIC_BATCH_FLAG) !== 0))
    fail(E.ErrFrameAtomicInPrefix);
  let shape = prefix.kinds[0] === EXPIRY ? prefix.kinds.slice(1) : prefix.kinds;
  if (shape[0] === ROOT) shape = shape.slice(1); // RR-4
  if (!RECOGNIZED.has(shape.join(","))) fail(E.ErrFrameUnrecognizedPrefix);
  if (prefix.rest.some((f) => f.mode === VERIFY_MODE))
    fail(E.ErrFrameVerifyAfterPrefix);

  // FP-6: budgets
  const verifyGas =
    sum(prefix.frames.map((f) => f.execGas)) +
    sum(tx.signatures.map(signatureGas));
  if (verifyGas > cfg.maxVerifyGas) fail(E.ErrFrameVerifyGas);
  if (
    cfg.maxVerifyStateGas !== null &&
    sum(prefix.frames.map((f) => f.stateGas)) > cfg.maxVerifyStateGas
  ) {
    fail(E.ErrFrameVerifyStateGas);
  }
  return prefix;
}

/** FP-9, in the order the clause lists the rules. */
export function checkTrace(
  frame: Frame,
  sender: string,
  deploy: boolean,
  state: State,
  cfg: FramePoolConfig
): void {
  for (const op of frame.opcodes) {
    if (BANNED_OPCODES.has(op) && !(deploy && ALLOWED_IN_DEPLOY.has(op)))
      fail(E.ErrFrameBannedOpcode);
  }
  for (const [addr] of frame.writes) {
    if (!(deploy && addr === sender)) fail(E.ErrFrameStateWrite);
  }
  for (const [addr] of frame.reads) {
    if (addr !== sender) fail(E.ErrFrameStorageReadNonSender);
  }
  for (const addr of frame.calls) {
    if (addr === sender || cfg.precompiles.has(addr)) continue;
    const code = state.code(addr);
    if (code === "" || isDelegation(code)) fail(E.ErrFrameCallTarget);
  }
}

/** FP-8: the default code's signature lookup (EIP-8141, Default code). */
export function defaultCodeApproves(
  tx: FrameTx,
  scope: number,
  target: string
): boolean {
  const index = scope & APPROVE_EXECUTION ? 0 : 1;
  if (index >= tx.signatures.length) return false;
  const sig = tx.signatures[index];
  const signer = sig.signer !== null ? sig.signer : tx.sender;
  return (
    sig.scheme === "secp256k1" &&
    sig.valid &&
    sig.canonicalMsg &&
    signer === target
  );
}

/** EN-3: whether `tx` is in expiring-nonce mode. */
export function expiring(tx: FrameTx, cfg: FramePoolConfig): boolean {
  return (
    cfg.expiring &&
    tx.nonceKeys.length === 1 &&
    tx.nonceKeys[0] === cfg.expiringKey
  );
}

/** EN-2: the storage slot at `nonce_ring` that holds seen(h), the hash read as an integer. */
export function seenSlot(txHash: string): bigint {
  return BigInt(txHash);
}

/** EN-4, in FP-7's place, with `now` the pool's head timestamp plus its margin, or a block's timestamp. */
export function checkExpiring(
  tx: FrameTx,
  prefix: Prefix,
  state: State,
  cfg: FramePoolConfig,
  now: number
): void {
  const i = prefix.kinds.indexOf(EXPIRY);
  if (i < 0) fail(E.ErrFrameExpiryMissing);
  const d = prefix.frames[i].deadline as bigint;
  if (d < BigInt(now)) fail(E.ErrFrameExpired);
  if (d > BigInt(now + cfg.maxExpirySecs)) fail(E.ErrFrameExpiryTooFar);
  if (state.storage(cfg.nonceRing, seenSlot(tx.hash)) >= BigInt(now))
    fail(E.ErrNonceTooLow);
}

/** FP-7: exact nonce sequences; returns the sender's sequence for each key. */
export function checkNonce(tx: FrameTx, state: State): bigint[] {
  const seqs = tx.nonceKeys.map((k) => state.nonceSeq(tx.sender, k));
  if (seqs.some((s) => s > tx.nonceSeq)) fail(E.ErrNonceTooLow);
  if (seqs.some((s) => s < tx.nonceSeq)) fail(E.ErrNonceTooHigh);
  return seqs;
}

/** FP-10: the payer's class, from its code. */
export function classifyPayer(
  payer: string,
  code: string,
  sender: string,
  cfg: FramePoolConfig
): string {
  if (payer === sender) return "sender";
  if (code === cfg.canonicalPaymasterCode) return "canonical";
  if (code === "") return "default";
  return "noncanonical";
}

/**
 * Admission under `staticFirst`: the payer and class FP-10 gives, read from
 * the prefix's shape. The payer is the resolved target of the prefix's last
 * frame, the one with APPROVE_PAYMENT (FP-4). No prefix frame installs code
 * anywhere but at `sender`, whose class is `sender` whatever its code.
 */
export function staticPayer(
  tx: FrameTx,
  prefix: Prefix,
  state: State,
  cfg: FramePoolConfig
): [string, string] {
  const last = prefix.frames[prefix.frames.length - 1];
  const payer = last.target !== null ? last.target : tx.sender;
  return [payer, classifyPayer(payer, state.code(payer), tx.sender, cfg)];
}

/**
 * FP-8 and FP-9 through a client's verdict, then FP-8's payment check and
 * FP-10. The verdict stands for every prefix frame, so no observation is read;
 * the payer is the one the prefix's shape names, as under `static_first`; the
 * slots the prefix read are unknown, and the verdict is recorded in their place.
 */
function byVerdict(
  tx: FrameTx,
  prefix: Prefix,
  state: State,
  cfg: FramePoolConfig,
  deps: Deps
): Simulation {
  let deadline: bigint | null = null;
  let roots: [number, number] | null = null;
  for (let i = 0; i < prefix.frames.length; i++) {
    if (prefix.kinds[i] === EXPIRY) {
      deps.set(
        depKey("code", cfg.expiryVerifier),
        state.code(cfg.expiryVerifier)
      );
      deadline = prefix.frames[i].deadline;
    } else if (prefix.kinds[i] === ROOT) {
      // RR-6: the tuples' slots, read from the transaction, for RR-7
      const slots = prefix.frames[i].roots.map(([, slot]) => slot);
      roots = [Math.min(...slots), Math.max(...slots)];
    }
  }
  if (tx.verdict !== E.OK) fail(tx.verdict as string);
  const [payer, payerClass] = staticPayer(tx, prefix, state, cfg);
  if (state.balance(payer) < tx.maxCost) fail(E.ErrInsufficientFunds);
  deps.set(depKey("balance", payer), state.balance(payer));
  deps.set(depKey("code", payer), state.code(payer));
  if (payerClass === "canonical")
    deps.set(depKey("withdrawal", payer), state.withdrawal(payer));
  return {
    payer,
    payerClass,
    deps,
    deadline,
    roots,
    verdict: tx.verdict,
  };
}

/**
 * FP-7 to FP-10, with RR-5. A pool passes its `expiryMargin` (FP-8), its
 * current slot, which is its head's plus one, and its `rootMargin` (RR-2,
 * RR-5); a block being built passes none, and its own slot is the current
 * one (RR-8).
 */
export function simulate(
  tx: FrameTx,
  prefix: Prefix,
  head: Head,
  state: State,
  cfg: FramePoolConfig,
  expiryMargin = 0,
  slot: number | null = null,
  rootMargin = 0
): Simulation {
  const sender = tx.sender;
  const mode = expiring(tx, cfg);
  const deps = new Deps();
  if (mode) {
    // EN-4 in place of FP-7; seen(h) is a dependency, so a pool looks again when it changes (EN-6)
    checkExpiring(tx, prefix, state, cfg, head.timestamp + expiryMargin);
    const seen = seenSlot(tx.hash);
    deps.set(
      depKey("storage", cfg.nonceRing, seen),
      state.storage(cfg.nonceRing, seen)
    );
  } else {
    const seqs = checkNonce(tx, state); // FP-7
    tx.nonceKeys.forEach((k, i) =>
      deps.set(depKey("nonce_seq", sender, k), seqs[i])
    );
  }
  deps.set(depKey("code", sender), state.code(sender));
  deps.set(depKey("balance", sender), state.balance(sender));
  if (tx.verdict !== null) return byVerdict(tx, prefix, state, cfg, deps);

  // FP-8: the prefix, frame by frame
  let senderCode = state.code(sender);
  const deployedStorage = new Map<bigint, bigint>();
  let deadline: bigint | null = null;
  let roots: [number, number] | null = null;
  let payer: string | null = null;
  let payerCode = "";
  for (let i = 0; i < prefix.frames.length; i++) {
    const frame = prefix.frames[i];
    const kind = prefix.kinds[i];
    if (kind === ROOT) {
      // RR-5, evaluated directly
      roots = recentroots.check(
        frame,
        state,
        cfg,
        slot === null ? head.slot : slot,
        rootMargin,
        deps
      );
      continue;
    }
    if (kind === EXPIRY) {
      const code = state.code(cfg.expiryVerifier);
      deps.set(depKey("code", cfg.expiryVerifier), code);
      if (code !== cfg.expiryVerifierCode) fail(E.ErrFramePrefixReverted);
      deadline = frame.deadline;
      if ((frame.deadline as bigint) < BigInt(head.timestamp + expiryMargin))
        fail(E.ErrFrameExpired);
      continue;
    }
    const target = frame.target !== null ? frame.target : sender;
    const code = target === sender ? senderCode : state.code(target);
    for (const [addr, readSlot] of frame.reads) {
      if (addr === sender)
        deps.set(
          depKey("storage", sender, readSlot),
          state.storage(sender, readSlot)
        );
    }
    if (kind === DEPLOY) {
      deps.set(depKey("code", target), code);
      checkTrace(frame, sender, true, state, cfg);
      if (frame.reverts) fail(E.ErrFramePrefixReverted);
      if (code === "" || frame.installsCode === null || senderCode !== "")
        fail(E.ErrFrameDeployNoCode);
      senderCode = frame.installsCode;
      for (const [addr, writeSlot, value] of frame.writes)
        if (addr === sender) deployedStorage.set(writeSlot, value);
      continue;
    }
    const scope = frame.flags & APPROVE_SCOPE_MASK;
    if (code === "") {
      if (!defaultCodeApproves(tx, scope, target))
        fail(E.ErrFramePrefixReverted);
    } else {
      if (!(kind === PAY && code === cfg.canonicalPaymasterCode))
        checkTrace(frame, sender, false, state, cfg);
      for (const [addr, readSlot, expected] of frame.reads) {
        const value =
          addr === sender && deployedStorage.has(readSlot)
            ? (deployedStorage.get(readSlot) as bigint)
            : state.storage(addr, readSlot);
        if (expected !== null && value !== expected)
          fail(E.ErrFramePrefixReverted);
      }
      if (frame.reverts) fail(E.ErrFramePrefixReverted);
      if (frame.approves !== scope) fail(E.ErrFrameMissingApprove);
    }
    if (scope & APPROVE_PAYMENT) {
      if (state.balance(target) < tx.maxCost) fail(E.ErrInsufficientFunds);
      if (mode && frame.execGas < cfg.expiringNonceGas)
        fail(E.ErrFramePrefixReverted); // EN-5
      payer = target;
      payerCode = code;
    }
  }

  // FP-10: the payer's class and its dependencies
  if (payer === null) throw new Error("checkStatic guarantees a payment frame");
  const payerClass = classifyPayer(payer, payerCode, sender, cfg);
  deps.set(depKey("balance", payer), state.balance(payer));
  deps.set(depKey("code", payer), state.code(payer));
  if (payerClass === "canonical")
    deps.set(depKey("withdrawal", payer), state.withdrawal(payer));
  return { payer, payerClass, deps, deadline, roots };
}
