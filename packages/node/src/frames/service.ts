/**
 * Frame transactions over this node's JSON-RPC and gossip, admitted by
 * `@skandha/framepool` under exp-mempool-l2s `docs/spec/11-surface.md`: SF-5 for
 * `eth_sendRawTransaction`, SF-6 and SF-7 for the gossip topic, SF-8 for a new
 * head and SF-9 for hand-off. The prefix's outcome is the execution client's
 * verdict (SF-4); everything else the pool decides itself. As an includer it
 * answers with the inclusion list it would publish (`07-focil.md`, IL-2).
 *
 * Admissions and head changes run one at a time, so a verdict, the state the
 * pool reads and the head they belong to always agree.
 *
 * With `claims` (`10-claim-gated-admission.md`, CG-1) a ticket a transaction
 * carries is read and checked before the client is asked (SF-3's `claim`,
 * SF-4): a ticket paymaster is any account whose code is the template, a key
 * and a denomination (CG-10), found by `eth_getCode`, with nothing to
 * configure.
 */
import { appendFileSync } from "node:fs";
import {
  APPROVE_PAYMENT,
  FOCIL_PROFILES,
  FramePool,
  FrameTx,
  Head,
  PROFILES,
  Reserver,
  SURFACE_PROFILES,
  State,
  Surface,
  SurfaceConfig,
  addressForm,
  buildIl,
  paymasterKey,
  verifyTargets,
  withChanges,
  costs,
  decode,
  headNextBaseFee,
  gossipOutcome,
  OK,
  TxError,
  verdict,
} from "@skandha/framepool/lib/index.js";
import { ClientHead, FrameClient } from "./client.js";

export interface FrameServiceOptions {
  rpcUrl: string;
  profile: string; // a frame pool profile with a surface (SF-1): eip-8141 or hegota-testnet
  handoff: boolean; // SF-9
  claims?: boolean; // CG-1: claim-gated admission, the ticket checked before the client is asked
  logFile?: string; // one JSON object a line for every admission, head and hand-off
  pollMs?: number;
  name?: string; // how this node names itself in its log
}

export interface SendResult {
  result?: string; // a hash on ok
  error?: { code: number; message: string };
}

/** IL-2: the list an includer at this node's head would publish, and what it costs. */
export interface InclusionList {
  profile: string; // the IL-1 profile whose budget and order it was built with
  head: number;
  baseFee: string; // the next block's, at which the pool's pending view was read
  transactions: string[]; // the bytes, in list order
  hashes: string[];
  verifyGas: string; // IL-4's cost of the list, signatures and prefixes
  budget: string; // MAX_VERIFY_GAS_PER_IL
  bytes: number; // against MAX_BYTES_PER_INCLUSION_LIST
}

/** SF-6's topic for a chain. */
export const frameTopic = (chainId: bigint): string =>
  `/frame-transactions/${chainId}/raw`;

/** FP-4: the payer is the target of the first frame that can approve payment, or the sender. */
function payerOf(tx: FrameTx): string {
  const f = tx.frames.find((x) => (x.flags & APPROVE_PAYMENT) !== 0);
  return f?.target ?? tx.sender;
}

export class FrameService {
  readonly client: FrameClient;
  readonly surfaceConfig: SurfaceConfig;
  pool!: FramePool;
  surface!: Surface;
  head!: ClientHead;
  /** Set by the network: publish bytes on the topic, returning how many peers it went to. */
  publish: (raw: Uint8Array) => Promise<number> = async () => 0;

  private queue: Promise<unknown> = Promise.resolve();
  private readonly raws = new Map<string, string>(); // the chain's hash to the bytes, for SF-8's questions
  /** SF-3's `claim`: the ticket paymasters found, by address; their code changes only in a reorganisation. */
  private readonly paymasters = new Map<string, Uint8Array>();
  /** The code of every other target read at this head, read again at the next. */
  private headCodes = new Map<string, Uint8Array>();
  private timer?: NodeJS.Timeout;

  constructor(readonly opts: FrameServiceOptions) {
    this.client = new FrameClient(opts.rpcUrl);
    const base = SURFACE_PROFILES.get(opts.profile);
    if (base === undefined || !PROFILES.has(opts.profile))
      throw new Error(`no surface profile ${opts.profile}`);
    this.surfaceConfig = { ...base, relay: "gossipsub", handoff: opts.handoff };
  }

  get topic(): string {
    return frameTopic(this.surfaceConfig.chainId);
  }

