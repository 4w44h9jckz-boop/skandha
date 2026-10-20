/**
 * The surface around the frame pool: exp-mempool-l2s `docs/spec/11-surface.md`, SF-1 to
 * SF-9. Bytes in (SF-2, SF-3), a client's verdict on the prefix (SF-4),
 * answers over JSON-RPC (SF-5), relay to peers and what is taken from them
 * (SF-6, SF-7), head changes (SF-8) and hand-off to a client (SF-9).
 *
 * The client and the network are not here. `prepare` decodes and runs FP-2
 * to FP-7; a caller that gets past it asks its client, then `admit` takes the
 * answer. `rpc` and `peer` do both at once with an answer already in hand,
 * which is how exp-mempool-l2s's vectors drive them.
 */
import * as E from "./errors.js";
import { TxError } from "./errors.js";
import { FramePoolConfig, withChanges } from "./config.js";
import { keccak256 } from "./keccak.js";
import { Head, State } from "./model.js";
import { FramePool } from "./pool.js";
import {
  Frame,
  FrameTx,
  RootReference,
  Signature,
  frame,
  signature,
} from "./tx.js";

export const FRAME_TX_TYPE = 0x06;
const SCHEMES: Readonly<Record<number, string>> = {
  0: "arbitrary",
  1: "secp256k1",
  2: "p256",
};
/** SF-3: any other length is malformed, so the signature is not valid. */
const SIGNATURE_LENGTH: Readonly<Record<string, number>> = {
  secp256k1: 65,
  p256: 128,
};
const U64 = 1n << 64n;
const U256 = 1n << 256n;
export const INVALID_PARAMS = -32602; // SF-5
export const SERVER_ERROR = -32000;

/** SF-1. */
export interface SurfaceConfig {
  readonly envelope: "keyed" | "plain";
  readonly chainId: bigint;
  readonly maxTxSize: number;
  readonly relay: "eth" | "gossipsub";
  readonly handoff: boolean;
}

const BASE: SurfaceConfig = {
  envelope: "keyed",
  chainId: 1n,
  maxTxSize: 131072,
  relay: "eth",
  handoff: false,
};

export const SURFACE_PROFILES: ReadonlyMap<string, SurfaceConfig> = new Map([
  ["eip-8141", BASE],
  ["hegota-testnet", { ...BASE, chainId: 8141n }],
]);

/** SF-3: the profile's distinguished address in the form the surface writes addresses in. */
export function addressForm(cfg: FramePoolConfig): FramePoolConfig {
  return withChanges(cfg, {
    expiryVerifier: cfg.expiryVerifier.toLowerCase(),
    recentRootAddress: cfg.recentRootAddress.toLowerCase(),
  });
}

// --- canonical RLP, SF-2 step 3 ------------------------------------------------------

class Malformed extends Error {}

type Item = Uint8Array | Item[];

function length(b: Uint8Array, i: number, n: number): number {
  if (i + n > b.length || b[i] === 0) throw new Malformed("length");
  let v = 0;
  for (let k = 0; k < n; k++) v = v * 256 + b[i + k];
  if (v <= 55) throw new Malformed("long form for a short length");
  return v;
}

/** One RLP item at `i`, and the index after it. */
export function rlpItem(b: Uint8Array, i: number): [Item, number] {
  if (i >= b.length) throw new Malformed("truncated");
  const p = b[i];
  if (p < 0x80) return [b.subarray(i, i + 1), i + 1];
  let n: number;
  let start: number;
  if (p <= 0xb7) {
    n = p - 0x80;
    start = i + 1;
    if (n === 1 && start < b.length && b[start] < 0x80)
      throw new Malformed("a single byte below 0x80 with a length");
  } else if (p <= 0xbf) {
    n = length(b, i + 1, p - 0xb7);
    start = i + 1 + (p - 0xb7);
  } else {
    if (p <= 0xf7) {
      n = p - 0xc0;
      start = i + 1;
    } else {
      n = length(b, i + 1, p - 0xf7);
      start = i + 1 + (p - 0xf7);
    }
    const end = start + n;
    if (end > b.length) throw new Malformed("truncated list");
    const items: Item[] = [];
    let j = start;
    while (j < end) {
      const [item, next] = rlpItem(b, j);
      items.push(item);
      j = next;
    }
    if (j !== end) throw new Malformed("list overruns");
    return [items, end];
  }
  const end = start + n;
  if (end > b.length) throw new Malformed("truncated string");
  return [b.subarray(start, end), end];
}

