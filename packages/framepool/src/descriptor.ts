/**
 * Descriptors: a ruleset as a file a node loads, exp-mempool-l2s
 * `docs/spec/13-descriptors.md`, DS-1 to DS-7, with the modules of
 * `14-erc-8421.md`.
 *
 * A descriptor parses strictly (DS-1), has one canonical encoding (DS-2) and
 * an identifier, the base32 CIDv1 of that encoding as a raw block (DS-3). Its
 * modules are rules with fixed parameters (DS-4); it inherits its parent's
 * (DS-5); a complete ruleset (DS-6) compiles to the frame pool profile its
 * modules carry; and a refusal under it names the module that raised the code
 * and the descriptor (DS-7). exp-mempool-l2s decision record 0060.
 */
import { createHash } from "node:crypto";
import { NAMESPACE, TEMPLATE_KECCAK, TEMPLATE_LENGTH } from "./claimticket.js";
import { EIP_8141, FramePoolConfig, withChanges } from "./config.js";

const MAX_INT = 2 ** 53 - 1;
const QUOTE = String.fromCharCode(34); // a double quote
const MEMBERS = ["format", "name", "source", "parent", "rules", "remove"];

/** A node's answer when it cannot load a descriptor: a code of 13-descriptors.md, and the module it names. */
export class DescriptorError extends Error {
  constructor(readonly code: string, readonly rule: string | null = null) {
    super(rule === null ? code : `${code} ${rule}`);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Value = any;

// --- DS-1 and DS-2 --------------------------------------------------------------------

/** RFC 8259 JSON holding only what DS-1 allows; throws a SyntaxError otherwise. */
function strictJson(text: string): Value {
  let i = 0;
  const bad = (what: string): never => {
    throw new SyntaxError(`${what} at ${i}`);
  };
  const ws = (): void => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++;
  };
  const string = (): string => {
    if (text[i] !== QUOTE) bad("expected a string");
    i++;
    let out = "";
    for (;;) {
      if (i >= text.length) bad("unterminated string");
      const c = text[i++];
      if (c === QUOTE) break;
      if (c === "\\") {
        const e = text[i++];
        const simple: Record<string, string> = {
          [QUOTE]: QUOTE,
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        };
        if (e in simple) out += simple[e];
        else if (e === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(i, i + 4))) {
          out += String.fromCharCode(parseInt(text.slice(i, i + 4), 16));
          i += 4;
        } else bad("bad escape");
      } else out += c;
    }
    for (const ch of out)
      if (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) > 0x7e)
        bad("not printable ASCII");
    return out;
  };
  const value = (): Value => {
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      const out: Record<string, Value> = {};
      ws();
      if (text[i] === "}") return i++, out;
      for (;;) {
        ws();
        const key = string();
        if (Object.prototype.hasOwnProperty.call(out, key))
          bad("a member name twice");
        ws();
        if (text[i++] !== ":") bad("expected :");
        out[key] = value();
        ws();
        const sep = text[i++];
        if (sep === "}") return out;
        if (sep !== ",") bad("expected , or }");
      }
    }
    if (c === "[") {
      i++;
      const out: Value[] = [];
      ws();
      if (text[i] === "]") return i++, out;
      for (;;) {
        out.push(value());
        ws();
        const sep = text[i++];
        if (sep === "]") return out;
        if (sep !== ",") bad("expected , or ]");
      }
    }
    if (c === QUOTE) return string();
    for (const [word, v] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const)
      if (text.startsWith(word, i)) return (i += word.length), v;
    const lit = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (lit === null) return bad("unexpected character");
    if (lit[2] !== undefined || lit[3] !== undefined) bad("not an integer");
    i += lit[0].length;
    const n = BigInt(lit[0]);
    if (n < 0n || n > BigInt(MAX_INT)) bad("integer out of range");
    return Number(n);
  };
  const out = value();
  ws();
  if (i !== text.length) bad("trailing text");
  return out;
}

