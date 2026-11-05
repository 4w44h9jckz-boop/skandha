/**
 * Prints `twoFolds()`'s rounds, one line a fold: what it lists, its
 * dependencies, whether they are the other node's fold's, its proving time
 * (AG-9) and the other node's answer to it.
 *
 * With `--prover <command>`, runs `proverFolds` instead, under a real prover
 * with exp-mempool-l2s AG-11's contract, or `test/prover-stub.ts`: one line a
 * fold, with the bytes and what the prover measured.
 *
 * Usage: bun test/run-two-folds.ts [--prover <command>]
 */
/* eslint-disable no-console */
import { proverFolds, twoFolds } from "./two-folds.js";

const at = process.argv.indexOf("--prover");
if (at >= 0) {
  for (const o of proverFolds(process.argv[at + 1])) {
    const answer =
      typeof o.answer === "string"
        ? o.answer
        : `${[...new Set(o.answer)].join(", ")} for each of ${o.answer.length}`;
    const measured =
      o.measured === null
        ? "nothing measured"
        : `${o.measured[0].toFixed(1)} ms, ${o.measured[1]} bytes at peak`;
    console.log(
      `round ${o.round}, node ${o.node}: ${o.listed} listed, ${o.deps} deps, ${o.proofBytes} proof bytes, ${measured}; the other answers ${answer}`
    );
  }
  process.exit(0);
}

for (const o of twoFolds()) {
  const answer =
    typeof o.answer === "string"
      ? o.answer
      : `${[...new Set(o.answer)].join(", ")} for each of ${o.answer.length}`;
  console.log(
    `round ${o.round}, node ${o.node}: ${o.listed} listed (${o.hashed} by hash), ${o.deps} deps` +
      `${o.same ? ", the other's" : ""}, ${o.time.toFixed(
        1
      )} ms; the other answers ${answer}`
  );
}
