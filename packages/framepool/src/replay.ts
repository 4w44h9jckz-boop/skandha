/**
 * Replay: a profile's verdict on a transaction a chain mined (exp-mempool-l2s
 * `docs/spec/12-replay.md`, RP-1 to RP-6). Only what a chain keeps is judged:
 * the bytes, the parent header and the receipt's payer. No state is read.
 */
import * as E from "./errors.js";
import { TxError } from "./errors.js";
import { FramePoolConfig, withChanges } from "./config.js";
import { Head } from "./model.js";
import { checkStatic } from "./prefix.js";
import { SurfaceConfig, decode, txHash } from "./surface.js";
import { FrameTx } from "./tx.js";

export const RECENT_ROOT_VERIFIER =
  "0x0000000000000000000000000000000000008272";
const TESTNET_EXPIRY_VERIFIER = "0x0000000000000000000000000000000000008141";
const NO_HEADER_GAS_LIMIT = 1n << 256n; // RP-3: without a header, no max_gas is above the head's gas limit

export interface ParentHeader {
  number: number;
  timestamp: number;
  gasLimit: bigint;
  gasUsed: bigint;
  baseFee: bigint;
}

export interface ReplayResult {
  comparison: "agree" | "explained" | "disagree" | "not replayed";
  verdict?: string;
  payer?: string;
  differences?: string[];
  header?: "read" | "missing";
}

type Difference = [Partial<FramePoolConfig>, (tx: FrameTx) => FrameTx];

const same = (tx: FrameTx): FrameTx => tx;

/** RP-5, in its order: a change to the profile, and one to the transaction. */
export const DIFFERENCES: ReadonlyMap<string, Difference> = new Map<
  string,
  Difference
>([
  ["max_verify_gas", [{ maxVerifyGas: 500_000n }, same]],
  ["max_verify_state_gas", [{ maxVerifyStateGas: null }, same]],
  ["expiry_verifier", [{ expiryVerifier: TESTNET_EXPIRY_VERIFIER }, same]],
  [
    "recent-roots",
    [
      {},
      (tx) =>
        new FrameTx({
          ...tx,
          frames: tx.frames.filter((f) => f.target !== RECENT_ROOT_VERIFIER),
        }),
    ],
  ],
]);

/** RP-3 after SF-2 and SF-3: FP-3 to FP-6, and FP-10's payer from the prefix's shape. */
export function judge(
  tx: FrameTx,
  head: Head,
  cfg: FramePoolConfig
): [string, string | null] {
  try {
    const prefix = checkStatic(tx, head, cfg);
    const last = prefix.frames[prefix.frames.length - 1];
    return [E.OK, last.target ?? tx.sender];
  } catch (err) {
    if (err instanceof TxError) return [err.code, null];
    throw err;
  }
}

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  return items.flatMap((x, i) =>
    combinations(items.slice(i + 1), k - 1).map((rest) => [x, ...rest])
  );
}

/** RP-1 to RP-4 for one fixture under one profile. */
export function replay(
  raw: Uint8Array,
  fixtureHash: string,
  receiptPayer: string,
  parent: ParentHeader | null,
  cfg: FramePoolConfig,
  surface: SurfaceConfig
): ReplayResult {
  if (txHash(raw) !== fixtureHash.toLowerCase())
    return { comparison: "not replayed" };
  const header = parent !== null ? "read" : "missing";
  const head: Head = {
    number: parent?.number ?? 0,
    timestamp: parent?.timestamp ?? 0,
    gasLimit: parent?.gasLimit ?? NO_HEADER_GAS_LIMIT,
    gasUsed: parent?.gasUsed ?? 0n,
    baseFee: parent?.baseFee ?? 0n,
    slot: parent?.number ?? 0,
  };
  const verdictWith = (names: string[]): [string, string | null] => {
    const c = withChanges(
      cfg,
      Object.assign(
        {},
        ...names.map((n) => (DIFFERENCES.get(n) as Difference)[0])
      )
    );
    let tx: FrameTx;
    try {
      tx = decode(raw, c, surface); // SF-3 reads deadlines against the profile's expiry verifier
    } catch (err) {
      if (err instanceof TxError) return [err.code, null];
      throw err;
    }
    for (const n of names) tx = (DIFFERENCES.get(n) as Difference)[1](tx);
    return judge(tx, head, c);
  };
  const [verdict, payer] = verdictWith([]);
  if (verdict === E.OK) {
    const agree = payer === receiptPayer.toLowerCase();
    return {
      verdict,
      payer: payer as string,
      comparison: agree ? "agree" : "disagree",
      differences: [],
      header,
    };
  }
  const names = [...DIFFERENCES.keys()];
  for (const k of [1, 2]) {
    for (const set of combinations(names, k)) {
      if (verdictWith(set)[0] === E.OK)
        return { verdict, comparison: "explained", differences: set, header };
    }
  }
  return { verdict, comparison: "disagree", differences: [], header };
}
