import { describe, expect, it } from "vitest";
import { keccak256 } from "../../src/keccak.js";

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

describe("keccak256 (emem 11-surface.md, SF-3)", () => {
  it("gives the known answers", () => {
    expect(hex(keccak256(new Uint8Array()))).toBe(
      "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    );
    expect(hex(keccak256(Buffer.from("abc")))).toBe(
      "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"
    );
  });

  it("pads across the 136-byte rate", () => {
    const sizes = [135, 136, 137, 272];
    const hashes = new Set(
      sizes.map((n) => hex(keccak256(new Uint8Array(n).fill(0x61))))
    );
    expect(hashes.size).toBe(sizes.length);
  });
});
