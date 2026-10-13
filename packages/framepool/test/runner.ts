/**
 * Plays emem's conformance vectors against this package, as emem's
 * `conformance/run.py` plays them against its reference. It reads vectors and
 * never writes them: there is no regeneration mode.
 *
 * A case is played when this package has everything it uses, and skipped
 * otherwise with what it needs. Which is decided from the case's contents,
 * never from a list of names (emem decision record 0035).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Dependency,
  EIP_8141,
  Frame,
  FramePool,
  FramePoolConfig,
  FrameTx,
  Head,
  PROFILES,
  Read,
  Reserver,
  RootReference,
  Signature,
  State,
  Tx,
  Write,
  builderOrder,
  floorDataGas,
  frame,
  intrinsicGas,
  nextBaseFee,
  recentroots,
  signature,
  withChanges,
} from "../src/index.js";

export class Mismatch extends Error {}

// --- JSON with integers of any size ----------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;
const QUOTE = String.fromCharCode(34); // a double quote

/** JSON.parse, except that an integer beyond 2^53 is read as a bigint rather than rounded. */
export function parseJson(text: string): Json {
  let i = 0;
  const ws = (): void => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++;
  };
  const value = (): Json => {
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      const out: Record<string, Json> = {};
      ws();
      if (text[i] === "}") return i++, out;
      for (;;) {
        ws();
        const key = string();
        ws();
        if (text[i++] !== ":") throw new SyntaxError(`expected : at ${i}`);
        out[key] = value();
        ws();
        if (text[i] === ",") i++;
        else if (text[i++] === "}") return out;
        else throw new SyntaxError(`expected , or } at ${i}`);
      }
    }
    if (c === "[") {
      i++;
      const out: Json[] = [];
      ws();
      if (text[i] === "]") return i++, out;
      for (;;) {
        out.push(value());
        ws();
        if (text[i] === ",") i++;
        else if (text[i++] === "]") return out;
        else throw new SyntaxError(`expected , or ] at ${i}`);
      }
    }
    if (c === QUOTE) return string();
    for (const [word, v] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (text.startsWith(word, i)) return (i += word.length), v;
    }
    const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
    if (m === null) throw new SyntaxError(`unexpected ${c} at ${i}`);
    i += m[0].length;
    if (m[1] === undefined && m[2] === undefined) {
      const n = BigInt(m[0]);
      return n <= BigInt(Number.MAX_SAFE_INTEGER) &&
        n >= -BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(n)
        : n;
    }
    return Number(m[0]);
  };
  const string = (): string => {
    if (text[i] !== QUOTE) throw new SyntaxError(`expected a string at ${i}`);
    let j = i + 1;
    while (text[j] !== QUOTE) j += text[j] === "\\" ? 2 : 1;
    const s = JSON.parse(text.slice(i, j + 1));
    i = j + 1;
    return s;
  };
  const out = value();
  ws();
  if (i !== text.length) throw new SyntaxError(`trailing text at ${i}`);
  return out;
}

const big = (x: Json): bigint => {
  if (typeof x === "bigint") return x;
  if (typeof x === "number" && Number.isInteger(x)) return BigInt(x);
  throw new TypeError(`not an integer: ${x}`);
};
const bigOrNull = (x: Json): bigint | null =>
  x === null || x === undefined ? null : big(x);
const num = (x: Json): number =>
  typeof x === "bigint" ? Number(x) : (x as number);

function only(
  obj: Record<string, Json>,
  allowed: readonly string[],
  what: string
): void {
  for (const key of Object.keys(obj))
    if (!allowed.includes(key)) throw new Error(`unknown ${what} field ${key}`);
}

// --- the vectors on disk ------------------------------------------------------------

export const VECTORS = new URL("./vectors/", import.meta.url).pathname;
const MANIFEST = new URL("./vectors.sha256", import.meta.url).pathname;
export const VECTORS_COMMIT = readFileSync(
  new URL("./vectors.commit", import.meta.url).pathname,
  "utf8"
).trim();

