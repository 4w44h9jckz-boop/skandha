/**
 * emem's conformance vectors, one test a case. A skipped case names what this
 * package lacks to play it; a failing one is settled in emem, never by editing
 * the copy here (emem `conformance/README.md`, decision record 0035).
 */
import { describe, expect, it } from "vitest";
import { Outcome, VECTORS_COMMIT, playAll, vectorFiles } from "../runner.js";

describe(`emem conformance vectors at ${VECTORS_COMMIT.slice(0, 8)}`, () => {
  it("are byte for byte the ones copied", () => {
    expect(vectorFiles().length).toBeGreaterThan(0);
  });

  const outcomes = playAll();
  const byFile = new Map<string, Outcome[]>();
  for (const o of outcomes)
    byFile.set(o.file, [...(byFile.get(o.file) ?? []), o]);

  for (const [file, cases] of byFile) {
    describe(`${cases[0].clause} ${file}`, () => {
      for (const o of cases) {
        if (o.status === "skip") {
          it.skip(`${o.name} (needs ${o.detail})`, () => undefined);
        } else {
          it(o.name, () => {
            expect(o.detail).toBe("");
          });
        }
      }
    });
  }
});