const isObject = (v: Value): boolean =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** DS-1: the descriptor's value, or ErrDescriptorMalformed. */
export function parse(text: string): Value {
  let v: Value;
  try {
    v = strictJson(text);
  } catch {
    throw new DescriptorError("ErrDescriptorMalformed");
  }
  if (
    !isObject(v) ||
    Object.keys(v).length !== MEMBERS.length ||
    !MEMBERS.every((m) => m in v) ||
    v.format !== 1 ||
    typeof v.name !== "string" ||
    typeof v.source !== "string" ||
    !(v.parent === null || typeof v.parent === "string") ||
    !isObject(v.rules) ||
    !Object.values(v.rules).every(isObject) ||
    !Array.isArray(v.remove) ||
    !v.remove.every((r: Value) => typeof r === "string")
  )
    throw new DescriptorError("ErrDescriptorMalformed");
  return v;
}

/** DS-2: sorted members, no whitespace, only quote and backslash escaped (the value holds printable ASCII). */
export function canonical(v: Value): string {
  if (v === null || typeof v === "boolean" || typeof v === "number")
    return JSON.stringify(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(v)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
      .join(",") +
    "}"
  );
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

function base32(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let acc = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(acc << (5 - bits)) & 31];
  return out;
}

/** DS-3: "b" and the base32 CIDv1 (raw, sha2-256) of the canonical encoding. */
export function identifier(v: Value): string {
  const digest = createHash("sha256").update(canonical(v), "ascii").digest();
  return "b" + base32(new Uint8Array([0x01, 0x55, 0x12, 0x20, ...digest]));
}

// --- DS-4: the modules ----------------------------------------------------------------

type ParamType =
  | "int"
  | "int|null"
  | "bool"
  | "str"
  | "str[]"
  | "amount"
  | readonly (string | number)[];

interface Module {
  readonly params: Readonly<Record<string, ParamType>>;
  readonly kind: "core" | "rule";
  readonly codes: readonly string[];
}

const m = (
  kind: "core" | "rule",
  codes: readonly string[] = [],
  params: Record<string, ParamType> = {}
): Module => ({ kind, codes, params });

export const FRAME_POOL: Readonly<Record<string, Module>> = {
  "FP-2": m("core", ["ErrAlreadyKnown"]),
  "FP-3": m(
    "core",
    [
      "ErrFrameMalformed",
      "ErrGasLimitTooHigh",
      "ErrInvalidSender",
      "ErrTipAboveFeeCap",
      "ErrTxGasPriceTooLow",
      "ErrGasLimit",
    ],
    { price_limit: "int" }
  ),
  "FP-4": m("core"),
  "FP-5": m(
    "rule",
    [
      "ErrFrameExpiryNotFirst",
      "ErrFrameNoPayer",
      "ErrFrameAtomicInPrefix",
      "ErrFrameUnrecognizedPrefix",
      "ErrFrameVerifyAfterPrefix",
    ],
    { expiry_verifier: "str" }
  ),
  "FP-6": m("rule", ["ErrFrameVerifyGas", "ErrFrameVerifyStateGas"], {
    max_verify_gas: "int",
    max_verify_state_gas: "int|null",
  }),
  "FP-7": m("rule", ["ErrNonceTooLow", "ErrNonceTooHigh"]),
  "FP-8": m(
    "core",
    [
      "ErrFrameExpired",
      "ErrFramePrefixReverted",
      "ErrFrameMissingApprove",
      "ErrFrameDeployNoCode",
      "ErrInsufficientFunds",
    ],
    { expiry_margin: "int", expiry_verifier_code: "str" }
  ),
  "FP-9": m(
    "rule",
    [
      "ErrFrameBannedOpcode",
      "ErrFrameStateWrite",
      "ErrFrameStorageReadNonSender",
      "ErrFrameCallTarget",
    ],
    { canonical_paymaster_code: "str", precompiles: "str[]" }
  ),
  "FP-10": m("core"),
  "FP-11": m("rule", ["ErrFramePayerExposure", "ErrFramePaymasterBusy"], {
    max_pending_noncanonical: "int",
    cap_codeless_payers: "bool",
  }),
  "FP-12": m("rule", ["ErrReplaceUnderpriced", "ErrFrameSenderBusy"], {
    per_sender: ["one", "disjoint-keys"],
    price_bump: "int",
  }),
  "FP-13": m("core", ["ErrAlreadyReserved"]),
  "FP-14": m("core", ["ErrTxPoolOverflow"], {
    max_pending: "int",
    evict_first: ["expiry", "tip"],
  }),
  "FP-15": m("core", [], { reuse_balance: "bool" }),
  "FP-16": m("core"),
};

