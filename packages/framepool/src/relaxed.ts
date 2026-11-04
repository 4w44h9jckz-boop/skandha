/**
 * exp-mempool-l2s `docs/spec/15-relaxed-mempool.md`: RM-1's declarations, and
 * the reads, relaxations and reputation states that RM-3 to RM-6 read from
 * them. The pool's rules themselves are in `pool.ts`.
 */
import { Declaration, FramePoolConfig } from "./config.js";
import { isDelegation } from "./model.js";

/** RM-2: the refusals a relaxation answers. */
export const RELAXABLE: ReadonlySet<string> = new Set([
  "ErrFrameStorageReadNonSender",
  "ErrFramePaymasterBusy",
  "ErrFrameSenderBusy",
]);

/** RM-6's states. */
export type DeclarationState = "ACTIVE" | "THROTTLED" | "BANNED";

/** RM-1: the declaration for `code`, or null. Empty code and an EIP-7702 delegation have none. */
export function declaration(
  cfg: FramePoolConfig,
  code: string
): Declaration | null {
  if (code === "" || isDelegation(code)) return null;
  return cfg.declarations.find((d) => d.code === code) ?? null;
}

/** RM-1: whether `code` declares `slot` write-once. */
export function declares(
  cfg: FramePoolConfig,
  code: string,
  slot: bigint
): boolean {
  const d = declaration(cfg, code);
  return (
    d !== null &&
    d.writeOnce.some(([first, count]) => first <= slot && slot < first + count)
  );
}

/** RM-6: a declared code's state from its count of violations. */
export function stateOf(
  violations: number,
  cfg: FramePoolConfig
): DeclarationState {
  if (violations >= cfg.banViolations) return "BANNED";
  if (violations >= 1) return "THROTTLED";
  return "ACTIVE";
}