/** Every vector file with its SHA-256 as copied; throws if one was changed since. */
export function vectorFiles(): string[] {
  const files: string[] = [];
  for (const line of readFileSync(MANIFEST, "utf8").trim().split("\n")) {
    const [sum, path] = line.split(/\s+/);
    const actual = createHash("sha256")
      .update(readFileSync(join(VECTORS, path)))
      .digest("hex");
    if (actual !== sum)
      throw new Error(
        `${path} differs from emem ${VECTORS_COMMIT}; vectors are never edited here`
      );
    files.push(path);
  }
  return files;
}

export interface Vector {
  clause: string;
  operation: string;
  cases: Json[];
}

export function readVector(path: string): Vector {
  return parseJson(readFileSync(join(VECTORS, path), "utf8"));
}

// --- JSON to model ------------------------------------------------------------------

const DEFAULT_HEAD = {
  number: 0,
  timestamp: 1000,
  gas_limit: 30_000_000,
  gas_used: 15_000_000,
  base_fee: 10,
  slot: 0,
};

function makeHead(d: Record<string, Json>): Head {
  only(d, Object.keys(DEFAULT_HEAD), "head");
  return {
    number: num(d.number),
    timestamp: num(d.timestamp),
    gasLimit: big(d.gas_limit),
    gasUsed: big(d.gas_used),
    baseFee: big(d.base_fee),
    slot: num(d.slot),
  };
}

const ACCOUNT_FIELDS = [
  "nonce",
  "balance",
  "code",
  "storage",
  "nonce_seqs",
  "withdrawal",
];

/** Field-wise merge of an account map over a state (emem `conformance/README.md`). */
function mergeState(
  state: State | null,
  d: Record<string, Json> | undefined
): State {
  const fresh = state !== null ? state.copy() : new State();
  for (const [addr, fields] of Object.entries(d ?? {})) {
    only(fields, ACCOUNT_FIELDS, "account");
    const acc = fresh.edit(addr);
    for (const [key, value] of Object.entries(fields as Record<string, Json>)) {
      if (key === "storage" || key === "nonce_seqs") {
        const target = key === "storage" ? acc.storage : acc.nonceSeqs;
        for (const [k, v] of Object.entries(value as Record<string, Json>))
          target.set(BigInt(k), big(v));
      } else if (key === "code") acc.code = value;
      else if (key === "nonce") acc.nonce = big(value);
      else if (key === "balance") acc.balance = big(value);
      else acc.withdrawal = big(value);
    }
  }
  return fresh;
}

/** RR-3: entries as the writes `[source_address, salt, slot, root]` would leave them; a null root empties one. */
function writeRoots(
  state: State,
  cfg: FramePoolConfig,
  roots: Json[] | undefined
): void {
  for (const [address, salt, slot, root] of roots ?? []) {
    recentroots.writeRoot(
      state,
      cfg,
      recentroots.sourceId(address, salt),
      num(slot),
      root
    );
  }
}

const SIGNATURE_FIELDS = [
  "scheme",
  "signer",
  "canonical_msg",
  "valid",
  "length",
];

function makeSignature(d: Record<string, Json>): Signature {
  only(d, SIGNATURE_FIELDS, "signature");
  return signature({
    scheme: d.scheme,
    signer: d.signer,
    canonicalMsg: d.canonical_msg,
    valid: d.valid,
    length: d.length === undefined ? undefined : num(d.length),
  });
}

function makeDeps(triples: Json[]): Dependency[] {
  return triples.map(([scheme, dataHash, vkHash]) => ({
    scheme: num(scheme),
    dataHash,
    vkHash,
  }));
}

const FRAME_FIELDS = [
  "mode",
  "flags",
  "target",
  "exec_gas",
  "state_gas",
  "value",
  "data_size",
  "approves",
  "reverts",
  "opcodes",
  "reads",
  "writes",
  "calls",
  "installs_code",
  "deadline",
  "deps",
  "roots",
];

