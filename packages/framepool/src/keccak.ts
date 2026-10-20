/**
 * Keccak-256, the hash Ethereum names a transaction by (exp-mempool-l2s
 * `docs/spec/11-surface.md`, SF-3). Node's `sha3-256` is FIPS 202 SHA3-256,
 * whose padding differs from the original Keccak's, so the permutation is
 * written out here, with no dependency.
 */

const RC = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n,
];
const ROT = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];
const MASK = (1n << 64n) - 1n;
const RATE = 136; // bytes: 1600 bits less twice the 256-bit output

const rotl = (x: bigint, n: number): bigint =>
  n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK;

/** Keccak-f[1600] on a 5 by 5 state of 64-bit lanes, indexed a[x][y]. */
function permute(a: bigint[][]): void {
  for (const rc of RC) {
    const c = [0, 1, 2, 3, 4].map(
      (x) => a[x][0] ^ a[x][1] ^ a[x][2] ^ a[x][3] ^ a[x][4]
    );
    const d = [0, 1, 2, 3, 4].map(
      (x) => c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1)
    );
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) a[x][y] ^= d[x];
    const b = [0, 1, 2, 3, 4].map(() => [0n, 0n, 0n, 0n, 0n]);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        b[y][(2 * x + 3 * y) % 5] = rotl(a[x][y], ROT[x][y]);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        a[x][y] = b[x][y] ^ (~b[(x + 1) % 5][y] & MASK & b[(x + 2) % 5][y]);
    a[0][0] ^= rc;
  }
}

/** Keccak-256 with the original padding, 0x01 ... 0x80. */
export function keccak256(data: Uint8Array): Uint8Array {
  const len = data.length + 1;
  const padded = new Uint8Array(len + ((RATE - (len % RATE)) % RATE));
  padded.set(data);
  padded[data.length] = 0x01;
  padded[padded.length - 1] |= 0x80;
  const a = [0, 1, 2, 3, 4].map(() => [0n, 0n, 0n, 0n, 0n]);
  const view = new DataView(padded.buffer);
  for (let off = 0; off < padded.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i++)
      a[i % 5][Math.floor(i / 5)] ^= view.getBigUint64(off + 8 * i, true);
    permute(a);
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 4; i++)
    ov.setBigUint64(8 * i, a[i % 5][Math.floor(i / 5)], true);
  return out;
}