export const AGGREGATION: Readonly<Record<string, Module>> = {
  "AG-2": m("rule", ["ErrDepFrameMalformed"], {
    max_dependencies_per_frame: "int",
  }),
  "AG-3": m("rule"),
  "AG-4": m("rule", ["ErrFrameTooManyDeps"], {
    max_sigs_per_tx: "int",
    max_starks_per_tx: "int",
  }),
  "AG-5": m(
    "rule",
    [
      "ErrWrapperMalformed",
      "ErrWrapperUnknownTx",
      "ErrWrapperDeps",
      "ErrWrapperTooManyDeps",
      "ErrWrapperProof",
    ],
    { max_sig_deps_per_wrapper: "int", max_stark_deps_per_wrapper: "int" }
  ),
  "AG-6": m("rule", ["ErrFrameDepsUnproven"]),
  "AG-7": m("rule", [], {
    aggregation_interval_ms: "int",
    cap_aggregates: "bool",
    forward_wrappers: "bool",
  }),
  "AG-8": m("rule"),
};

export const CLAIMS: Readonly<Record<string, Module>> = {
  "CG-2": m(
    "rule",
    [
      "ErrClaimMissing",
      "ErrClaimInvalid",
      "ErrClaimWrongSlot",
      "ErrClaimEpoch",
    ],
    { claim_epoch: "int" }
  ),
  "CG-3": m("rule", ["ErrProofUnsigned"], { signed_proofs: "bool" }),
  "CG-4": m("rule", ["ErrSlotRefused", "ErrClaimRefused"], {
    claim_memory: ["slot", "claim", "none"],
  }),
  "CG-5": m("rule", ["ErrClaimUsed"]),
  "CG-6": m("rule", ["ErrClaimExpired"]),
  "CG-7": m("rule", ["ErrRelayAggregate"], { verifies: "bool" }),
  "CG-8": m("rule", [], { namespace: [new TextDecoder().decode(NAMESPACE)] }),
  "CG-9": m("rule"),
  "CG-10": m("rule", [], {
    template_length: [TEMPLATE_LENGTH],
    template_keccak: [TEMPLATE_KECCAK],
  }),
  "CG-11": m(
    "rule",
    ["ErrIssuerUnbonded", "ErrEntityBanned", "ErrEntityThrottled"],
    {
      min_stake_value: "amount",
      min_unstake_delay: "int",
      min_inclusion_rate_denominator: "int",
      throttling_slack: "int",
      ban_slack: "int",
      refresh_seconds: "int",
      throttled_entity_mempool_count: "int",
    }
  ),
};

