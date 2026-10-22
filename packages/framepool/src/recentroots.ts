/**
 * Recent roots: exp-mempool-l2s `docs/spec/08-recent-roots.md`, RR-3 to RR-6 (EIP-8272).
 *
 * The EIP derives a source id, an entry and its storage key with keccak256
 * over fixed-width encodings. Here, as in the reference, they are injective
 * functions of the same inputs, which is the property the EIP uses the
 * hashes for (RR-3, exp-mempool-l2s decision record 0023).
 */
import { createHash } from "node:crypto";
import * as E from "./errors.js";
import { TxError } from "./errors.js";
import { FramePoolConfig } from "./config.js";
import { State } from "./model.js";
import { Frame, VERIFY_MODE } from "./tx.js";
import { Deps, depKey } from "./deps.js";

export const TUPLE_BYTES = 72; // RECENT_ROOT_TUPLE_BYTES

/** RR-3: the root source an address writes to with a salt. */
export function sourceId(address: string, salt: string): string {
  return `${address}/${salt}`;
}

function toInt(...parts: (string | number)[]): bigint {
  return BigInt(
    "0x" + createHash("sha256").update(parts.join("/")).digest("hex")
  );
}

/** RR-3: where index `index` of `source`'s ring buffer is stored at the contract. */
export function storageKey(source: string, index: number): bigint {
  return toInt("RECENT_ROOT_STORAGE", source, index);
}

/** RR-3: what a write of `root` by `source` at `slot` stores. */
export function entry(source: string, slot: number, root: string): bigint {
  return toInt("RECENT_ROOT_ENTRY", source, slot, root);
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** RR-3: the entry at index `slot` mod L becomes (source, slot, root); `root` null empties it. */
export function writeRoot(
  state: State,
  cfg: FramePoolConfig,
  source: string,
  slot: number,
  root: string | null
): void {
  const storage = state.edit(cfg.recentRootAddress).storage;
  const key = storageKey(source, mod(slot, cfg.recentRootLength));
  if (root === null) storage.delete(key);
  else storage.set(key, entry(source, slot, root));
}

/** RR-4: whether `frame` is a `recent_root_verify` frame. */
export function isVerifier(frame: Frame, cfg: FramePoolConfig): boolean {
  const k = frame.roots.length;
  return (
    cfg.recentRoots &&
    frame.mode === VERIFY_MODE &&
    frame.target === cfg.recentRootAddress &&
    frame.flags === 0 &&
    frame.value === 0n &&
    frame.stateGas === 0n &&
    k >= 1 &&
    k <= cfg.maxRecentRootReferences &&
    frame.dataSize === TUPLE_BYTES * k
  );
}

/** RR-5, recording RR-6's dependencies in `deps`. Returns the oldest and newest slot referenced. */
export function check(
  frame: Frame,
  state: State,
  cfg: FramePoolConfig,
  currentSlot: number,
  margin: number,
  deps: Deps
): [number, number] {
  const address = cfg.recentRootAddress;
  const code = state.code(address);
  deps.set(depKey("code", address), code);
  if (code !== cfg.recentRootCode) throw new TxError(E.ErrFramePrefixReverted);
  const usable = cfg.recentRootLength - 1;
  for (const [source, slot, root] of frame.roots) {
    if (slot >= currentSlot) throw new TxError(E.ErrFrameRootFuture);
    if (currentSlot - slot > usable - margin)
      throw new TxError(E.ErrFrameRootExpired);
    const key = storageKey(source, mod(slot, cfg.recentRootLength));
    const held = state.storage(address, key);
    deps.set(depKey("storage", address, key), held);
    if (held !== entry(source, slot, root))
      throw new TxError(E.ErrFrameRootUnknown);
  }
  if (frame.reverts) throw new TxError(E.ErrFramePrefixReverted);
  const slots = frame.roots.map(([, slot]) => slot);
  return [Math.min(...slots), Math.max(...slots)];
}
