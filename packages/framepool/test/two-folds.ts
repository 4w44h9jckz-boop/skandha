/**
 * Two nodes, each with its own frame pool and aggregator under
 * `eip-8288-master` (exp-mempool-l2s `docs/spec/05-aggregation.md`, version 4),
 * fold the same leanSPHINCS dependencies, and each accepts the other's fold.
 *
 * Users hand their mode 0 wrappers to one node or the other. Round 1: each
 * node folds what it holds (AG-7) and sends the fold to the other, which
 * admits the transactions it lacked (AG-5, AG-6). Round 2: each folds again,
 * now over the same dependencies, and receives the other's fold. Round 3: a
 * block includes one transaction from each node, both drop them, and each
 * folds what is left. Last, a fold that leaves one dependency out is refused
 * (AG-5 check 3).
 *
 * Proving time is AG-9's, at the laptop's costs exp-mempool-l2s's experiment 24
 * reports (`experiments/24-proving-budget/results.md`): `prove_base` 79.1 ms,
 * `prove_sig` 3.4 ms a leanSPHINCS triple, `prove_recursive` 178.0 ms a
 * recursive input, within a budget of one aggregation interval, 1,000 ms.
 *
 * Usage: bun test/run-two-folds.ts
 */
import { Aggregator, Wrapper } from "../src/aggregation.js";
import { EIP_8288_MASTER, FramePoolConfig } from "../src/config.js";
import { ZERO_HASH, union } from "../src/dependencies.js";
import { Head, State } from "../src/model.js";
import { FramePool } from "../src/pool.js";
import { Reserver } from "../src/reserver.js";
import { FrameTx, dependencyId, frame } from "../src/tx.js";

export const LAPTOP: FramePoolConfig = {
  ...EIP_8288_MASTER,
  provingBudget: 1000,
  proveBase: 79.1,
  proveSig: 3.4,
  proveRecursive: 178.0,
};

export interface Outcome {
  round: number;
  node: string;
  listed: number;
  hashed: number; // of those, listed by hash
  deps: number;
  same: boolean; // whether its deps are the other node's fold's, in order
  time: number; // AG-9, ms
  answer: string | string[]; // the other node's answer to this fold
}

const HEAD: Head = {
  number: 0,
  timestamp: 1000,
  gasLimit: 30_000_000n,
  gasUsed: 15_000_000n,
  baseFee: 10n,
  slot: 0,
};

/** A user's spend with one leanSPHINCS dependency; a zero data_hash names its own signature hash (AG-4). */
function spend(i: number, zero: boolean): FrameTx {
  return new FrameTx({
    sender: `u${i}`,
    label: `S${i}`,
    tip: BigInt(10 + i),
    frames: [
      frame({
        mode: EIP_8288_MASTER.depFrameMode,
        deps: [
          {
            scheme: 16,
            dataHash: zero ? ZERO_HASH : `msg-${i}`,
            vkHash: `pk-u${i}`,
          },
        ],
        execGas: 3000n,
        dataSize: 96,
      }),
      frame({ mode: 1, flags: 3 }),
    ],
  });
}

class Node {
  readonly pool: FramePool;
  readonly aggregator: Aggregator;
  state = new State();

  constructor(readonly name: string, users: number, config: FramePoolConfig) {
    for (let i = 0; i < users; i++)
      this.state.edit(`u${i}`).balance = 10n ** 9n;
    this.pool = new FramePool(HEAD, this.state, config, new Reserver());
    this.aggregator = new Aggregator(this.pool);
  }

  /** The next block includes these users' spends, so their nonces move on (FP-15 step 1). */
  include(users: readonly number[]): void {
    this.state = this.state.copy();
    for (const i of users) this.state.edit(`u${i}`).nonce = 1n;
    this.pool.reset(
      { ...HEAD, number: 1, timestamp: 1012, slot: 1 },
      this.state
    );
  }
}

const ids = (w: Wrapper): string => w.deps.map(dependencyId).join(" ");

/**
 * The exchange, with `users` spends, every third with a zero data_hash; even
 * users hand theirs to A, odd ones to B.
 */
export function twoFolds(users = 12, config = LAPTOP): Outcome[] {
  const a = new Node("A", users, config);
  const b = new Node("B", users, config);
  for (let i = 0; i < users; i++) {
    const tx = spend(i, i % 3 === 0);
    const deps = union([tx], config);
    const answer = (i % 2 === 0 ? a : b).aggregator.receive({
      txs: [tx],
      mode: 0,
      deps,
      proofs: deps.map(() => true),
      stark: null,
      signed: [],
    });
    if (typeof answer === "string" || answer[0] !== "ok")
      throw new Error(`u${i}'s wrapper was refused: ${answer}`);
  }
  const out: Outcome[] = [];
  for (let round = 1; round <= 3; round++) {
    if (round === 3) for (const n of [a, b]) n.include([0, 1]);
    const foldA = a.aggregator.aggregate() as Wrapper;
    const timeA = a.aggregator.provingTime;
    const foldB = b.aggregator.aggregate() as Wrapper;
    const timeB = b.aggregator.provingTime;
    const answerB = b.aggregator.receive(foldA);
    const answerA = a.aggregator.receive(foldB);
    const same = ids(foldA) === ids(foldB);
    for (const [n, fold, time, answer] of [
      [a, foldA, timeA, answerB],
      [b, foldB, timeB, answerA],
    ] as const)
      out.push({
        round,
        node: n.name,
        listed: fold.txs.length,
        hashed: fold.txs.filter((e) => typeof e === "string").length,
        deps: fold.deps.length,
        same,
        time,
        answer,
      });
  }
  // a fold that leaves one dependency out
  const fold = a.aggregator.aggregate() as Wrapper;
  const short = fold.deps.slice(1);
  out.push({
    round: 4,
    node: "A, one dependency left out",
    listed: fold.txs.length,
    hashed: fold.txs.filter((e) => typeof e === "string").length,
    deps: short.length,
    same: false,
    time: a.aggregator.provingTime,
    answer: b.aggregator.receive({
      ...fold,
      deps: short,
      stark: { covers: short, valid: true },
    }),
  });
  return out;
}
