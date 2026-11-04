import { describe, expect, it } from "vitest";
import { proverFolds, twoFolds } from "../two-folds.js";

describe("two nodes fold the same dependencies (exp-mempool-l2s 05-aggregation.md, AG-5 to AG-9, eip-8288-master)", () => {
  const out = twoFolds();
  const round = (r: number): ReturnType<typeof twoFolds> =>
    out.filter((o) => o.round === r);

  it("each admits the other's first fold, the transactions it lacked", () => {
    for (const o of round(1)) expect(o.answer).toEqual(Array(6).fill("ok"));
  });

  it("each folds the same dependencies, and accepts the other's fold", () => {
    for (const r of [2, 3]) {
      const folds = round(r);
      expect(folds).toHaveLength(2);
      for (const o of folds) {
        expect(o.same).toBe(true);
        expect(o.deps).toBe(o.listed);
        expect(Array.isArray(o.answer)).toBe(true);
        expect(new Set(o.answer)).toEqual(new Set(["ErrAlreadyKnown"]));
      }
    }
  });

  it("re-proves a fold after a drop with one recursive input, not the triples left", () => {
    for (const o of round(3)) {
      expect(o.listed).toBe(10);
      expect(o.time).toBeCloseTo(79.1 + 178.0); // prove_base + prove_recursive
    }
  });

  it("refuses a fold that leaves one dependency out", () => {
    expect(round(4)[0].answer).toBe("ErrWrapperDeps");
  });
});

describe("two nodes under a prover's contract (exp-mempool-l2s 05-aggregation.md, AG-11, on the stub)", () => {
  const stub = new URL("../prover-stub.ts", import.meta.url).pathname;
  const out = proverFolds(stub);
  const round = (r: number): ReturnType<typeof proverFolds> =>
    out.filter((o) => o.round === r);

  it("each folds only the signatures it holds, and the other admits them", () => {
    for (const o of round(1)) {
      expect(o.listed).toBe(3);
      expect(o.proofBytes).toBeGreaterThan(0);
      expect(o.measured).toEqual([0, 0]);
      expect(o.answer).toEqual(Array(3).fill("ok"));
    }
  });

  it("does not fold what it holds by the other's aggregate alone", () => {
    for (const o of round(2)) {
      expect(o.listed).toBe(3);
      expect(new Set(o.answer)).toEqual(new Set(["ErrAlreadyKnown"]));
    }
  });

  it("refuses a fold whose bytes were changed", () => {
    expect(round(4)[0].answer).toBe("ErrWrapperProof");
  });
});