function makeFrame(d: Record<string, Json>): Frame {
  only(d, FRAME_FIELDS, "frame");
  const opt = <T>(key: string, f: (x: Json) => T): T | undefined =>
    d[key] === undefined ? undefined : f(d[key]);
  return frame({
    mode: num(d.mode),
    flags: opt("flags", num),
    target: d.target,
    execGas: opt("exec_gas", big),
    stateGas: opt("state_gas", big),
    value: opt("value", big),
    dataSize: opt("data_size", num),
    approves: opt("approves", num),
    reverts: d.reverts,
    opcodes: opt("opcodes", (x) => new Set<string>(x)),
    reads: opt("reads", (x: Json[]) =>
      x.map(([a, s, v]): Read => [a, big(s), bigOrNull(v)])
    ),
    writes: opt("writes", (x: Json[]) =>
      x.map(([a, s, v]): Write => [a, big(s), big(v)])
    ),
    calls: d.calls,
    installsCode: d.installs_code,
    deadline: opt("deadline", num),
    deps: opt("deps", makeDeps),
    roots: opt("roots", (x: Json[]) =>
      x.map(([s, slot, root]): RootReference => [s, num(slot), root])
    ),
  });
}

const FRAME_TX_FIELDS = [
  "type",
  "sender",
  "frames",
  "nonce_keys",
  "nonce_seq",
  "signatures",
  "max_fee",
  "tip",
  "size",
  "writes",
  "gas_used",
  "label",
  "root_writes",
];

function makeFrameTx(d: Record<string, Json>): FrameTx {
  only(d, FRAME_TX_FIELDS, "frame transaction");
  return new FrameTx({
    sender: d.sender ?? "alice",
    frames: (d.frames ?? []).map(makeFrame),
    nonceKeys: d.nonce_keys === undefined ? undefined : d.nonce_keys.map(big),
    nonceSeq: d.nonce_seq === undefined ? undefined : big(d.nonce_seq),
    signatures:
      d.signatures === undefined ? undefined : d.signatures.map(makeSignature),
    maxFee: d.max_fee === undefined ? undefined : big(d.max_fee),
    tip: d.tip === undefined ? undefined : big(d.tip),
    size: d.size === undefined ? undefined : num(d.size),
    writes:
      d.writes === undefined
        ? undefined
        : d.writes.map(([a, s, v]: Json[]): Write => [a, big(s), big(v)]),
    gasUsed: d.gas_used === undefined ? undefined : big(d.gas_used),
    label: d.label,
    rootWrites: d.root_writes,
  });
}

const TX_FIELDS = [
  "sender",
  "nonce",
  "gas",
  "max_fee",
  "tip",
  "value",
  "to",
  "type",
  "data_size",
  "size",
  "authorities",
  "delegate",
  "valid_signature",
  "gas_used",
  "writes",
  "root_writes",
  "label",
];

function makeTx(d: Record<string, Json>): Tx {
  only(d, TX_FIELDS, "transaction");
  const opt = <T>(key: string, f: (x: Json) => T): T | undefined =>
    d[key] === undefined ? undefined : f(d[key]);
  return new Tx({
    sender: d.sender ?? "alice",
    nonce: opt("nonce", big),
    gas: opt("gas", big),
    maxFee: opt("max_fee", big),
    tip: opt("tip", big),
    value: opt("value", big),
    to: d.to,
    type: opt("type", num),
    dataSize: opt("data_size", num),
    size: opt("size", num),
    authorities: opt("authorities", (x: Json[]) =>
      x.map((a) => (typeof a === "string" ? a : [a[0], big(a[1])]))
    ),
    delegate: d.delegate,
    validSignature: d.valid_signature,
    gasUsed: opt("gas_used", big),
    writes: opt("writes", (x: Json[]) =>
      x.map(([a, s, v]): Write => [a, big(s), big(v)])
    ),
    rootWrites: d.root_writes,
    label: d.label,
  });
}

const BIGINT_CONFIG = new Set([
  "maxVerifyGas",
  "maxVerifyStateGas",
  "priceLimit",
  "widthCap",
  "loadPrice",
  "expiringKey",
  "expiringNonceGas",
]);