function int(x: Item): bigint {
  if (!(x instanceof Uint8Array) || (x.length > 0 && x[0] === 0))
    throw new Malformed("integer");
  let v = 0n;
  for (const byte of x) v = (v << 8n) | BigInt(byte);
  return v;
}

function bytes(x: Item): Uint8Array {
  if (!(x instanceof Uint8Array)) throw new Malformed("byte string");
  return x;
}

function list(x: Item, n?: number): Item[] {
  if (!Array.isArray(x) || (n !== undefined && x.length !== n))
    throw new Malformed("list");
  return x;
}

interface Wire {
  chainId: bigint;
  nonceKeys: bigint[] | null;
  nonceSeq: bigint;
  sender: Uint8Array;
  frames: {
    mode: bigint;
    flags: bigint;
    target: Uint8Array;
    exec: bigint;
    state: bigint;
    value: bigint;
    data: Uint8Array;
  }[];
  signatures: {
    scheme: bigint;
    signer: Uint8Array;
    msg: Uint8Array;
    signature: Uint8Array;
  }[];
  tip: bigint;
  maxFee: bigint;
  blobFee: bigint;
  blobs: Uint8Array[];
}

/** SF-2 step 3: the envelope's fields, each of its kind. */
function parse(payload: Uint8Array, envelope: string): Wire {
  const [top, end] = rlpItem(payload, 0);
  if (end !== payload.length) throw new Malformed("bytes after the list");
  const fields = list(top, envelope === "keyed" ? 8 : 7);
  const keyed = envelope === "keyed";
  const [chain, keys] = keyed ? [fields[0], fields[1]] : [fields[0], null];
  const rest = fields.slice(keyed ? 2 : 1);
  const [seq, sender, frames, sigs, fees, blobs] = rest;
  const [tip, maxFee, blobFee] = list(fees, 3).map(int);
  return {
    chainId: int(chain),
    nonceKeys: keys === null ? null : list(keys).map(int),
    nonceSeq: int(seq),
    sender: bytes(sender),
    frames: list(frames).map((f) => {
      const [mode, flags, target, limits, value, data] = list(f, 6);
      const [exec, state] = list(limits, 2).map(int);
      return {
        mode: int(mode),
        flags: int(flags),
        target: bytes(target),
        exec,
        state,
        value: int(value),
        data: bytes(data),
      };
    }),
    signatures: list(sigs).map((s) => {
      const [scheme, signer, msg, sig] = list(s, 4);
      return {
        scheme: int(scheme),
        signer: bytes(signer),
        msg: bytes(msg),
        signature: bytes(sig),
      };
    }),
    tip,
    maxFee,
    blobFee,
    blobs: list(blobs).map(bytes),
  };
}

const zeros = (b: Uint8Array): number =>
  b.reduce((n, x) => n + (x === 0 ? 1 : 0), 0);

/** SF-2 step 5: the EIP's constraints FP-3 does not check itself. */
function malformed(t: Wire, envelope: string): boolean {
  if (t.nonceSeq >= U64 || t.chainId >= U256 || t.sender.length !== 20)
    return true;
  if (envelope === "keyed" && (t.nonceKeys ?? []).some((k) => k >= U256))
    return true;
  if (t.tip >= U256 || t.maxFee >= U256 || t.blobFee !== 0n) return true;
  let total = 0n;
  for (const f of t.frames) {
    if (f.value >= U256 || ![0, 20].includes(f.target.length)) return true;
    if (f.exec >= U64 || f.state >= U64) return true;
    total += f.exec + f.state;
  }
  if (total >= U64) return true;
  for (const s of t.signatures) {
    if (!(Number(s.scheme) in SCHEMES) || s.scheme > 2n) return true;
    if (![0, 20].includes(s.signer.length)) return true;
    if (s.scheme === 0n && s.signer.length > 0) return true;
    if (
      ![0, 32].includes(s.msg.length) ||
      (s.msg.length === 32 && zeros(s.msg) === 32)
    )
      return true;
  }
  return false;
}

