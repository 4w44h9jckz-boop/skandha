/**
 * Plays exp-mempool-l2s's conformance vectors against this package, as exp-mempool-l2s's
 * `conformance/run.py` plays them against its reference. It reads vectors and
 * never writes them: there is no regeneration mode.
 *
 * A case is played when this package has everything it uses, and skipped
 * otherwise with what it needs. Which is decided from the case's contents,
 * never from a list of names (exp-mempool-l2s decision record 0035).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Dependency,
  EIP_8141,
  FOCIL_PROFILES,
  FocilConfig,
  Frame,
  FramePool,
  FramePoolConfig,
  FrameTx,
  Head,
  PROFILES,
  Read,
  Reserver,
  RootReference,
  Claim,
  Descriptor,
  DescriptorError,
  Signature,
  StandardPool,
  Store,
  canonical as canonicalDescriptor,
  compileConfig,
  State,
  TicketClaim,
  TicketFrame,
  Wrapper,
  Tx,
  Surface,
  SURFACE_PROFILES,
  TxError,
  Write,
  addressForm,
  admitted,
  buildIl,
  builderOrder,
  carriedTicket,
  decode,
  replay,
  verdict,
  floorDataGas,
  omission,
  frame,
  intrinsicGas,
  nextBaseFee,
  receive,
  recentroots,
  signature,
  ticketMessage,
  ticketValid,
  union,
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
        `${path} differs from exp-mempool-l2s ${VECTORS_COMMIT}; vectors are never edited here`
      );
    files.push(path);
  }
  return files;
}

// --- the descriptors on disk (exp-mempool-l2s `docs/spec/descriptors/`) ------------------

const DESCRIPTORS = new URL("./descriptors/", import.meta.url).pathname;
const DESCRIPTOR_MANIFEST = new URL("./descriptors.sha256", import.meta.url)
  .pathname;
const SPEC_DESCRIPTORS = "docs/spec/descriptors/";

/** A descriptor file as copied with the vectors, by its path in exp-mempool-l2s; throws if it was changed since. */
export function descriptorText(path: string): string {
  if (!path.startsWith(SPEC_DESCRIPTORS))
    throw new Error(`not a descriptor of exp-mempool-l2s: ${path}`);
  const name = path.slice(SPEC_DESCRIPTORS.length);
  const sums = new Map(
    readFileSync(DESCRIPTOR_MANIFEST, "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split(/\s+/).reverse() as [string, string])
  );
  const text = readFileSync(join(DESCRIPTORS, name));
  if (createHash("sha256").update(text).digest("hex") !== sums.get(name))
    throw new Error(
      `${path} differs from exp-mempool-l2s ${VECTORS_COMMIT}; descriptors are never edited here`
    );
  return text.toString("utf8");
}

/** DS-8: `docs/spec/descriptors/<name>.json`, loaded after the descriptors it inherits from. */
const loadedDescriptors = new Map<string, Descriptor>();
export function descriptor(name: string): Descriptor {
  if (loadedDescriptors.size === 0) {
    const store = new Store();
    const pending = readFileSync(DESCRIPTOR_MANIFEST, "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split(/\s+/)[1])
      .sort();
    while (pending.length > 0) {
      const i = pending.findIndex((file) => {
        const parent = JSON.parse(
          descriptorText(SPEC_DESCRIPTORS + file)
        ).parent;
        return parent === null || store.held.has(parent);
      });
      if (i < 0) throw new Error(`no parent held for ${pending}`);
      const [file] = pending.splice(i, 1);
      loadedDescriptors.set(
        file.replace(/\.json$/, ""),
        store.load(descriptorText(SPEC_DESCRIPTORS + file))
      );
    }
  }
  const d = loadedDescriptors.get(name);
  if (d === undefined) throw new Error(`no descriptor ${name}`);
  return d;
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
  "stake",
  "unstake_delay",
  "withdrawing",
];

/** Field-wise merge of an account map over a state (exp-mempool-l2s `conformance/README.md`). */
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
      else if (key === "stake") acc.stake = big(value);
      else if (key === "unstake_delay") acc.unstakeDelay = big(value);
      else if (key === "withdrawing") acc.withdrawing = value;
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
      x.map(
        ([a, s, v, assoc]): Read =>
          assoc === undefined
            ? [a, big(s), bigOrNull(v)]
            : [a, big(s), bigOrNull(v), assoc]
      )
    ),
    writes: opt("writes", (x: Json[]) =>
      x.map(
        ([a, s, v, assoc]): Write =>
          assoc === undefined ? [a, big(s), big(v)] : [a, big(s), big(v), assoc]
      )
    ),
    calls: d.calls,
    installsCode: d.installs_code,
    deadline: opt("deadline", big),
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
  "zero_bytes",
  "verdict",
  "claim",
];

