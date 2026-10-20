import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SURFACE_PROFILES, verifyTargets } from "../../src/surface.js";

const HEGOTA = SURFACE_PROFILES.get("hegota-testnet");
if (HEGOTA === undefined) throw new Error("no hegota-testnet surface");

/** The mined ticket spend of exp-mempool-l2s's sf-03-model-transaction.json. */
function spend(): Uint8Array {
  const v = JSON.parse(
    readFileSync(
      new URL(
        "../vectors/surface/sf-03-model-transaction.json",
        import.meta.url
      ),
      "utf8"
    )
  );
  const c = v.cases.find((x: { name: string }) =>
    x.name.includes("0x0bba93ca")
  );
  return Buffer.from(c.steps[0].decode.slice(2), "hex");
}

describe("verifyTargets (exp-mempool-l2s 11-surface.md, SF-3's claim)", () => {
  it("names the sender for a VERIFY frame with no target, and the paymaster", () => {
    expect(verifyTargets(spend(), HEGOTA)).toEqual([
      "0xb0006caa2627a718cd831a50fda5152f14b0df1b",
      "0x273795f6eb2730d50c3544cbef1e0c1adba4f541",
    ]);
  });

  it("names nothing for bytes that are not a frame transaction", () => {
    expect(verifyTargets(Uint8Array.of(0x02, 0xc0), HEGOTA)).toEqual([]);
    expect(verifyTargets(spend().subarray(0, 40), HEGOTA)).toEqual([]);
  });
});