export const hex = (b: Uint8Array): string =>
  "0x" + Buffer.from(b).toString("hex");

function rlpInt(x: bigint): Uint8Array {
  if (x === 0n) return Uint8Array.of(0x80);
  const h = x.toString(16);
  const b = Buffer.from(h.length % 2 ? "0" + h : h, "hex");
  return b.length === 1 && b[0] < 0x80
    ? b
    : Buffer.concat([Uint8Array.of(0x80 + b.length), b]);
}

function rlpList(items: Uint8Array[]): Uint8Array {
  const body = Buffer.concat(items);
  if (body.length <= 55)
    return Buffer.concat([Uint8Array.of(0xc0 + body.length), body]);
  const h = body.length.toString(16);
  const n = Buffer.from(h.length % 2 ? "0" + h : h, "hex");
  return Buffer.concat([Uint8Array.of(0xf7 + n.length), n, body]);
}

/**
 * SF-3: a recent-root verifier frame's tuples, `source_id(32) || uint64_be(slot) || root(32)`.
 * A slot is a number: one at or above 2^53 rounds but stays above every real slot, so RR-7 and the
 * client both still find it in the future.
 */
function rootsOf(data: Uint8Array): RootReference[] {
  if (data.length % 72 !== 0) return [];
  const out: RootReference[] = [];
  for (let i = 0; i < data.length; i += 72) {
    const slot = Number(
      Buffer.from(data.subarray(i + 32, i + 40)).readBigUInt64BE(0)
    );
    out.push([
      hex(data.subarray(i, i + 32)),
      slot,
      hex(data.subarray(i + 40, i + 72)),
    ]);
  }
  return out;
}

/** SF-3: the chain's hash, keccak256 of the bytes received. */
export function txHash(raw: Uint8Array): string {
  return hex(keccak256(raw));
}

/** SF-2 and SF-3: the model transaction, or a TxError with the first failure. */
export function decode(
  raw: Uint8Array,
  frameCfg: FramePoolConfig,
  cfg: SurfaceConfig
): FrameTx {
  if (raw.length === 0 || raw[0] !== FRAME_TX_TYPE)
    throw new TxError(E.ErrTxTypeNotSupported);
  if (raw.length > cfg.maxTxSize) throw new TxError(E.ErrOversizedData);
  let t: Wire;
  try {
    t = parse(raw.subarray(1), cfg.envelope);
  } catch (err) {
    if (err instanceof Malformed) throw new TxError(E.ErrFrameDecode);
    throw err;
  }
  if (t.blobs.length > 0) throw new TxError(E.ErrFrameBlobs);
  if (malformed(t, cfg.envelope)) throw new TxError(E.ErrFrameMalformed);
  if (t.chainId !== cfg.chainId) throw new TxError(E.ErrInvalidChainId);
  const keys = t.nonceKeys ?? [0n];
  const expiry = frameCfg.expiryVerifier.toLowerCase();
  const rootVerifier = frameCfg.recentRoots
    ? frameCfg.recentRootAddress.toLowerCase()
    : null;
  const counted: Uint8Array[] = [];
  const frames: Frame[] = t.frames.map((f) => {
    const target = f.target.length > 0 ? hex(f.target) : null;
    counted.push(f.data);
    return frame({
      mode: Number(f.mode),
      flags: Number(f.flags),
      target,
      execGas: f.exec,
      stateGas: f.state,
      value: f.value,
      dataSize: f.data.length,
      roots: target !== null && target === rootVerifier ? rootsOf(f.data) : [],
      deadline:
        target === expiry && f.data.length === 8
          ? Buffer.from(f.data).readBigUInt64BE(0)
          : null,
    });
  });
  const signatures: Signature[] = t.signatures.map((s) => {
    const scheme = SCHEMES[Number(s.scheme)];
    counted.push(s.signer, s.msg, s.signature);
    return signature({
      scheme,
      signer: s.signer.length > 0 ? hex(s.signer) : null,
      canonicalMsg: s.msg.length === 0,
      valid:
        s.signature.length === (SIGNATURE_LENGTH[scheme] ?? s.signature.length),
      length: scheme === "arbitrary" ? s.signature.length : 0,
    });
  });
  counted.push(Buffer.concat([rlpList(keys.map(rlpInt)), rlpInt(t.nonceSeq)]));
  return new FrameTx({
    sender: hex(t.sender),
    frames,
    nonceKeys: keys,
    nonceSeq: t.nonceSeq,
    signatures,
    maxFee: t.maxFee,
    tip: t.tip,
    size: raw.length,
    label: txHash(raw),
    zeroBytes: counted.reduce((n, b) => n + zeros(b), 0),
  });
}