const CLAIM_FIELDS = [
  "sender",
  "nonce_keys",
  "nonce_seq",
  "epoch",
  "valid",
  "salt",
];

function makeClaim(d: Record<string, Json>): Claim {
  only(d, CLAIM_FIELDS, "claim");
  return {
    sender: d.sender,
    nonceKeys: (d.nonce_keys ?? [0]).map(big),
    nonceSeq: big(d.nonce_seq),
    epoch: num(d.epoch),
    valid: d.valid ?? true,
    salt: d.salt ?? "",
  };
}

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
    zeroBytes: d.zero_bytes === undefined ? undefined : num(d.zero_bytes),
    verdict: d.verdict,
    claim: d.claim === undefined ? undefined : makeClaim(d.claim),
  });
}

/** AG-5; `deps`, `proofs` and `stark` default to an honest wrapper's (`conformance/README.md`). */
function makeWrapper(d: Json): Wrapper {
  const entries: (FrameTx | string)[] = [];
  const txs: FrameTx[] = [];
  for (const t of d.txs) {
    const tx = makeFrameTx("hash" in t ? t.hash : t);
    entries.push("hash" in t ? tx.hash : tx);
    txs.push(tx);
  }
  const deps = d.deps !== undefined ? makeDeps(d.deps) : union(txs);
  const stark =
    d.mode === 0
      ? null
      : {
          covers:
            d.stark?.covers !== undefined ? makeDeps(d.stark.covers) : deps,
          valid: d.stark?.valid ?? true,
        };
  return {
    txs: entries,
    mode: d.mode,
    deps,
    proofs: d.mode === 0 ? d.proofs ?? deps.map(() => true) : [],
    stark,
    signed: d.signed ?? [],
  };
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

/** The IL-1 profile a case names, with its `focil` overrides, written with IL-1's parameter names. */
function focilConfig(c: Json): FocilConfig {
  const profile = FOCIL_PROFILES.get(c.focil ?? "off");
  if (profile === undefined)
    throw new Error(`unknown focil profile ${c.focil}`);
  const changes: Record<string, Json> = {};
  for (const [snake, value] of Object.entries(c.config?.focil ?? {})) {
    const key = snake.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
    if (!(key in profile)) throw new Error(`unknown focil parameter ${snake}`);
    changes[key] =
      key === "maxVerifyGasPerIl" || key === "maxVerifyGasPerTx"
        ? big(value)
        : value;
  }
  return { ...profile, ...changes } as FocilConfig;
}

// --- what a case needs --------------------------------------------------------------

const STEP_NEEDS: Readonly<Record<string, string>> = {
  aggregate: "an aggregator (AG-7 to AG-9)",
  build: "block building (03-block-building.md)",
  expect_state: "block building (03-block-building.md)",
  expect_selection: "the sealed pool (06-lucid.md)",
};

/** Profiles of exp-mempool-l2s's specification this package does not have, with where each is specified. */
const PROFILE_NEEDS: Readonly<Record<string, string>> = {};

/** What this package lacks to play `c`, as a sorted list; empty when it can play it. */
export function needs(operation: string, c: Json): string[] {
  const out = new Set<string>();
  if (operation === "ticket_fee") out.add("the sealed pool (06-lucid.md)");
  if (operation !== "pool" && operation !== "surface" && operation !== "replay")
    return [...out];
  if (c.profile !== undefined && !PROFILES.has(c.profile))
    out.add(PROFILE_NEEDS[c.profile] ?? `the ${c.profile} profile`);
  if (operation !== "pool") return [...out].sort();
  if (c.sealed !== undefined && c.sealed !== "off")
    out.add("the sealed pool (06-lucid.md)");
  if (Object.keys(c.config?.sealed ?? {}).length > 0)
    out.add("a sealed configuration");
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
  const loaded = c.descriptor !== undefined ? descriptor(c.descriptor) : null;
  const profile =
    loaded !== null
      ? compileConfig(loaded)
      : PROFILES.get(c.profile ?? EIP_8141.name);
  if (profile === undefined) throw new Error(`unknown profile ${c.profile}`);
  const cfg = frameConfig(profile, c.config?.frame ?? {});
  const headD = { ...DEFAULT_HEAD, ...(c.head ?? {}) };
  let head = makeHead(headD);
  let state = mergeState(null, c.state);
  writeRoots(state, cfg, c.roots);
  const pool =
    cfg.ruleset === "erc-8421"
      ? new StandardPool(head, state, cfg, new Reserver())
      : new FramePool(head, state, cfg, new Reserver());
  for (const [addr, r] of Object.entries(c.reputation ?? {}))
    (pool as StandardPool).give(
      addr,
      num((r as Json).seen),
      num((r as Json).included)
    ); // AM-13
  let now = 0;
  c.steps.forEach((step: Json, n: number) => {
    const where = `step ${n}:`;
    if ("add" in step) {
      now = step.now ?? now;
      const got = pool.add(step.add.map(makeFrameTx), now);
      if ("expect" in step) same(step.expect, got, `${where} add`);
      if (loaded !== null) {
        // DS-7: every refusal names a rule of the loaded descriptor
        const rules = got.map((code) =>
          code === "ok" ? null : loaded.ruleOf(code)
        );
        if (got.some((code, i) => code !== "ok" && rules[i] === null))
          throw new Mismatch(
            `${where} a refusal names no rule of ${loaded.id}: ${got}`
          );
        if ("expect_rules" in step)
          same(step.expect_rules, rules, `${where} rules`);
      }
    } else if ("reputation" in step) {
      // AM-13
      same(
        step.expect,
        (pool as StandardPool).reputation(step.reputation),
        `${where} reputation of ${step.reputation}`
      );
    } else if ("wrapper" in step) {
      now = step.now ?? now;
      const got = receive(pool, makeWrapper(step.wrapper), now);
      if ("expect" in step) same(step.expect, got, `${where} wrapper`);
    } else if ("reset" in step) {
      now = step.now ?? now;
      Object.assign(headD, step.reset.head ?? {});
      head = makeHead(headD);
      state = mergeState(state, step.reset.state);
      writeRoots(state, cfg, step.reset.roots);
      const byLabel = new Map(
        [...pool.content().values()].flat().map((tx) => [label(tx), tx.hash])
      );
      const verdicts = new Map<string, string>(
        Object.entries(step.reset.verdicts ?? {}).map(([l, v]) => [
          byLabel.get(l) as string,
          v as string,
        ])
      ); // MD-8
      pool.reset(head, state, now, verdicts);
    } else if ("il" in step) {
      const focil = focilConfig(c);
      const baseFee =
        step.il.base_fee !== undefined ? big(step.il.base_fee) : undefined;
      same(
        step.expect,
        buildIl(pool, focil, baseFee).map(label),
        `${where} il`
      );
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

/** Every key `want` names must match; a null expects the field absent. */
function partial(want: Json, got: Json, where: string): void {
  if (want !== null && typeof want === "object" && !Array.isArray(want)) {
    if (got === null || typeof got !== "object")
      throw new Mismatch(`${where} expected an object, got ${String(got)}`);
    for (const [k, v] of Object.entries(want))
      partial(v, got[k], `${where}.${k}`);
  } else if (
    Array.isArray(want) &&
    want.length > 0 &&
    typeof want[0] === "object"
  ) {
    if (!Array.isArray(got) || got.length !== want.length)
      throw new Mismatch(`${where} expected ${want.length} entries`);
    want.forEach((w, i) => partial(w, got[i], `${where}[${i}]`));
  } else same(want, got ?? null, where);
}

/** SF-3's model transaction, in the vectors' names. */
function modelJson(tx: FrameTx): Json {
  return {
    sender: tx.sender,
    nonce_keys: [...tx.nonceKeys],
    nonce_seq: tx.nonceSeq,
    tip: tx.tip,
    max_fee: tx.maxFee,
    size: tx.size,
    zero_bytes: tx.zeroBytes,
    frames: tx.frames.map((f) => ({
      mode: f.mode,
      flags: f.flags,
      target: f.target,
      exec_gas: f.execGas,
      state_gas: f.stateGas,
      value: f.value,
      data_size: f.dataSize,
      deadline: f.deadline,
      roots: f.roots.map((r) => [...r]),
    })),
    signatures: tx.signatures.map((s) => ({
      scheme: s.scheme,
      signer: s.signer,
      canonical_msg: s.canonicalMsg,
      valid: s.valid,
      length: s.length,
    })),
    claim:
      tx.claim === null
        ? null
        : { epoch: tx.claim.epoch, salt: tx.claim.salt, valid: tx.claim.valid },
  };
}

const answerOf = (
  a: Json
): { valid: boolean; violation?: string } | undefined =>
  a === undefined ? undefined : { valid: a.valid, violation: a.violation };

/** exp-mempool-l2s `docs/spec/11-surface.md`: one node's surface over the pool of `runPool`. */
function runSurface(c: Json): void {
  const name = c.profile ?? EIP_8141.name;
  const profile = PROFILES.get(name);
  const base = SURFACE_PROFILES.get(name);
  if (profile === undefined || base === undefined)
    throw new Error(`unknown profile ${name}`);
  const cfg = addressForm(frameConfig(profile, c.config?.frame ?? {}));
  const sc = c.config?.surface ?? {};
  const scfg = {
    ...base,
    ...(sc.envelope !== undefined ? { envelope: sc.envelope } : {}),
    ...(sc.chain_id !== undefined ? { chainId: big(sc.chain_id) } : {}),
    ...(sc.max_tx_size !== undefined ? { maxTxSize: num(sc.max_tx_size) } : {}),
    ...(sc.relay !== undefined ? { relay: sc.relay } : {}),
    ...(sc.handoff !== undefined ? { handoff: sc.handoff } : {}),
  };
  const headD = { ...DEFAULT_HEAD, ...(c.head ?? {}) };
  let state = mergeState(null, c.state);
  const pool = new FramePool(makeHead(headD), state, cfg, new Reserver());
  const codes = new Map<string, Uint8Array>( // SF-3's `claim`
    Object.entries(c.codes ?? {}).map(([a, code]) => [
      a.toLowerCase(),
      Buffer.from((code as string).slice(2), "hex"),
    ])
  );
  const node = new Surface(pool, scfg, c.peers ?? [], codes);
  const focil = focilConfig(c);
  const named = new Map<string, FrameTx>(
    Object.entries(c.txs ?? {}).map(([l, raw]) => [
      l,
      decode(Buffer.from((raw as string).slice(2), "hex"), cfg, scfg, codes),
    ])
  );
  const byLabels = (labels: string[]): FrameTx[] =>
    labels.map((l) => named.get(l) as FrameTx);
  const alias = new Map<string, string>();
  const names = (hashes: string[]): string[] =>
    hashes.map((h) => [...alias].find(([, x]) => x === h)?.[0] ?? h);
  let now = 0;
  c.steps.forEach((step: Json, n: number) => {
    const where = `step ${n}:`;
    now = step.now ?? now;
    if ("decode" in step) {
      let got: Json;
      try {
        const tx = decode(
          Buffer.from(step.decode.slice(2), "hex"),
          cfg,
          scfg,
          codes
        );
        got = {
          result: "ok",
          hash: tx.label,
          tx: modelJson(tx),
          gas: { max_gas: tx.maxGas, max_cost: tx.maxCost },
        };
      } catch (err) {
        if (!(err instanceof TxError)) throw err;
        got = { result: err.code };
      }
      partial(step.expect, got, `${where} decode`);
    } else if ("verdict" in step) {
      same(
        step.expect,
        verdict(answerOf(step.verdict) as { valid: boolean }),
        `${where} verdict`
      );
    } else if ("rpc" in step || "peer" in step) {
      let got: Json;
      try {
        got =
          "rpc" in step
            ? node.rpc(step.rpc, answerOf(step.client), now)
            : node.peer(step.peer, step.from, answerOf(step.client), now);
      } catch (err) {
        throw new Mismatch(
          `${where} ${err instanceof Error ? err.message : err}`
        );
      }
      if ("as" in step) {
        const raw = Buffer.from((step.rpc ?? step.peer).slice(2), "hex");
        alias.set(
          step.as,
          (got.hash as string) ?? decode(raw, cfg, scfg).label
        );
      }
      partial(step.expect, got, where);
    } else if ("head" in step) {
      Object.assign(headD, step.head);
      state = mergeState(state, step.state);
      const answers = new Map(
        Object.entries(step.client ?? {}).map(([k, v]) => [
          alias.get(k) ?? k,
          answerOf(v) as { valid: boolean },
        ])
      );
      let asked: string[];
      try {
        asked = node.head(makeHead(headD), state, answers, now);
      } catch (err) {
        throw new Mismatch(
          `${where} ${err instanceof Error ? err.message : err}`
        );
      }
      if ("expect_asked" in step)
        same(step.expect_asked, names(asked), `${where} asked`);
      if ("expect_resimulated" in step)
        same(
          step.expect_resimulated,
          names(pool.resimulated.map((tx) => tx.label)),
          `${where} resimulated`
        );
      if ("expect_pending" in step)
        same(step.expect_pending, names(node.pending()), `${where} pending`);
    } else if ("il" in step) {
      const baseFee =
        step.il.base_fee !== undefined ? big(step.il.base_fee) : undefined;
      const got = names(buildIl(pool, focil, baseFee).map((tx) => tx.label));
      same(step.expect, got, `${where} il`);
    } else if ("inclusion" in step) {
      const inc = step.inclusion;
      const ils = (inc.ils as string[][]).map(byLabels);
      let delivered: FrameTx[] | undefined;
      if (inc.delivered !== undefined) {
        const all = [...new Set((inc.ils as string[][]).flat())].sort();
        if (JSON.stringify([...inc.delivered].sort()) !== JSON.stringify(all))
          throw new Mismatch(
            `${where} delivered is not the ILs' transactions, each once`
          );
        delivered = byLabels(inc.delivered);
      }
      const labelOf = new Map([...named].map(([l, tx]) => [tx.hash, l]));
      const got = admitted(ils, pool.head, cfg, focil, delivered).map(
        (h) => labelOf.get(h) as string
      );
      if ("expect_admitted" in step)
        same(step.expect_admitted, got, `${where} admitted`);
      if (inc.block !== undefined) {
        const valid = new Set(byLabels(inc.valid ?? []).map((tx) => tx.hash));
        const missing = omission(
          byLabels(inc.block),
          big(inc.gas_left),
          ils,
          pool.head,
          cfg,
          focil,
          valid,
          delivered
        );
        same(
          step.expect_omission ?? null,
          missing === null ? null : (labelOf.get(missing.hash) as string),
          `${where} omission`
        );
      }
    } else {
      throw new Error(`${where} unknown step ${Object.keys(step).sort()}`);
    }
  });
}

/** exp-mempool-l2s `docs/spec/12-replay.md`: one fixture under one profile. */
function runReplay(c: Json): void {
  const name = c.profile ?? EIP_8141.name;
  const profile = PROFILES.get(name);
  const base = SURFACE_PROFILES.get(name);
  if (profile === undefined || base === undefined)
    throw new Error(`unknown profile ${name}`);
  const cfg = addressForm(frameConfig(profile, c.config?.frame ?? {}));
  const sc = c.config?.surface ?? {};
  const scfg = {
    ...base,
    ...(sc.envelope !== undefined ? { envelope: sc.envelope } : {}),
    ...(sc.chain_id !== undefined ? { chainId: big(sc.chain_id) } : {}),
  };
  const f = c.fixture;
  const parent =
    f.parent === null
      ? null
      : {
          number: num(f.parent.number),
          timestamp: num(f.parent.timestamp),
          gasLimit: big(f.parent.gas_limit),
          gasUsed: big(f.parent.gas_used),
          baseFee: big(f.parent.base_fee),
        };
  const got = replay(
    Buffer.from(f.raw.slice(2), "hex"),
    f.hash,
    f.payer,
    parent,
    cfg,
    scfg
  );
  partial(c.expect, got, "replay");
}

/** exp-mempool-l2s `docs/spec/10-claim-gated-admission.md`, CG-8 to CG-10. */
function runClaimTicket(c: Json): void {
  const hex = (s: string): Uint8Array => Buffer.from(s.slice(2), "hex");
  const ticketClaim = (d: Json): TicketClaim => ({
    chainId: BigInt(d.chain_id),
    epoch: BigInt(d.epoch ?? "0x0"),
    sender: hex(d.sender),
    nonceSeq: BigInt(d.nonce_seq),
    nonceKeys: d.nonce_keys.map((k: string) => BigInt(k)),
    salt: hex(d.salt ?? "0x"),
  });
  if (c.frames !== undefined) {
    // CG-10
    const codes = new Map<string, Uint8Array>(
      Object.entries(c.codes).map(([a, code]) => [
        a.toLowerCase(),
        hex(code as string),
      ])
    );
    const frames: TicketFrame[] = c.frames.map((f: Json) => ({
      mode: f.mode,
      target: f.target.toLowerCase(),
      data: hex(f.data),
    }));
    const t = carriedTicket(ticketClaim(c.tx), frames, codes);
    const got: Json =
      t === null
        ? { claim: null }
        : {
            claim: {
              epoch: t.epoch === null ? null : "0x" + t.epoch.toString(16),
              salt:
                t.salt === null
                  ? null
                  : "0x" + Buffer.from(t.salt).toString("hex"),
              issuer: "0x" + Buffer.from(t.issuer).toString("hex"),
            },
            valid: t.valid,
          };
    same(c.expect, got, "claim_ticket");
    return;
  }
  const claim = ticketClaim(c.claim);
  const m = ticketMessage(claim);
  const got: Json = {
    message: m === null ? null : "0x" + Buffer.from(m).toString("hex"),
  };
  if (c.issuer !== undefined)
    got.valid = ticketValid(claim, hex(c.issuer), hex(c.signature));
  same(c.expect, got, "claim_ticket");
}

/** A descriptor of a case's `store`, or the one it loads: a file of exp-mempool-l2s, or a value. */
function loadItem(store: Store, item: Json): Descriptor {
  if (Object.keys(item).length === 1 && "file" in item)
    return store.load(descriptorText(item.file));
  return store.load(JSON.stringify(item));
}

/** FP-1, AG-1, CG-1 and AM-1's parameters of a profile, in their names. */
function configJson(cfg: Json): Json {
  return Object.fromEntries(
    Object.entries(cfg).map(([k, v]) => [
      k.replace(/[A-Z]/g, (ch) => "_" + ch.toLowerCase()),
      v instanceof Set ? [...v] : v,
    ])
  );
}

/** exp-mempool-l2s `docs/spec/13-descriptors.md`: load a descriptor after the case's `store`, and what it compiles to. */
function runDescriptor(c: Json): void {
  const store = new Store();
  for (const item of c.store ?? []) loadItem(store, item);
  let got: Json;
  try {
    const d =
      c.text !== undefined
        ? store.load(c.text)
        : c.descriptor !== undefined
        ? loadItem(store, c.descriptor)
        : loadItem(store, { file: c.file });
    const cfg = compileConfig(d);
    got = {
      result: "ok",
      canonical: canonicalDescriptor(d.value),
      id: d.id,
      modules: d.effective.size,
      set_by: Object.fromEntries(
        [...d.effective].map(([name, [, by]]) => [name, by])
      ),
      profile: cfg.name,
      config: configJson(cfg),
    };
  } catch (err) {
    if (!(err instanceof DescriptorError)) throw err;
    got = { result: err.code, rule: err.rule };
  }
  partial(c.expect, got, "descriptor");
}

export const OPERATIONS: Readonly<Record<string, (c: Json) => void>> = {
  next_base_fee: runNextBaseFee,
  intrinsic_gas: runIntrinsicGas,
  frame_gas: runFrameGas,
  pool: runPool,
  surface: runSurface,
  replay: runReplay,
  claim_ticket: runClaimTicket,
  descriptor: runDescriptor,
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
