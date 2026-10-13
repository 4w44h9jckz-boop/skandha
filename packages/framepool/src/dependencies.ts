/**
 * EIP-8288 dependency frames: emem `docs/spec/05-aggregation.md`, AG-2, AG-4
 * and AG-8. Static rules over a transaction; the aggregator of AG-5 to AG-9
 * is not in this package.
 */
import * as E from "./errors.js";
import { TxError } from "./errors.js";
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

/** AG-2, in place of FP-3's constraints on one frame. */
export function checkFrame(frame: Frame, maxDependencies: number): void {
  const k = frame.deps.length;
  if (
    k < 1 ||
    k > maxDependencies ||
    frame.deps.some((d) => !VERIFICATION_GAS.has(d.scheme))
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

/** AG-4, over the sorted, deduplicated list. */
export function checkLimits(
  tx: FrameTx,
  maxSigs: number,
  maxStarks: number
): void {
  const [sigs, starks] = counts(tx.dependencies);
  if (sigs > maxSigs || starks > maxStarks)
    throw new TxError(E.ErrFrameTooManyDeps);
}

/** AG-5: the sorted, deduplicated union of the transactions' dependencies. */
export function union(txs: readonly FrameTx[]): Dependency[] {
  return sortedUnique(txs.flatMap((tx) => tx.dependencies));
}

/** AG-8: what a transaction's declarations add to its block's gas. */
export function blockGas(tx: FrameTx): bigint {
  return RECURSIVE_STARK_GAS * BigInt(tx.declared);
}