const ERC_CODES: Readonly<Record<string, readonly string[]>> = {
  "PREFIX-010": [
    "ErrFrameExpiryNotFirst",
    "ErrFrameNoPayer",
    "ErrFrameUnrecognizedPrefix",
  ],
  "PREFIX-020": ["ErrFrameDeployNoCode"],
  "PREFIX-040": ["ErrFrameAtomicInPrefix"],
  "PREFIX-050": ["ErrFrameVerifyAfterPrefix"],
  "PREFIX-060": [
    "ErrFramePrefixReverted",
    "ErrFrameMissingApprove",
    "ErrInsufficientFunds",
  ],
  "PREFIX-080": ["ErrFrameExpired"],
  "PREFIX-110": ["ErrFramePreVerifyNoCode"],
  "PREFIX-120": ["ErrFrameStrayDefault"],
  "BUDGET-010": ["ErrEntityVerifyGas"],
  "SIGNATURE-010": ["ErrInvalidSender"],
  "OPCODES-010": ["ErrFrameBannedOpcode"],
  "OPCODES-030": ["ErrFrameUnassignedOpcode"],
  "OPCODES-040": ["ErrFrameOutOfGasRevert"],
  "CREATION-010": ["ErrFrameCreation"],
  "CALLING-010": ["ErrFrameCallTarget"],
  "STORAGE-000": ["ErrFrameStorageAccess"],
  "LIFECYCLE-010": ["ErrNonceTooLow", "ErrNonceGap"],
  "LIFECYCLE-020": ["ErrReplaceUnderpriced"],
  "LIFECYCLE-030": ["ErrNonceKeyLimit", "ErrSenderLimit"],
  "LOCAL-010": ["ErrEntityIsSender"],
  "LOCAL-020": ["ErrLocalStorage"],
  "SOLVENCY-010": ["ErrFramePayerExposure"],
  "REPUTATION-010": ["ErrEntityBanned"],
  "REPUTATION-020": ["ErrEntityThrottled"],
  "REPUTATION-210": ["ErrSenderThrottled"],
  "REPUTATION-220": ["ErrPayerOpsAllowed"],
};

const ERC_PARAMS: Readonly<Record<string, Record<string, ParamType>>> = {
  "ASSOC-020": { max_offset: "int" },
  "PREFIX-010": { expiry_verifier: "str" },
  "PREFIX-100": { canonical_paymaster_code: "str" },
  "BUDGET-010": {
    max_verify_gas_per_entity: "int",
    max_verify_gas_staked_entity: "int",
  },
  "CALLING-040": { precompiles: "str[]" },
  "STAKING-010": {
    min_stake_value: "amount",
    min_unstake_delay: "int",
    staking_registry: "str",
  },
  "REPUTATION-010": {
    min_inclusion_rate_denominator: "int",
    throttling_slack: "int",
    ban_slack: "int",
    refresh_seconds: "int",
  },
  "REPUTATION-020": {
    throttled_entity_mempool_count: "int",
    throttled_entity_live_blocks: "int",
    throttled_entity_block_count: "int",
  },
  "REPUTATION-220": {
    same_unstaked_entity_mempool_count: "int",
    max_txs_allowed_unstaked_entity: "int",
  },
  "LIFECYCLE-020": { price_bump: "int" },
  "LIFECYCLE-030": {
    same_nonce_key_mempool_count: "int",
    same_sender_mempool_count: "int",
  },
};

/** 14-erc-8421.md, AM-2: the ruleset's own modules, in the ERC's order. */
export const ERC_ORDER: readonly string[] = [
  "ASSOC-010",
  "ASSOC-020",
  "PREFIX-010",
  "PREFIX-020",
  "PREFIX-040",
  "PREFIX-050",
  "PREFIX-060",
  "PREFIX-080",
  "PREFIX-100",
  "PREFIX-110",
  "PREFIX-120",
  "BUDGET-010",
  "SIGNATURE-010",
  "OPCODES-010",
  "OPCODES-020",
  "OPCODES-030",
  "OPCODES-040",
  "CREATION-010",
  "CALLING-010",
  "CALLING-040",
  "STORAGE-000",
  "STORAGE-010",
  "STORAGE-021",
  "STORAGE-022",
  "STORAGE-031",
  "STORAGE-032",
  "STORAGE-033",
  "LOCAL-010",
  "LOCAL-020",
  "STAKING-010",
  "SOLVENCY-010",
  "SOLVENCY-020",
  "SOLVENCY-030",
  "REPUTATION-010",
  "REPUTATION-020",
  "REPUTATION-040",
  "REPUTATION-210",
  "REPUTATION-220",
  "REPUTATION-310",
  "REPUTATION-320",
  "REPUTATION-330",
  "LIFECYCLE-010",
  "LIFECYCLE-020",
  "LIFECYCLE-030",
  "LIFECYCLE-040",
  "PROPAGATION-010",
  "PROPAGATION-020",
  "PROPAGATION-030",
  "PROPAGATION-040",
  "PROPAGATION-050",
];

