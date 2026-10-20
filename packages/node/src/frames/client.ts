/**
 * The execution client a frame surface asks (emem `docs/spec/11-surface.md`):
 * the head, the accounts a pool's dependencies name, its verdict on a prefix
 * (SF-4) and its own pool for hand-off (SF-9). Plain JSON-RPC over fetch.
 */
import { ClientAnswer, keccak256 } from "@skandha/framepool/lib/index.js";

/** EIP-8250's nonce manager on the Hegota testnet's pin, which keeps keyed sequences in storage. */
export const NONCE_MANAGER = "0x0000000000000000000000000000000000008250";

export interface ClientHead {
  number: number;
  hash: string;
  timestamp: number;
  gasLimit: bigint;
  gasUsed: bigint;
  baseFee: bigint;
}

export interface ClientAccount {
  nonceSeqs: Map<bigint, bigint>; // key 0 is the account nonce
  balance: bigint;
  code: string; // 0x-prefixed runtime code, "" for none
}

export class RpcFailure extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

const pad32 = (hex: string): string => hex.replace(/^0x/, "").padStart(64, "0");

/** EIP-8250 at the testnet's pin: the slot is keccak256(abi.encode(sender, key)). */
export function keyedNonceSlot(sender: string, key: bigint): string {
  const data = Buffer.from(pad32(sender) + pad32(key.toString(16)), "hex");
  return "0x" + Buffer.from(keccak256(data)).toString("hex");
}

export class FrameClient {
  private id = 0;

  constructor(readonly url: string) {}

  async call<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
    });
    const body = (await res.json()) as {
      result?: T;
      error?: { code: number; message: string };
    };
    if (body.error !== undefined)
      throw new RpcFailure(body.error.code, body.error.message);
    return body.result as T;
  }

  async head(tag: string | number = "latest"): Promise<ClientHead> {
    const ref = typeof tag === "number" ? "0x" + tag.toString(16) : tag;
    const b = await this.call<Record<string, string>>("eth_getBlockByNumber", [
      ref,
      false,
    ]);
    return {
      number: Number(b.number),
      hash: b.hash,
      timestamp: Number(b.timestamp),
      gasLimit: BigInt(b.gasLimit),
      gasUsed: BigInt(b.gasUsed),
      baseFee: BigInt(b.baseFeePerGas ?? "0x0"),
    };
  }

  /** The account at `block`, with the sequences of `keys` (MD-2, MD-3). */
  async account(
    address: string,
    keys: readonly bigint[],
    block: string
  ): Promise<ClientAccount> {
    const [nonce, balance, code] = await Promise.all([
      this.call<string>("eth_getTransactionCount", [address, block]),
      this.call<string>("eth_getBalance", [address, block]),
      this.call<string>("eth_getCode", [address, block]),
    ]);
    const nonceSeqs = new Map<bigint, bigint>([[BigInt(0), BigInt(nonce)]]);
    await Promise.all(
      keys
        .filter((k) => k !== BigInt(0))
        .map(async (k) => {
          const v = await this.call<string>("eth_getStorageAt", [
            NONCE_MANAGER,
            keyedNonceSlot(address, k),
            block,
          ]);
          nonceSeqs.set(k, BigInt(v));
        })
    );
    return {
      nonceSeqs,
      balance: BigInt(balance),
      code: code === "0x" ? "" : code.toLowerCase(),
    };
  }

  /** SF-4: the client's answer for the prefix at `block`. */
  async simulate(
    raw: string,
    block: string
  ): Promise<ClientAnswer & { text: string }> {
    try {
      const r = await this.call<{ valid: boolean; violation: string | null }>(
        "ethrex_simulateFrameTransaction",
        [raw, block]
      );
      return {
        valid: r.valid,
        violation: r.violation,
        text: r.valid ? "valid" : r.violation ?? "",
      };
    } catch (err) {
      // A refusal of the call itself, an RPC error, is an answer SF-4 cannot map.
      const text = err instanceof Error ? err.message : String(err);
      return { valid: false, violation: text, text };
    }
  }

  /** SF-9: hand the bytes to the client's own pool; its answer, a hash or an error. */
  async send(raw: string): Promise<{ hash?: string; error?: string }> {
    try {
      return { hash: await this.call<string>("eth_sendRawTransaction", [raw]) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}
