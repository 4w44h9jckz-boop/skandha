/**
 * Plays every vector and prints one line a failing case, what the skipped
 * cases need, and the totals. Exit status 0 when every case played matches.
 *
 * Usage: bun test/run-vectors.ts [-v]
 */
/* eslint-disable no-console */
import { VECTORS_COMMIT, playAll } from "./runner.js";

const verbose = process.argv.includes("-v");
const outcomes = playAll();
const skipped = new Map<string, number>();
for (const o of outcomes) {
  if (o.status === "fail")
    console.log(`FAIL ${o.clause} ${o.file}: ${o.name}: ${o.detail}`);
  else if (o.status === "pass" && verbose)
    console.log(`ok   ${o.clause} ${o.file}: ${o.name}`);
  else if (o.status === "skip")
    skipped.set(o.detail, (skipped.get(o.detail) ?? 0) + 1);
}
for (const [need, n] of [...skipped].sort())
  console.log(`skip ${n} needing ${need}`);
const count = (s: string): number =>
  outcomes.filter((o) => o.status === s).length;
const files = new Set(outcomes.map((o) => o.file)).size;
console.log(
  `${count("pass")} passed, ${count("fail")} failed, ${count(
    "skip"
  )} skipped, ${files} vector files from emem ${VECTORS_COMMIT.slice(0, 8)}`
);
process.exit(count("fail") > 0 ? 1 : 0);
