/**
 * Inclusion lists for frame transactions, exp-mempool-l2s `docs/spec/07-focil.md`
 * version 2, as a mempool node reads them. An includer builds its list from
 * its frame pool (IL-2); the slot's lists are filled against the verify
 * budget, one for each list or one for the payload (IL-4); and a payload
 * satisfies them unless it left out an enforceable transaction that a client
 * finds valid at its end (IL-5, IL-6). The account-nonce half of a list, the
 * builder's appending (IL-7) and the attesters (IL-8) are not here.
 */
import { FramePoolConfig, withChanges } from "./config.js";
import { Head, headNextBaseFee } from "./model.js";
import { FramePool } from "./pool.js";
import { analyse, checkStatic } from "./prefix.js";
import { FrameTx, signatureGas } from "./tx.js";

/** IL-1. */
export interface FocilConfig {
  readonly name: string;
  readonly enabled: boolean;
  readonly committeeSize: number; // IL_COMMITTEE_SIZE
  readonly maxBytes: number; // MAX_BYTES_PER_INCLUSION_LIST
  readonly frames: boolean; // EIP-8369's Profile 2
  readonly maxVerifyGasPerIl: bigint; // MAX_VERIFY_GAS_PER_IL
  readonly maxVerifyGasPerTx: bigint; // MAX_VERIFY_GAS_PER_TX
  readonly policy: "fee" | "age";
  readonly fill: "per-list" | "per-payload";
}

export const FOCIL_OFF: FocilConfig = {
  name: "off",
  enabled: false,
  committeeSize: 16,
  maxBytes: 8192,
  frames: false,
  maxVerifyGasPerIl: 1n << 20n,
  maxVerifyGasPerTx: 1n << 20n,
  policy: "fee",
  fill: "per-list",
};
export const EIP_7805: FocilConfig = {
  ...FOCIL_OFF,
  name: "eip-7805",
  enabled: true,
};
export const EIP_8369: FocilConfig = {
  ...EIP_7805,
  name: "eip-8369",
  frames: true,
};
/** ethrex at 64b8fc09: EIP-8369's fill run once over the array the execution layer receives. */
export const ETHREX: FocilConfig = {
  ...EIP_8369,
  name: "ethrex",
  fill: "per-payload",
};
export const FOCIL_PROFILES: ReadonlyMap<string, FocilConfig> = new Map(
  [FOCIL_OFF, EIP_7805, EIP_8369, ETHREX].map((p) => [p.name, p])
);

/** IL-3 and IL-4: the signature cost and the prefix's declared gas, or the whole transaction's without a prefix. */
export function costs(tx: FrameTx, cfg: FramePoolConfig): [bigint, bigint] {
  const signatures = tx.signatures.reduce((g, s) => g + signatureGas(s), 0n);
  const prefix = analyse(tx, cfg);
  const frames = prefix !== null ? prefix.frames : tx.frames;
  return [signatures, frames.reduce((g, f) => g + f.execGas, 0n)];
}

/** IL-3: a Profile 2 candidate, from the transaction alone: FP-3 to FP-6 with IL-3's bound and no pool policy. */
export function candidate(
  tx: FrameTx,
  head: Head,
  cfg: FramePoolConfig,
  config: FocilConfig
): boolean {
  const bound = withChanges(cfg, {
    maxVerifyGas: config.maxVerifyGasPerTx,
    maxVerifyStateGas: null,
    priceLimit: 0n,
  });
  try {
    checkStatic(tx, head, bound);
    return true;
  } catch {
    return false;
  }
}

/** IL-2: what an includer holding `pool` lists for a block at `baseFee`, frame transactions only. */
export function buildIl(
  pool: FramePool,
  config: FocilConfig,
  baseFee: bigint = headNextBaseFee(pool.head)
): FrameTx[] {
  if (!config.frames) return [];
  const key = (tx: FrameTx): [bigint, number] => [
    config.policy === "age" ? 0n : -tx.effectiveTip(baseFee),
    pool.arrival(tx.hash),
  ];
  const order = pool.pendingView(0n, baseFee).sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    return ka[0] !== kb[0] ? (ka[0] < kb[0] ? -1 : 1) : ka[1] - kb[1];
  });
  const listed: FrameTx[] = [];
  let size = 0;
  let budget = config.maxVerifyGasPerIl;
  for (const tx of order) {
    const bytes = tx.size ?? 200 + tx.dataBytes;
    if (size + bytes > config.maxBytes) continue;
    if (!candidate(tx, pool.head, pool.config, config)) continue;
    const [signatures, prefix] = costs(tx, pool.config);
    if (signatures + prefix > budget) continue;
    budget -= signatures + prefix;
    listed.push(tx);
    size += bytes;
  }
  return listed;
}

/** IL-6: every listed transaction once, in the order the ILs give them. */
export function listed(ils: readonly (readonly FrameTx[])[]): FrameTx[] {
  const seen = new Set<string>();
  const out: FrameTx[] = [];
  for (const tx of ils.flat()) {
    if (seen.has(tx.hash)) continue;
    seen.add(tx.hash);
    out.push(tx);
  }
  return out;
}

/** IL-4 and IL-6: under `per-payload` the order delivered, else the ILs' order with each transaction once. */
export function deliveredOrder(
  ils: readonly (readonly FrameTx[])[],
  config: FocilConfig,
  delivered?: readonly FrameTx[]
): FrameTx[] {
  return config.fill === "per-payload" && delivered !== undefined
    ? [...delivered]
    : listed(ils);
}

/** IL-4: the hashes the budget fill admitted, each once, in the order first admitted. */
export function admitted(
  ils: readonly (readonly FrameTx[])[],
  head: Head,
  cfg: FramePoolConfig,
  config: FocilConfig,
  delivered?: readonly FrameTx[]
): string[] {
  const runs =
    config.fill === "per-payload"
      ? [deliveredOrder(ils, config, delivered)]
      : ils;
  const out: string[] = [];
  for (const run of runs) {
    let left = config.maxVerifyGasPerIl;
    for (const tx of run) {
      const [signatures, prefix] = costs(tx, cfg);
      const cost = signatures + prefix;
      if (cost > config.maxVerifyGasPerTx || cost > left) continue;
      left -= signatures;
      if (tx.signatures.some((s) => !s.valid)) continue;
      left -= prefix;
      if (candidate(tx, head, cfg, config) && !out.includes(tx.hash))
        out.push(tx.hash);
    }
  }
  return out;
}

/**
 * IL-6, with IL-5 read as a client's verdict at the end of the payload: the
 * listed transaction a payload left out without excuse, or null when it
 * satisfies the lists. `valid` holds the hashes the client found valid.
 */
export function omission(
  block: readonly FrameTx[],
  gasLeft: bigint,
  ils: readonly (readonly FrameTx[])[],
  head: Head,
  cfg: FramePoolConfig,
  config: FocilConfig,
  valid: ReadonlySet<string>,
  delivered?: readonly FrameTx[]
): FrameTx | null {
  if (!config.enabled) return null;
  const present = new Set(block.map((tx) => tx.hash));
  const order = deliveredOrder(ils, config, delivered);
  const enforceable = config.frames
    ? new Set(admitted(ils, head, cfg, config, order))
    : new Set<string>();
  for (const tx of order) {
    if (present.has(tx.hash) || tx.maxGas > gasLeft) continue;
    if (config.frames && enforceable.has(tx.hash) && valid.has(tx.hash))
      return tx;
  }
  return null;
}
