/**
 * The replay's input (emem `docs/spec/12-replay.md`, RP-1), read once: for
 * each of exp-frames' mined fixtures, its bytes as exp-frames encodes them,
 * kept only if they hash to the chain's hash, its chain, its receipt's payer,
 * and its parent block's header from the chain's RPC. No state is read.
 *
 * Usage: bun replay/snapshot.ts <exp-frames checkout> <rpc url> <out.json>
 */
/* eslint-disable no-console */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [expFrames, rpc, out] = process.argv.slice(2);
const lib = await import(join(expFrames, "src/frametx/index.ts"));
const commit = execFileSync("git", ["-C", expFrames, "rev-parse", "HEAD"])
  .toString()
  .trim();
const dir = join(expFrames, "test/fixtures/chain");

async function call(
  method: string,
  params: unknown[]
): Promise<Record<string, string>> {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return ((await res.json()) as { result: Record<string, string> }).result;
}

const rows = [];
for (const file of readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()) {
  const fx = JSON.parse(readFileSync(join(dir, file), "utf8"));
  const tx = lib.frameTxFromJson(fx.tx);
  const raw: string = lib.serializeFrameTx(tx);
  const hashOk = lib.frameTxHash(tx).toLowerCase() === fx.tx.hash.toLowerCase();
  const chainId = BigInt(fx.tx.chainId).toString();
  const block = Number(BigInt(fx.tx.blockNumber));
  let parent = null;
  if (chainId === "8141") {
    const b = await call("eth_getBlockByNumber", [
      "0x" + (block - 1).toString(16),
      false,
    ]);
    parent = {
      number: Number(b.number),
      timestamp: Number(b.timestamp),
      gas_limit: BigInt(b.gasLimit).toString(),
      gas_used: BigInt(b.gasUsed).toString(),
      base_fee: BigInt(b.baseFeePerGas).toString(),
    };
  }
  rows.push({
    hash: fx.tx.hash.toLowerCase(),
    chain_id: chainId,
    envelope: tx.envelope === "plain" ? "plain" : "keyed",
    block,
    payer: (fx.receipt.payer ?? "").toLowerCase(),
    client: fx.meta?.clientVersion ?? "",
    raw: hashOk ? raw : null,
    parent,
  });
}
const snapshot = {
  source: `exp-frames ${commit}, test/fixtures/chain`,
  headers: `${rpc}, eth_getBlockByNumber, read ${new Date()
    .toISOString()
    .slice(0, 10)}`,
  fixtures: rows,
};
writeFileSync(out, JSON.stringify(snapshot, null, 1) + "\n");
console.log(
  `${rows.length} fixtures, ${
    rows.filter((r) => r.raw === null).length
  } whose bytes do not hash to the chain's`
);