export const ERC: Readonly<Record<string, Module>> = Object.fromEntries(
  ERC_ORDER.map((name) => [
    name,
    m("rule", ERC_CODES[name] ?? [], ERC_PARAMS[name] ?? {}),
  ])
);

export const MODULES: Readonly<Record<string, Module>> = {
  ...FRAME_POOL,
  ...AGGREGATION,
  ...CLAIMS,
  ...ERC,
};

/** DS-6 step 3, AM-2: the frame pool modules the ERC's replace. */
export const REPLACED = ["FP-5", "FP-6", "FP-7", "FP-9", "FP-11", "FP-12"];

const has = (o: object, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k);

function typeOk(t: ParamType, v: Value): boolean {
  if (Array.isArray(t)) return t.includes(v) && typeof v === typeof t[0];
  switch (t) {
    case "int":
      return typeof v === "number";
    case "int|null":
      return v === null || typeof v === "number";
    case "bool":
      return typeof v === "boolean";
    case "str":
      return typeof v === "string";
    case "str[]":
      return Array.isArray(v) && v.every((x) => typeof x === "string");
    case "amount":
      return typeof v === "string" && /^(0|[1-9]\d*)$/.test(v);
  }
  return false;
}

/** DS-4, in the byte order of the module names, each name before its parameters. */
export function checkModules(rules: Record<string, Value>): void {
  for (const name of Object.keys(rules).sort()) {
    if (!has(MODULES, name))
      throw new DescriptorError("ErrDescriptorUnknownRule", name);
    const mod = MODULES[name];
    const params = rules[name];
    const want = Object.keys(mod.params);
    if (
      Object.keys(params).length !== want.length ||
      !want.every((p) => has(params, p) && typeOk(mod.params[p], params[p]))
    )
      throw new DescriptorError("ErrDescriptorParams", name);
  }
}

// --- DS-5 and DS-6 ----------------------------------------------------------------------

/** A loaded descriptor: its identifier, value, and effective modules with who set each (DS-5). */
export class Descriptor {
  constructor(
    readonly id: string,
    readonly value: Value,
    readonly effective: ReadonlyMap<string, [Value, string]>
  ) {}

  /** DS-7: the effective module whose Errors table holds `code`; an ERC-8421 module claims its codes. */
  ruleOf(code: string): string | null {
    let owner: string | null = null;
    for (const name of this.effective.keys()) {
      if (MODULES[name].codes.includes(code)) {
        if (has(ERC, name)) return name;
        owner = owner ?? name;
      }
    }
    return owner;
  }

  /** DS-7: a refusal as a pool names it. */
  refusal(code: string): {
    code: string;
    rule: string | null;
    descriptor: string;
  } {
    return { code, rule: this.ruleOf(code), descriptor: this.id };
  }
}

/** DS-6, in its order. */
function complete(effective: ReadonlyMap<string, unknown>): void {
  for (const [name, mod] of Object.entries(FRAME_POOL))
    if (mod.kind === "core" && !effective.has(name))
      throw new DescriptorError("ErrDescriptorIncomplete", name);
  const erc = ERC_ORDER.some((name) => effective.has(name));
  if (erc)
    for (const name of ERC_ORDER)
      if (!effective.has(name))
        throw new DescriptorError("ErrDescriptorIncomplete", name);
  for (const name of REPLACED) {
    if (effective.has(name) && erc)
      throw new DescriptorError("ErrDescriptorConflict", name);
    if (!effective.has(name) && !erc)
      throw new DescriptorError("ErrDescriptorIncomplete", name);
  }
  if (erc)
    for (const name of Object.keys({ ...AGGREGATION, ...CLAIMS }))
      if (effective.has(name))
        throw new DescriptorError("ErrDescriptorConflict", name);
  for (const [family, needs] of [
    ["AG", AGGREGATION],
    ["CG", { ...AGGREGATION, ...CLAIMS }],
  ] as const) {
    if ([...effective.keys()].some((n) => n.startsWith(family + "-")))
      for (const name of Object.keys(needs))
        if (!effective.has(name))
          throw new DescriptorError("ErrDescriptorIncomplete", name);
  }
}

