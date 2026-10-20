/**
 * Prints `twoFolds()`'s rounds, one line a fold: what it lists, its
 * dependencies, whether they are the other node's fold's, its proving time
 * (AG-9) and the other node's answer to it.
 *
 * Usage: bun test/run-two-folds.ts
 */
/* eslint-disable no-console */
import { twoFolds } from "./two-folds.js";

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
