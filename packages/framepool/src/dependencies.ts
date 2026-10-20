/**
 * EIP-8288 dependency frames: exp-mempool-l2s `docs/spec/05-aggregation.md`, AG-2, AG-4,
 * AG-5's union and AG-8. Static rules over a transaction.
 */
import * as E from "./errors.js";
import { TxError } from "./errors.js";
import { FramePoolConfig } from "./config.js";
import {
  Dependency,
  Frame,
  FrameTx,
  LEANSPHINCS,
  LEANSTARK,
  sortedUnique,
} from "./tx.js";

// LEANSPHINCS_ / LEANSTARK_VERIFICATION_GAS
export const VERIFICATION_GAS: ReadonlyMap<number, bigint> = new Map([
  [LEANSPHINCS, 3000n],
  [LEANSTARK, 30000n],
]);
export const RECURSIVE_STARK_GAS = 30000n; // AG-8, per declared triple
export const TRIPLE_BYTES = 96;
export const ZERO_HASH = "0x" + "00".repeat(32);

/** AG-2, in place of FP-3's constraints on one frame; the frame before it is checked by the caller. */
export function checkFrame(frame: Frame, cfg: FramePoolConfig): void {
  const k = frame.deps.length;
  const valid = (scheme: number): boolean =>
    scheme === LEANSPHINCS ||
    (scheme === LEANSTARK && cfg.leanstark === "defined");
  if (
    k < 1 ||
    k > cfg.maxDependenciesPerFrame ||
    frame.deps.some((d) => !valid(d.scheme))
  ) {
    throw new TxError(E.ErrDepFrameMalformed);
  }
  if (
    frame.dataSize !== TRIPLE_BYTES * k ||
    frame.target !== null ||
    frame.value !== 0n ||
    frame.flags !== 0
  ) {
    throw new TxError(E.ErrDepFrameMalformed);
  }
  const gas = frame.deps.reduce(
    (g, d) => g + (VERIFICATION_GAS.get(d.scheme) as bigint),
    0n
  );
  if (frame.execGas !== gas || frame.stateGas !== 0n)
    throw new TxError(E.ErrDepFrameMalformed);
}

/** How many leanSPHINCS and how many leanSTARK triples. */
export function counts(deps: readonly Dependency[]): [number, number] {
  return [
    deps.filter((d) => d.scheme === LEANSPHINCS).length,
    deps.filter((d) => d.scheme === LEANSTARK).length,
  ];
}

/**
 * AG-4: the sorted, deduplicated triples of the transaction's dependency
 * frames. Under `zeroDataHash` `sig_hash` a zero data_hash holds the
 * transaction's signature hash, for which the model has MD-7's hash of the
 * transaction (exp-mempool-l2s decision record 0063).
 */
export function dependencies(
  tx: FrameTx,
  cfg: FramePoolConfig | null = null
): readonly Dependency[] {
  if (cfg === null || cfg.zeroDataHash !== "sig_hash") return tx.dependencies;
  return sortedUnique(
    tx.dependencies.map((d) =>
      d.dataHash === ZERO_HASH ? { ...d, dataHash: tx.hash } : d
    )
  );
}

/** AG-4, over the sorted, deduplicated list. */
export function checkLimits(tx: FrameTx, cfg: FramePoolConfig): void {
  const [sigs, starks] = counts(dependencies(tx, cfg));
  if (sigs > cfg.maxSigsPerTx || starks > cfg.maxStarksPerTx)
    throw new TxError(E.ErrFrameTooManyDeps);
}

/** AG-5: the sorted, deduplicated union of the transactions' dependencies. */
export function union(
  txs: readonly FrameTx[],
  cfg: FramePoolConfig | null = null
): Dependency[] {
  return sortedUnique(txs.flatMap((tx) => dependencies(tx, cfg)));
}

/** AG-8: what a transaction's declarations add to its block's gas. */
export function blockGas(tx: FrameTx): bigint {
  return RECURSIVE_STARK_GAS * BigInt(tx.declared);
}