/** The frame pool profile with `overrides`, written with FP-1's parameter names. */
function frameConfig(
  profile: FramePoolConfig,
  overrides: Record<string, Json>
): FramePoolConfig {
  const changes: Record<string, Json> = {};
  for (const [snake, value] of Object.entries(overrides)) {
    const key = snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (!(key in EIP_8141))
      throw new Error(`unknown frame pool parameter ${snake}`);
    changes[key] = BIGINT_CONFIG.has(key)
      ? bigOrNull(value)
      : key === "precompiles"
      ? new Set(value)
      : value;
  }
  return withChanges(profile, changes);
}

// --- what a case needs --------------------------------------------------------------

const STEP_NEEDS: Readonly<Record<string, string>> = {
  wrapper: "an aggregator (AG-5 to AG-9)",
  aggregate: "an aggregator (AG-5 to AG-9)",
  build: "block building (03-block-building.md)",
  expect_state: "block building (03-block-building.md)",
  il: "inclusion lists (07-focil.md)",
  expect_selection: "the sealed pool (06-lucid.md)",
};

/** What this package lacks to play `c`, as a sorted list; empty when it can play it. */
export function needs(operation: string, c: Json): string[] {
  const out = new Set<string>();
  if (operation === "ticket_fee") out.add("the sealed pool (06-lucid.md)");
  if (operation !== "pool") return [...out];
  if (c.sealed !== undefined && c.sealed !== "off")
    out.add("the sealed pool (06-lucid.md)");
  if (c.focil !== undefined && c.focil !== "off")
    out.add("inclusion lists (07-focil.md)");
  for (const part of ["sealed", "focil"]) {
    if (Object.keys(c.config?.[part] ?? {}).length > 0)
      out.add(`a ${part} configuration`);
  }
  for (const step of c.steps) {
    for (const key of Object.keys(step))
      if (key in STEP_NEEDS) out.add(STEP_NEEDS[key]);
    for (const tx of step.add ?? []) {
      if (tx.type === "st") out.add("the sealed pool (06-lucid.md)");
      else if (tx.type !== 6)
        out.add("the account-nonce pool (01-nonce-pool.md)");
    }
  }
  return [...out].sort();
}

// --- operations ---------------------------------------------------------------------

function same(want: Json, got: Json, where: string): void {
  const norm = (x: Json): string =>
    JSON.stringify(x, (_, v) =>
      typeof v === "bigint"
        ? `${v}n`
        : typeof v === "number" && Number.isInteger(v)
        ? `${v}n`
        : v
    );
  const sorted = (x: Json): Json =>
    Array.isArray(x)
      ? x.map(sorted)
      : x !== null && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, sorted(x[k])])
        )
      : x;
  if (norm(sorted(want)) !== norm(sorted(got))) {
    throw new Mismatch(`${where} expected ${norm(want)}, got ${norm(got)}`);
  }
}

function label(tx: FrameTx): string {
  return tx.label || tx.hash.slice(0, 10);
}

function runNextBaseFee(c: Json): void {
  const h = c.head;
  same(
    c.expect,
    nextBaseFee(big(h.gas_limit), big(h.gas_used), big(h.base_fee)),
    ""
  );
}

function runIntrinsicGas(c: Json): void {
  const tx = makeTx(c.tx);
  const floorCostPerToken = 10n; // NP-1's `geth` profile, `floor_cost_per_token`
  same(
    c.expect,
    { intrinsic: intrinsicGas(tx), floor: floorDataGas(tx, floorCostPerToken) },
    ""
  );
}

function runFrameGas(c: Json): void {
  const tx = makeFrameTx(c.tx);
  const g = tx.gas;
  same(
    c.expect,
    {
      intrinsic: g.intrinsic,
      floor: g.floor,
      max_gas: g.maxGas,
      max_cost: tx.maxCost,
    },
    ""
  );
}

