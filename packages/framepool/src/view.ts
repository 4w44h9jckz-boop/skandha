/**
 * BB-2, go-ethereum `TransactionsByPriceAndNonce`, for frame transactions
 * alone: emem `docs/spec/03-block-building.md`. Each frame transaction is a
 * head of its own (FP-16); a head whose fee cap is below the base fee is
 * dropped, and the rest go by effective tip, then by arrival. The
 * account-nonce half, which merges each sender's nonce-ordered list, belongs
 * to an execution client's pool and is not here.
 */
import { FrameTx } from "./tx.js";

export function builderOrder(
  view: readonly FrameTx[],
  baseFee: bigint,
  arrival: (tx: FrameTx) => number
): FrameTx[] {
  return view
    .filter((tx) => tx.maxFee >= baseFee)
    .map((tx) => ({ tx, tip: tx.effectiveTip(baseFee), at: arrival(tx) }))
    .sort((a, b) => (a.tip !== b.tip ? (a.tip > b.tip ? -1 : 1) : a.at - b.at))
    .map(({ tx }) => tx);
}