// --- SF-4 ----------------------------------------------------------------------------

/** A client's answer for one prefix: ethrex's `ethrex_simulateFrameTransaction` result, or the part SF-4 reads. */
export interface ClientAnswer {
  readonly valid: boolean;
  readonly violation?: string | null;
}

const VERDICTS: Readonly<Record<string, string>> = {
  BannedOpcode: E.ErrFrameBannedOpcode,
  StateWriteOutsideDeploy: E.ErrFrameStateWrite,
  StorageReadNonSender: E.ErrFrameStorageReadNonSender,
  CallToNonexistentOrDelegated: E.ErrFrameCallTarget,
  DeployInstalledNoCode: E.ErrFrameDeployNoCode,
  "validation prefix frame reverted": E.ErrFramePrefixReverted,
  "validation prefix did not establish a payer": E.ErrFrameMissingApprove,
  "frame signature list does not authenticate the sender": E.ErrInvalidSender,
};

/** SF-4: a client's answer as a verdict. */
export function verdict(answer: ClientAnswer): string {
  if (answer.valid === true) return E.OK;
  const text = answer.violation ?? "";
  const named = /^([A-Za-z]+)\(.*\)$/s.exec(text);
  const key = named !== null ? named[1] : text;
  return Object.prototype.hasOwnProperty.call(VERDICTS, key)
    ? VERDICTS[key]
    : E.ErrFrameClientRefused;
}

// --- SF-5 to SF-9 ----------------------------------------------------------------------

export interface Prepared {
  readonly tx?: FrameTx; // set when the client is to be asked
  readonly hash?: string; // set when the bytes decode
  readonly result?: string; // set when SF-2 or FP-2 to FP-7 refused it
}

export interface Outcome {
  readonly result: string;
  readonly hash?: string;
  readonly asked: boolean;
  readonly relayTo: string[];
  readonly handed: boolean;
}

/** A node's surface: its pool, its peers, and what it asked, relayed and handed on. */
export class Surface {
  /** SF-6: by hash, the peers known to have it. */
  private readonly known = new Map<string, Set<string>>();
  /** The chain's hash to the model transaction, for what the pool may hold, in the order admitted. */
  readonly byHash = new Map<string, FrameTx>();
  /** SF-9: the hashes handed to the client, in order. */
  readonly handed: string[] = [];

  constructor(
    readonly pool: FramePool,
    readonly cfg: SurfaceConfig,
    readonly peers: string[] = []
  ) {}

  /** SF-2, SF-3, then FP-2 to FP-7: whether the client is to be asked. */
  prepare(raw: Uint8Array): Prepared {
    let tx: FrameTx;
    try {
      tx = decode(raw, this.pool.config, this.cfg);
    } catch (err) {
      if (err instanceof TxError) return { result: err.code };
      throw err;
    }
    try {
      this.pool.beforePrefix(tx); // the model hash covers the label, so FP-2 refuses the same bytes twice
    } catch (err) {
      if (err instanceof TxError) return { result: err.code, hash: tx.label };
      throw err;
    }
    return { tx, hash: tx.label };
  }

  /** SF-4 and `add`, with the client's answer for a prepared transaction. */
  admit(tx: FrameTx, answer: ClientAnswer, now = 0): string {
    const withVerdict = tx.withVerdict(verdict(answer));
    const result = this.pool.add([withVerdict], now)[0];
    if (result === E.OK) {
      this.byHash.set(tx.label, withVerdict);
      if (this.cfg.handoff) this.handed.push(tx.label);
    }
    return result;
  }

  /** SF-6: a peer that sent a transaction has it. */
  markKnown(hash: string, peer: string): void {
    let known = this.known.get(hash);
    if (known === undefined) this.known.set(hash, (known = new Set()));
    known.add(peer);
  }