/** The descriptors a node holds, by identifier (DS-5). */
export class Store {
  readonly held = new Map<string, Descriptor>();

  /** DS-1, the parent, DS-4, the removals, DS-6: the order DS-5 gives. A loaded descriptor is held. */
  load(text: string): Descriptor {
    const value = parse(text);
    let parent: Descriptor | null = null;
    if (value.parent !== null) {
      parent = this.held.get(value.parent) ?? null;
      if (parent === null)
        throw new DescriptorError("ErrDescriptorParentUnknown");
    }
    checkModules(value.rules);
    const id = identifier(value);
    const effective = new Map<string, [Value, string]>(parent?.effective ?? []);
    for (const name of value.remove) {
      if (!effective.has(name))
        throw new DescriptorError("ErrDescriptorRemove", name);
      effective.delete(name);
    }
    for (const [name, params] of Object.entries(value.rules))
      effective.set(name, [params, id]);
    complete(effective);
    const d = new Descriptor(id, value, effective);
    this.held.set(id, d);
    return d;
  }
}

// --- compiling a ruleset to a pool profile (DS-6) -----------------------------------------

/** Module parameters no pool field holds: AG-7's interval is converted, the rest are fixed or the tracer's. */
const SKIPPED = new Set([
  "AG-7/aggregation_interval_ms",
  "ASSOC-020/max_offset",
  "STAKING-010/staking_registry",
  "CG-8/namespace",
  "CG-10/template_length",
  "CG-10/template_keccak",
]);

const BIGINT_FIELDS = new Set([
  "maxVerifyGas",
  "maxVerifyStateGas",
  "priceLimit",
  "maxVerifyGasPerEntity",
  "maxVerifyGasStakedEntity",
  "minStakeValue",
  "minUnstakeDelay",
]);

const camel = (snake: string): string =>
  snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * DS-6: the profile a complete ruleset's modules carry, with every parameter
 * set; one no module carries keeps the `eip-8141` profile's value.
 */
export function compileConfig(d: Descriptor): FramePoolConfig {
  const eff = d.effective;
  const changes: Record<string, Value> = {};
  for (const [name, [params]] of eff) {
    for (const [p, v] of Object.entries(params as Record<string, Value>)) {
      if (SKIPPED.has(`${name}/${p}`)) continue;
      const key = camel(p);
      if (!has(EIP_8141, key))
        throw new Error(`no pool parameter for ${name}'s ${p}`);
      changes[key] = BIGINT_FIELDS.has(key)
        ? v === null
          ? null
          : BigInt(v)
        : key === "precompiles"
        ? new Set(v)
        : v;
    }
  }
  if (eff.has("AG-7"))
    changes.aggregationInterval =
      eff.get("AG-7")?.[0].aggregation_interval_ms / 1000;
  const erc = ERC_ORDER.some((name) => eff.has(name));
  if (erc) changes.ruleset = "erc-8421";
  changes.name = erc
    ? "erc-8421"
    : eff.has("CG-2")
    ? "claim-gated"
    : eff.has("AG-2")
    ? "eip-8288"
    : "eip-8141";
  changes.dependencyFrames = eff.has("AG-2");
  changes.claims = eff.has("CG-2");
  changes.bond = eff.has("CG-11");
  return withChanges(EIP_8141, changes as Partial<FramePoolConfig>);
}