  log(event: Record<string, unknown>): void {
    const line = JSON.stringify(
      { t: new Date().toISOString(), node: this.opts.name, ...event },
      (_, v) => (typeof v === "bigint" ? v.toString() : v)
    );
    if (this.opts.logFile) appendFileSync(this.opts.logFile, line + "\n");
    else process.stdout.write(line + "\n");
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private static toHead(h: ClientHead): Head {
    return {
      number: h.number,
      timestamp: h.timestamp,
      gasLimit: h.gasLimit,
      gasUsed: h.gasUsed,
      baseFee: h.baseFee,
      slot: h.slot, // SF-8 step 1: the header's slotNumber (RR-2)
    };
  }

  async start(): Promise<void> {
    this.head = await this.client.head();
    const profile = PROFILES.get(this.opts.profile);
    if (profile === undefined)
      throw new Error(`no frame pool profile ${this.opts.profile}`);
    const cfg = addressForm(
      this.opts.claims ? withChanges(profile, { claims: true }) : profile
    );
    this.pool = new FramePool(
      FrameService.toHead(this.head),
      new State(),
      cfg,
      new Reserver()
    );
    this.surface = new Surface(this.pool, this.surfaceConfig, []);
    this.log({
      event: "start",
      profile: this.opts.profile,
      head: this.head.number,
      handoff: this.opts.handoff,
      claims: cfg.claims,
    });
    this.timer = setInterval(() => void this.poll(), this.opts.pollMs ?? 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private block(): string {
    return "0x" + this.head.number.toString(16);
  }

  /** SF-8 step 1, or before an admission: the accounts `tx`'s dependencies name, at the head, into `state`. */
  private async load(tx: FrameTx, state: State, block: string): Promise<void> {
    const wanted = new Map<string, bigint[]>([[tx.sender, [...tx.nonceKeys]]]);
    const payer = payerOf(tx);
    if (!wanted.has(payer)) wanted.set(payer, []);
    if (tx.frames.some((f) => f.deadline !== null))
      wanted.set(this.pool.config.expiryVerifier, []);
    await Promise.all(
      [...wanted].map(async ([addr, keys]) => {
        const acc = await this.client.account(addr, keys, block);
        const edit = state.edit(addr);
        edit.nonce = acc.nonceSeqs.get(BigInt(0)) ?? BigInt(0);
        for (const [k, v] of acc.nonceSeqs)
          if (k !== BigInt(0)) edit.nonceSeqs.set(k, v);
        edit.balance = acc.balance;
        edit.code = acc.code;
      })
    );
  }

  /**
   * SF-3's `claim`: the code at the head of each target of the transaction's
   * VERIFY frames, from the client. A ticket paymaster is kept; any other
   * target is read again at the next head, since an account may gain code.
   */
  private async codes(
    raw: Uint8Array,
    block: string
  ): Promise<Map<string, Uint8Array>> {
    const out = new Map<string, Uint8Array>();
    await Promise.all(
      verifyTargets(raw, this.surfaceConfig).map(async (addr) => {
        let code = this.paymasters.get(addr) ?? this.headCodes.get(addr);
        if (code === undefined) {
          const got = await this.client.call<string>("eth_getCode", [
            addr,
            block,
          ]);
          code = Buffer.from(got.slice(2), "hex");
          if (paymasterKey(code) !== null) this.paymasters.set(addr, code);
          else this.headCodes.set(addr, code);
        }
        out.set(addr, code);
      })
    );
    return out;
  }

  /** SF-2 to SF-4 and `add`, for bytes from JSON-RPC or from a peer: the same steps either way (SF-7). */
  private admit(raw: Uint8Array): Promise<{
    result: string;
    hash?: string;
    text?: string;
    claim?: Record<string, unknown>;
  }> {
    return this.serial(async () => {
      const rawHex = "0x" + Buffer.from(raw).toString("hex");
      let tx: FrameTx;
      try {
        tx = decode(raw, this.pool.config, this.surfaceConfig);
      } catch (err) {
        if (err instanceof TxError) return { result: err.code };
        throw err;
      }
      const block = this.block();
      await this.load(tx, this.pool.state, block);
      const codes = this.pool.config.claims
        ? await this.codes(raw, block)
        : undefined;
      const prepared = this.surface.prepare(raw, codes);
      const c = prepared.claim ?? null;
      const claim =
        c === null
          ? undefined
          : { epoch: c.epoch, salt: c.salt, valid: c.valid };
      if (prepared.tx === undefined)
        return {
          result: prepared.result as string,
          hash: prepared.hash,
          claim,
        };
      const answer = await this.client.simulate(rawHex, block);
      const result = this.surface.admit(prepared.tx, answer, Date.now() / 1000);
      if (result === OK) this.raws.set(tx.label, rawHex);
      return { result, hash: tx.label, text: answer.text, claim };
    });
  }

  /** SF-9, outside the queue: the client's answer is recorded, and changes nothing here. */
  private async handOff(hash: string, rawHex: string): Promise<void> {
    if (!this.surfaceConfig.handoff) return;
    const answer = await this.client.send(rawHex);
    this.log({
      event: "handoff",
      hash,
      ...answer,
      agrees: answer.hash?.toLowerCase() === hash,
    });
  }

  /** SF-5. */
  async sendRawTransaction(param: unknown): Promise<SendResult> {
    if (typeof param !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(param))
      return {
        error: {
          code: -32602,
          message:
            "invalid params: the transaction is not 0x-prefixed hexadecimal",
        },
      };
    const out = await this.admit(Buffer.from(param.slice(2), "hex"));
    this.log({
      event: "rpc",
      hash: out.hash,
      result: out.result,
      client: out.text, // absent when the client was not asked (SF-4)
      claim: out.claim,
      head: this.head.number,
    });
    if (out.result !== OK)
      return {
        error: {
          code: -32000,
          message: `${out.result}${out.text ? ": " + out.text : ""}`,
        },
      };
    const hash = out.hash as string;
    let peers = 0;
    try {
      peers = await this.publish(Buffer.from(param.slice(2), "hex")); // SF-6
    } catch (err) {
      this.log({
        event: "relay",
        hash,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.log({ event: "relay", hash, peers });
    void this.handOff(hash, param.toLowerCase());
    return { result: hash };
  }

  /**
   * IL-2 at the current head: what this node, as an includer, would list from
   * its pool, under an inclusion-list profile with frames (`eip-8369` unless
   * `{"focil": name}` says otherwise). It changes nothing in the pool.
   */
  async inclusionList(
    param: unknown
  ): Promise<{ result?: InclusionList; error?: SendResult["error"] }> {
    const name =
      param !== null && typeof param === "object" && "focil" in param
        ? String((param as { focil: unknown }).focil)
        : "eip-8369";
    const focil = FOCIL_PROFILES.get(name);
    if (focil === undefined || !focil.frames)
      return {
        error: {
          code: -32602,
          message: `invalid params: ${name} is not an inclusion-list profile with frame transactions`,
        },
      };
    return this.serial(async () => {
      const baseFee = headNextBaseFee(this.pool.head);
      const listed = buildIl(this.pool, focil, baseFee);
      let verifyGas = BigInt(0);
      for (const tx of listed) {
        const [signatures, prefix] = costs(tx, this.pool.config);
        verifyGas += signatures + prefix;
      }
      const transactions = listed.map(
        (tx) => this.raws.get(tx.label) as string
      );
      const result: InclusionList = {
        profile: focil.name,
        head: this.head.number,
        baseFee: "0x" + baseFee.toString(16),
        transactions,
        hashes: listed.map((tx) => tx.label),
        verifyGas: "0x" + verifyGas.toString(16),
        budget: "0x" + focil.maxVerifyGasPerIl.toString(16),
        bytes: transactions.reduce((n, raw) => n + (raw.length - 2) / 2, 0),
      };
      this.log({
        event: "il",
        profile: focil.name,
        head: this.head.number,
        hashes: result.hashes,
        verifyGas,
        pending: this.pool.size,
      });
      return { result };
    });
  }

  /** SF-7: the gossip validator's outcome for bytes a peer sent. */
  async onGossip(
    raw: Uint8Array,
    peer: string
  ): Promise<"accept" | "reject" | "ignore"> {
    const out = await this.admit(raw);
    const outcome = gossipOutcome(out.result);
    this.log({
      event: "gossip",
      from: peer,
      hash: out.hash,
      result: out.result,
      client: out.text, // absent when the client was not asked (SF-4)
      claim: out.claim,
      outcome,
      head: this.head.number,
    });
    if (out.result === OK)
      void this.handOff(
        out.hash as string,
        "0x" + Buffer.from(raw).toString("hex")
      );
    return outcome;
  }

  private polling = false;

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const latest = await this.client.head();
      if (latest.number <= this.head.number) return;
      await this.serial(() => this.newHead(latest));
    } catch (err) {
      this.log({
        event: "poll",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.polling = false;
    }
  }

  /** SF-8. */
  private async newHead(h: ClientHead): Promise<void> {
    const block = "0x" + h.number.toString(16);
    const next = this.pool.state.copy();
    const pending = this.surface.pending();
    for (const hash of pending)
      await this.load(this.surface.byHash.get(hash) as FrameTx, next, block); // step 1
    const answers = new Map<
      string,
      { valid: boolean; violation?: string | null }
    >();
    for (const hash of this.surface.toAsk(next)) {
      const a = await this.client.simulate(
        this.raws.get(hash) as string,
        block
      ); // step 2
      answers.set(hash, a);
    }
    this.head = h;
    this.headCodes = new Map();
    this.surface.head(FrameService.toHead(h), next, answers, Date.now() / 1000); // step 3
    const left = new Set(this.surface.pending());
    const gone = pending.filter((x) => !left.has(x));
    for (const x of gone) this.raws.delete(x);
    if (pending.length > 0)
      this.log({
        event: "head",
        head: h.number,
        asked: [...answers.keys()],
        verdicts: Object.fromEntries(
          [...answers].map(([k, a]) => [k, verdict(a)])
        ),
        resimulated: this.pool.resimulated.map((t) => t.label),
        removed: gone,
        pending: [...left],
      });
  }
}