  /** SF-6: every peer not known to have it, never the one it came from. */
  relay(hash: string, source: string | null): string[] {
    if (source !== null) this.markKnown(hash, source);
    const known = this.known.get(hash) ?? new Set<string>();
    const out = this.peers.filter((p) => !known.has(p)).sort();
    for (const p of out) this.markKnown(hash, p);
    return out;
  }

  private step(
    raw: Uint8Array,
    source: string | null,
    answer: ClientAnswer | undefined,
    now: number
  ): Outcome {
    const prepared = this.prepare(raw);
    if (prepared.tx === undefined)
      return {
        result: prepared.result as string,
        hash: prepared.hash,
        asked: false,
        relayTo: [],
        handed: false,
      };
    if (answer === undefined)
      throw new Error(
        `the client would be asked about ${prepared.hash} and no answer was given`
      );
    const result = this.admit(prepared.tx, answer, now);
    const ok = result === E.OK;
    if (source !== null) this.markKnown(prepared.hash as string, source);
    return {
      result,
      hash: prepared.hash,
      asked: true,
      relayTo: ok ? this.relay(prepared.hash as string, source) : [],
      handed: ok && this.cfg.handoff,
    };
  }

  /** SF-5, with the client's answer in hand. */
  rpc(param: unknown, answer?: ClientAnswer, now = 0): Record<string, unknown> {
    if (typeof param !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(param))
      return {
        error_code: INVALID_PARAMS,
        asked_client: false,
        relay_to: [],
        handed: false,
      };
    const o = this.step(Buffer.from(param.slice(2), "hex"), null, answer, now);
    const out: Record<string, unknown> = {
      result: o.result,
      asked_client: o.asked,
      relay_to: o.relayTo,
      handed: o.handed,
    };
    if (o.result === E.OK) out.hash = o.hash;
    else out.error_code = SERVER_ERROR;
    return out;
  }

  /** SF-7, with the client's answer in hand. */
  peer(
    raw: string,
    source: string,
    answer?: ClientAnswer,
    now = 0
  ): Record<string, unknown> {
    const o = this.step(Buffer.from(raw.slice(2), "hex"), source, answer, now);
    const atFault = gossipOutcome(o.result) === "reject";
    return {
      result: o.result,
      gossip: gossipOutcome(o.result),
      disconnect: atFault,
      asked_client: o.asked,
      relay_to: o.relayTo,
      handed: o.handed,
    };
  }

  /** The chain's hashes of what the pool holds, in the order admitted. */
  pending(): string[] {
    const held = new Set(
      [...this.pool.content().values()].flat().map((tx) => tx.hash)
    );
    return [...this.byHash]
      .filter(([, tx]) => held.has(tx.hash))
      .map(([h]) => h);
  }

  /** SF-8 steps 1 and 2: the pending transactions the new state does not show included. */
  toAsk(state: State): string[] {
    return this.pending().filter((h) => {
      const tx = this.byHash.get(h) as FrameTx;
      return !tx.nonceKeys.some(
        (k) => state.nonceSeq(tx.sender, k) > tx.nonceSeq
      );
    });
  }

  /** SF-8 step 3: reset with the answers for what `toAsk` named; returns what was asked about. */
  head(
    head: Head,
    state: State,
    answers: ReadonlyMap<string, ClientAnswer>,
    now = 0
  ): string[] {
    const asked = this.toAsk(state);
    const missing = asked.filter((h) => !answers.has(h));
    if (missing.length > 0)
      throw new Error(
        `the client would be asked about ${missing.join(
          ", "
        )} and no answer was given`
      );
    const verdicts = new Map(
      asked.map((h) => [
        (this.byHash.get(h) as FrameTx).hash,
        verdict(answers.get(h) as ClientAnswer),
      ])
    );
    this.pool.reset(head, state, now, verdicts);
    return asked;
  }
}

/** SF-7: accept what is admitted, reject bytes that are not a frame transaction, ignore any other refusal. */
export function gossipOutcome(result: string): "accept" | "reject" | "ignore" {
  if (result === E.OK) return "accept";
  if (result === E.ErrTxTypeNotSupported || result === E.ErrFrameDecode)
    return "reject";
  return "ignore";
}