function runPool(c: Json): void {
  const profile = PROFILES.get(c.profile ?? EIP_8141.name);
  if (profile === undefined) throw new Error(`unknown profile ${c.profile}`);
  const cfg = frameConfig(profile, c.config?.frame ?? {});
  const headD = { ...DEFAULT_HEAD, ...(c.head ?? {}) };
  let head = makeHead(headD);
  let state = mergeState(null, c.state);
  writeRoots(state, cfg, c.roots);
  const pool = new FramePool(head, state, cfg, new Reserver());
  let now = 0;
  c.steps.forEach((step: Json, n: number) => {
    const where = `step ${n}:`;
    if ("add" in step) {
      now = step.now ?? now;
      const got = pool.add(step.add.map(makeFrameTx), now);
      if ("expect" in step) same(step.expect, got, `${where} add`);
    } else if ("reset" in step) {
      now = step.now ?? now;
      Object.assign(headD, step.reset.head ?? {});
      head = makeHead(headD);
      state = mergeState(state, step.reset.state);
      writeRoots(state, cfg, step.reset.roots);
      pool.reset(head, state, now);
    } else if ("tick" in step) {
      now = step.tick;
      pool.tick(now);
    } else if ("finalize" in step) {
      now = step.now ?? now;
      const blocks = step.finalize.map(
        (b: Json): [number, Map<string, bigint>] => [
          num(b.number),
          new Map(Object.entries(b.gas ?? {}).map(([s, g]) => [s, big(g)])),
        ]
      );
      pool.finalize(blocks, now);
    } else if ("expect_width" in step) {
      const got = Object.fromEntries(
        Object.keys(step.expect_width).map((s) => [s, pool.width(s)])
      );
      same(step.expect_width, got, `${where} width`);
    } else if ("expect_load" in step) {
      const got = Object.fromEntries(
        Object.keys(step.expect_load).map((s) => [s, pool.load(s)])
      );
      same(step.expect_load, got, `${where} load`);
    } else if ("expect_baseline" in step) {
      const got = Object.fromEntries(
        Object.keys(step.expect_baseline).map((s) => {
          const h = pool.baseline(s);
          return [s, h === null ? null : label(pool.get(h) as FrameTx)];
        })
      );
      same(step.expect_baseline, got, `${where} baseline`);
    } else if ("expect_baselines" in step) {
      const got = Object.fromEntries(
        Object.keys(step.expect_baselines).map((s) => [
          s,
          pool.baselines(s).map((h) => label(pool.get(h) as FrameTx)),
        ])
      );
      same(step.expect_baselines, got, `${where} baselines`);
    } else if ("expect_pool" in step) {
      const pending = Object.fromEntries(
        [...pool.content()].map(([s, txs]) => [s, txs.map(label)])
      );
      const want = {
        pending: step.expect_pool.pending ?? {},
        queued: step.expect_pool.queued ?? {},
      };
      same(want, { pending, queued: {} }, `${where} pool`);
    } else if ("expect_view" in step) {
      const v = step.expect_view;
      const view = pool.pendingView(big(v.min_tip), big(v.base_fee));
      const got = builderOrder(view, big(v.base_fee), (tx) =>
        pool.arrival(tx.hash)
      ).map(label);
      same(step.expect, got, `${where} view`);
    } else if ("expect_resimulated" in step) {
      same(
        step.expect_resimulated,
        pool.resimulated.map(label),
        `${where} resimulated`
      );
    } else {
      throw new Error(`${where} unknown step ${Object.keys(step).sort()}`);
    }
  });
}

export const OPERATIONS: Readonly<Record<string, (c: Json) => void>> = {
  next_base_fee: runNextBaseFee,
  intrinsic_gas: runIntrinsicGas,
  frame_gas: runFrameGas,
  pool: runPool,
};

export interface Outcome {
  file: string;
  clause: string;
  name: string;
  status: "pass" | "fail" | "skip";
  detail: string;
}

/** Every case of every vector file, played or skipped. */
export function playAll(): Outcome[] {
  const out: Outcome[] = [];
  for (const file of vectorFiles()) {
    const vector = readVector(file);
    for (const c of vector.cases) {
      const missing = needs(vector.operation, c);
      const base = { file, clause: vector.clause, name: c.name };
      if (missing.length > 0) {
        out.push({ ...base, status: "skip", detail: missing.join("; ") });
        continue;
      }
      try {
        OPERATIONS[vector.operation](c);
        out.push({ ...base, status: "pass", detail: "" });
      } catch (err) {
        out.push({
          ...base,
          status: "fail",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return out;
}
