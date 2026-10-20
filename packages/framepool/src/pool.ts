/**
 * The frame transaction pool: exp-mempool-l2s `docs/spec/02-frame-pool.md`, the MATCHA
 * proposal of `04-matcha.md`, the recent roots of `08-recent-roots.md`, the
 * expiring nonces of `09-expiring-nonces.md`, and AG-6's admission rule of
 * `05-aggregation.md`.
 */
import * as E from "./errors.js";
import { TxError } from "./errors.js";
import { EIP_8141, FramePoolConfig } from "./config.js";
import { DepKey, DepValue, depValue } from "./deps.js";
import { dependencies } from "./dependencies.js";
import { admissionGas, charge } from "./matcha.js";
import { Head, State, headNextBaseFee, isDelegation } from "./model.js";
import {
  Prefix,
  Simulation,
  checkExpiring,
  checkNonce,
  checkStatic,
  expiring,
  seenSlot,
  simulate,
  staticPayer,
} from "./prefix.js";
import { Reserver } from "./reserver.js";
import { FrameTx, claimId, dependencyId, replaces, slotId } from "./tx.js";

export interface Entry {
  tx: FrameTx; // replaced only by a newer verdict (MD-8), which leaves its hash

  readonly seq: number;
  readonly prefix: Prefix;
  sim: Simulation;
  readonly admitted: number;
  readonly charge: bigint; // MA-2, kept for the re-runs of MA-9
  reads: ReadonlySet<string>; // the addresses it is indexed under (FP-15)
  readonly cls: ReadonlySet<string>; // MA-14, fixed at admission
}

type EvictKey =
  | [bigint | number, bigint, number]
  | [bigint, bigint | number, number]; // no deadline is Infinity

function compareKeys(a: EvictKey, b: EvictKey): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

function identity(tx: FrameTx): string {
  return `${tx.sender}|${tx.nonceKeys.join(",")}|${tx.nonceSeq}`;
}

function counter(): () => number {
  let n = 0;
  return () => n++;
}

export class FramePool {
  readonly config: FramePoolConfig;
  head: Head;
  state: State;
  readonly reserver: Reserver;
  readonly entries = new Map<string, Entry>();
  private byIdentity = new Map<string, string>();
  protected bySender = new Map<string, string[]>();
  private keys = new Map<string, Map<bigint, number>>(); // by sender: how many pending transactions use each nonce key
  protected reserved = new Map<string, bigint>();
  private readers = new Map<string, Set<string>>(); // FP-15: by address, the transactions whose sender, payer or dependencies name it
  private payerCount = new Map<string, number>();
  resimulated: FrameTx[] = [];
  resimulations = 0;
  readonly dropped = new Map<string, number>(); // by reason, every transaction the pool has removed
  readonly work = new Map<string, bigint>(); // by sender: admission gas (MA-2) of every prefix run
  protected sequence: () => number;
  private readonly matcha: boolean;
  private widths = new Map<string, bigint>(); // MA-3
  private bases = new Set<string>(); // MA-5: the hashes of pending baselines
  private claims = new Map<string, Map<string, number>>(); // MA-14: by sender, how many pending classes hold each element
  private credited: number | null = null; // MA-4: the highest block number credited
  readonly proven = new Set<string>(); // AG-6: the dependency triples this node holds proofs for
  readonly relayed = new Set<string>(); // CG-7: the triples a relay has passed on unverified, which AG-6 counts as proven
  // CG-4 to CG-6, under `claims`. CG-2 makes a claim name its transaction's slot, so a claim stands for the
  // clauses' slot and claim.
  private refusedSlots = new Map<string, number>(); // CG-4 under `slot`: by slot, the last epoch it is refused in
  private refusedClaims = new Map<string, number>(); // CG-4 under `claim`: by claim, the same
  private usedClaims = new Set<string>(); // CG-5: the claims a node has verified a proof under
  private expiredClaims = new Map<string, number>(); // CG-6: by claim, the last epoch it is refused in

  constructor(
    head: Head,
    state: State,
    config: FramePoolConfig = EIP_8141,
    reserver: Reserver = new Reserver(),
    sequence: () => number = counter()
  ) {
    this.config = config;
    this.head = head;
    this.state = state;
    this.reserver = reserver;
    this.sequence = sequence;
    this.matcha = config.perSender === "matcha";
  }

  // --- the pool interface (MD-8) --------------------------------------------

  add(txs: readonly FrameTx[], now = 0): string[] {
    return txs.map((tx) => {
      this.expire(now);
      return this.addOne(tx, now);
    });
  }

  /**
   * FP-15, with MA-8 to MA-10 under `matcha`. Only a transaction indexed under
   * an address the new state may have changed can fail step 1, 3 or 4, so
   * only those are looked at, in the order received.
   */
  reset(
    head: Head,
    state: State,
    now = 0,
    verdicts: ReadonlyMap<string, string> = new Map()
  ): void {
    this.expire(now);
    const touched = state.changedSince(this.state);
    this.head = head;
    this.state = state;
    this.resimulated = [];
    const cfg = this.config;
    // MD-8: a verdict given for a pending transaction; one that differs from the recorded one is a changed dependency
    const given = new Map([...verdicts].filter(([h]) => this.entries.has(h)));
    const renewed = new Set(
      [...given]
        .filter(([h, v]) => {
          const recorded = (this.entries.get(h) as Entry).sim.verdict;
          return recorded !== undefined && recorded !== null && recorded !== v;
        })
        .map(([h]) => h)
    );
    const affected = this.inOrder(
      new Set([
        ...[...touched].flatMap((a) => [...(this.readers.get(a) ?? [])]),
        ...renewed,
      ])
    );
    for (const h of affected) {
      const tx = (this.entries.get(h) as Entry).tx;
      if (expiring(tx, cfg)) {
        // EN-6 in place of step 1
        if (
          touched.has(cfg.nonceRing) &&
          state.storage(cfg.nonceRing, seenSlot(h)) >=
            BigInt(head.timestamp + cfg.expiryMargin)
        ) {
          this.remove(h, "stale_nonce");
        }
      } else if (
        touched.has(tx.sender) &&
        tx.nonceKeys.some((k) => state.nonceSeq(tx.sender, k) > tx.nonceSeq)
      ) {
        this.remove(h, "stale_nonce");
      }
    }
    for (const [h, e] of [...this.entries]) {
      if (
        e.sim.deadline !== null &&
        e.sim.deadline < BigInt(head.timestamp + cfg.expiryMargin)
      )
        this.remove(h, "expired");
    }
    if (cfg.recentRoots) {
      // RR-7
      const current = head.slot + 1;
      for (const [h, e] of [...this.entries]) {
        if (e.sim.roots === null) continue;
        if (e.sim.roots[1] >= current) this.remove(h, "root_future");
        else if (e.sim.roots[0] + cfg.recentRootLength <= current)
          this.remove(h, "root_expired");
      }
    }
    const values = new Map<string, DepValue>(); // each dependency's value at the new head, read once
    const value = (key: DepKey): DepValue => {
      if (!values.has(key.id)) values.set(key.id, depValue(state, key));
      return values.get(key.id) as DepValue;
    };

    for (const h of affected) {
      const e = this.entries.get(h);
      if (e === undefined) continue;
      const changed = [...e.sim.deps.entries()]
        .filter(([k, v]) => value(k) !== v)
        .map(([k]) => k);
      if (given.has(h) && e.tx.verdict !== null)
        e.tx = e.tx.withVerdict(given.get(h) as string); // the newest verdict is the one any re-run uses
      const renew = renewed.has(h); // FP-15 step 3: a different verdict re-runs it, and is not a balance
      if (!renew && changed.length === 0) continue;
      if (!renew && this.reuse(e, changed, state)) continue;
      if (this.reuse(e, changed, state)) continue;
      if (this.matcha && !this.bases.has(h)) {
        // MA-9
        const width = this.widths.get(e.tx.sender) ?? 0n;
        if (width < e.charge) {
          this.remove(h, "width");
          continue;
        }
        this.widths.set(e.tx.sender, width - e.charge);
      }
      this.resimulated.push(e.tx);
      this.resimulations += 1;
      this.addWork(e.tx.sender, admissionGas(e.tx, e.prefix));
      let sim: Simulation;
      try {
        sim = this.simulate(e.tx, e.prefix, head, state);
      } catch (err) {
        if (!(err instanceof TxError)) throw err;
        this.invalidated(h, err);
        continue;
      }
      this.index(e, -1);
      e.sim = sim;
      this.index(e, +1);
    }
    if (this.matcha) {
      // MA-10: recount, remove nothing
      this.reserved = new Map();
      this.payerCount = new Map();
      for (const e of this.entries.values()) this.account(e, +1);
      return;
    }
    // Step 4. A payer whose account did not change passes again, because removals only lower what
    // precedes each of its transactions; the others are counted again from nothing.
    const payers = [...touched].filter((p) => this.reserved.has(p));
    const again = this.inOrder(
      new Set(
        payers.flatMap((p) =>
          [...(this.readers.get(p) ?? [])].filter(
            (h) => this.entries.get(h)?.sim.payer === p
          )
        )
      )
    );
    for (const p of payers) {
      this.reserved.delete(p);
      this.payerCount.delete(p);
    }
    for (const h of again) {
      const e = this.entries.get(h) as Entry;
      try {
        this.checkPayer(e.tx, e.sim.payer, e.sim.payerClass, null);
      } catch (err) {
        if (!(err instanceof TxError)) throw err;
        this.remove(h, "payer:" + err.code, true, false);
        continue;
      }
      this.account(e, +1);
    }
  }

  /** FP-15 step 3: a re-run that fails removes the transaction. */
  protected invalidated(txHash: string, err: TxError): void {
    this.remove(txHash, "invalidated:" + err.code);
  }

  /** FP-15 step 3 under `reuseBalance`, or MA-9 step 1: whether a change to balances alone re-runs nothing. */
  private reuse(e: Entry, changed: DepKey[], state: State): boolean {
    if (!this.config.reuseBalance || changed.some((k) => k.kind !== "balance"))
      return false;
    if (this.matcha) return true;
    // a balance from or to zero can change the sender-existence check
    if (
      changed.some((k) => e.sim.deps.get(k) === 0n || depValue(state, k) === 0n)
    )
      return false;
    for (const k of changed) e.sim.deps.set(k, depValue(state, k));
    return true;
  }

  tick(now: number): void {
    this.expire(now);
  }

  /** MD-8; MA-4 under `matcha`, ignored otherwise. */
  finalize(
    blocks: readonly [number, ReadonlyMap<string, bigint>][],
    now = 0
  ): void {
    this.expire(now);
    if (!this.matcha) return;
    for (const [number, gas] of [...blocks].sort((a, b) => a[0] - b[0])) {
      if (this.credited !== null && number <= this.credited) continue;
      for (const [sender, g] of gas) {
        const width = (this.widths.get(sender) ?? 0n) + g;
        this.widths.set(
          sender,
          width < this.config.widthCap ? width : this.config.widthCap
        );
      }
      this.credited = number;
    }
  }

  /** MA-12. */
  width(sender: string): bigint {
    return this.widths.get(sender) ?? 0n;
  }

  /** MA-12: the hashes of the sender's pending baselines, in the order admitted. */
  baselines(sender: string): string[] {
    return (this.bySender.get(sender) ?? []).filter((h) => this.bases.has(h));
  }

  /** MA-12: the first of the sender's baselines, or null. */
  baseline(sender: string): string | null {
    return this.baselines(sender)[0] ?? null;
  }

  /** MA-12, MA-13: the charges of the sender's pending additional transactions, without `leaveOut`. */
  load(sender: string, leaveOut: string | null = null): bigint {
    return (this.bySender.get(sender) ?? [])
      .filter((h) => !this.bases.has(h) && h !== leaveOut)
      .reduce((l, h) => l + (this.entries.get(h) as Entry).charge, 0n);
  }

  /** MA-10: the payers whose balance at the head is below their reservations. */
  overReserved(): Set<string> {
    const canonical = new Set(
      [...this.entries.values()]
        .filter((e) => e.sim.payerClass === "canonical")
        .map((e) => e.sim.payer)
    );
    const out = new Set<string>();
    for (const [payer, r] of this.reserved) {
      const withdrawal = canonical.has(payer)
        ? this.state.withdrawal(payer)
        : 0n;
      if (this.state.balance(payer) - r - withdrawal < 0n) out.add(payer);
    }
    return out;
  }

  content(): Map<string, FrameTx[]> {
    return new Map(
      [...this.bySender].map(([s, hs]) => [
        s,
        hs.map((h) => (this.entries.get(h) as Entry).tx),
      ])
    );
  }

  /**
   * SF-4: FP-2 to FP-7, and CG-2, CG-4 and CG-6 under `claims`, the checks a
   * node runs before it asks a client about the prefix. Throws the first
   * failure and changes nothing.
   */
  beforePrefix(tx: FrameTx): void {
    if (this.entries.has(tx.hash)) throw new TxError(E.ErrAlreadyKnown); // FP-2
    const prefix = checkStatic(tx, this.head, this.config); // FP-3 to FP-6
    if (this.config.claims) this.checkClaim(tx); // CG-2, CG-4, CG-6
    if (expiring(tx, this.config))
      checkExpiring(
        tx,
        prefix,
        this.state,
        this.config,
        this.head.timestamp + this.config.expiryMargin
      );
    // EN-4 in place of FP-7
    else checkNonce(tx, this.state); // FP-7
  }

  status(txHash: string): string {
    return this.entries.has(txHash) ? "pending" : "unknown";
  }

  get(txHash: string): FrameTx | undefined {
    return this.entries.get(txHash)?.tx;
  }

  /** FP-16, and MA-11 under `matcha`. */
  pendingView(minTip: bigint, baseFee: bigint): FrameTx[] {
    let live = [...this.entries.values()].filter(
      (e) => e.tx.effectiveTip(baseFee) >= minTip
    );
    if (this.matcha) {
      const unavailable = this.overReserved();
      live = live.filter((e) => !unavailable.has(e.sim.payer));
    }
    live.sort((a, b) => {
      const ta = a.tx.effectiveTip(baseFee);
      const tb = b.tx.effectiveTip(baseFee);
      if (ta !== tb) return ta > tb ? -1 : 1;
      return a.seq - b.seq;
    });
    return live.map((e) => e.tx);
  }

  arrival(txHash: string): number {
    return (this.entries.get(txHash) as Entry).seq;
  }

  get size(): number {
    return this.entries.size;
  }

  // --- claim-gated admission (CG-2 to CG-6) ---------------------------------

  /** CG-1: the epoch of the head. */
  epoch(): number {
    return Math.floor(this.head.timestamp / this.config.claimEpoch);
  }

  /**
   * CG-3 step 2 for one transaction: FP-2 to FP-10 with CG-2, CG-4 and CG-6,
   * without AG-6, then CG-5. Throws the first failure and changes nothing but
   * the work counted.
   */
  precheck(tx: FrameTx): void {
    if (this.entries.has(tx.hash)) throw new TxError(E.ErrAlreadyKnown); // FP-2
    const prefix = checkStatic(tx, this.head, this.config); // FP-3 to FP-6, AG-2 to AG-4
    this.checkClaim(tx);
    this.addWork(tx.sender, admissionGas(tx, prefix));
    this.simulate(tx, prefix, this.head, this.state); // FP-7 to FP-10
    if (tx.claim !== null && this.usedClaims.has(claimId(tx.claim)))
      throw new TxError(E.ErrClaimUsed); // CG-5
  }

  /**
   * CG-5, and CG-4 when `failed`: a mode 0 wrapper that passed CG-3 reached
   * AG-5's step 5, and a proof of a triple `tx` declares did not verify.
   */
  proofVerified(tx: FrameTx, failed: boolean): void {
    const claim = tx.claim;
    if (claim === null) return;
    const id = claimId(claim);
    this.usedClaims.add(id);
    const memory = this.config.claimMemory;
    if (failed && memory === "slot")
      this.refusedSlots.set(
        tx.slot,
        Math.max(this.refusedSlots.get(tx.slot) ?? claim.epoch, claim.epoch)
      );
    else if (failed && memory === "claim")
      this.refusedClaims.set(id, claim.epoch);
  }

  /** CG-2, then CG-4, then CG-6, as the pool runs them after FP-6. */
  private checkClaim(tx: FrameTx): void {
    const claim = tx.claim;
    if (claim === null) {
      if (dependencies(tx, this.config).length > 0)
        throw new TxError(E.ErrClaimMissing);
      return;
    }
    if (!claim.valid) throw new TxError(E.ErrClaimInvalid);
    if (slotId(claim.sender, claim.nonceKeys, claim.nonceSeq) !== tx.slot)
      throw new TxError(E.ErrClaimWrongSlot);
    const epoch = this.epoch();
    if (claim.epoch !== epoch) throw new TxError(E.ErrClaimEpoch);
    const id = claimId(claim);
    if ((this.refusedSlots.get(tx.slot) ?? -1) >= epoch)
      throw new TxError(E.ErrSlotRefused);
    if ((this.refusedClaims.get(id) ?? -1) >= epoch)
      throw new TxError(E.ErrClaimRefused);
    if ((this.expiredClaims.get(id) ?? -1) >= epoch)
      throw new TxError(E.ErrClaimExpired);
  }

  // --- admission ------------------------------------------------------------

  protected addOne(tx: FrameTx, now: number): string {
    try {
      const cfg = this.config;
      if (this.entries.has(tx.hash)) throw new TxError(E.ErrAlreadyKnown); // FP-2
      const prefix = checkStatic(tx, this.head, cfg); // FP-3 to FP-6, AG-2 to AG-4
      if (cfg.claims) this.checkClaim(tx); // CG-2, CG-4, CG-6
      if (
        cfg.dependencyFrames &&
        dependencies(tx, cfg).some((d) => {
          const id = dependencyId(d);
          return !this.proven.has(id) && !this.relayed.has(id);
        })
      ) {
        throw new TxError(E.ErrFrameDepsUnproven); // AG-6, CG-7 step 3
      }
      this.addWork(tx.sender, admissionGas(tx, prefix));
      const oldHash = this.many(tx)
        ? null
        : this.byIdentity.get(identity(tx)) ?? null;
      const old =
        oldHash !== null ? (this.entries.get(oldHash) as Entry) : null;
      const early = cfg.staticFirst && !this.matcha;
      if (early) {
        // Admission under `staticFirst`: FP-7, then FP-11 and FP-12, before the prefix runs
        if (expiring(tx, cfg))
          checkExpiring(
            tx,
            prefix,
            this.state,
            cfg,
            this.head.timestamp + cfg.expiryMargin
          );
        else checkNonce(tx, this.state);
        const [payer, payerClass] = staticPayer(tx, prefix, this.state, cfg);
        this.checkPayer(tx, payer, payerClass, old);
        this.checkIdentity(tx, old);
      }
      const sim = this.simulate(tx, prefix, this.head, this.state); // FP-7 to FP-10
      if (!early) this.checkPayer(tx, sim.payer, sim.payerClass, old); // FP-11
      const txCharge = this.matcha ? charge(tx, prefix, cfg.safetyFactor) : 0n;
      const cls = this.matcha
        ? this.contentionClass(tx, sim)
        : new Set<string>();
      let baseline = false;
      if (old !== null) {
        // FP-12, MA-7
        if (!early && !replaces(old.tx, tx, cfg.priceBump))
          throw new TxError(E.ErrReplaceUnderpriced);
        baseline =
          this.matcha &&
          this.bases.has(oldHash as string) &&
          this.keeps(cls, tx.sender, oldHash as string);
        if (this.matcha && !baseline)
          this.checkAdditional(tx, sim, txCharge, oldHash);
      } else if (this.matcha) {
        // MA-5, MA-6
        if (this.bySender.has(tx.sender)) this.checkKeys(tx);
        baseline = !this.shares(cls, tx.sender);
        if (!baseline) this.checkAdditional(tx, sim, txCharge, null);
      } else if (!early) {
        this.checkSender(tx);
      }
      if (this.reserver.heldByOther(tx.sender, this))
        throw new TxError(E.ErrAlreadyReserved); // FP-13
      const seq = this.sequence();
      if (old === null && this.entries.size >= cfg.maxPending) {
        // FP-14
        const victim = this.victim(tx, seq, sim.deadline);
        if (victim === null) throw new TxError(E.ErrTxPoolOverflow);
        this.remove(victim, "capacity");
      }
      if (oldHash !== null) this.remove(oldHash, "replaced", false);
      if (this.matcha) {
        if (baseline) this.bases.add(tx.hash);
        else
          this.widths.set(
            tx.sender,
            (this.widths.get(tx.sender) ?? 0n) - txCharge
          );
      }
      this.insert({
        tx,
        seq,
        prefix,
        sim,
        admitted: now,
        charge: txCharge,
        reads: new Set(),
        cls,
      });
      return E.OK;
    } catch (err) {
      if (err instanceof TxError) return err.code;
      throw err;
    }
  }

  /** FP-7 to FP-10 as a pool runs them: with its `expiryMargin`, and its head's slot plus one and its `rootMargin`. */
  protected simulate(
    tx: FrameTx,
    prefix: Prefix,
    head: Head,
    state: State
  ): Simulation {
    const cfg = this.config;
    return simulate(
      tx,
      prefix,
      head,
      state,
      cfg,
      cfg.expiryMargin,
      head.slot + 1,
      cfg.rootMargin
    );
  }

  /** FP-11. */
  protected checkPayer(
    tx: FrameTx,
    payer: string,
    payerClass: string,
    old: Entry | null
  ): void {
    const cfg = this.config;
    let reserved = this.reserved.get(payer) ?? 0n;
    let count = this.payerCount.get(payer) ?? 0;
    if (old !== null && old.sim.payer === payer) {
      reserved -= old.tx.maxCost;
      count -= 1;
    }
    const withdrawal =
      payerClass === "canonical" ? this.state.withdrawal(payer) : 0n;
    if (this.state.balance(payer) - reserved - withdrawal < tx.maxCost)
      throw new TxError(E.ErrFramePayerExposure);
    const capped =
      payerClass === "noncanonical" ||
      (payerClass === "default" && cfg.capCodelessPayers);
    if (capped && count >= cfg.maxPendingNoncanonical)
      throw new TxError(E.ErrFramePaymasterBusy);
  }

  /** FP-12 as a whole: the price bump over the pending transaction with the same identity, else the sender. */
  private checkIdentity(tx: FrameTx, old: Entry | null): void {
    if (old !== null) {
      if (!replaces(old.tx, tx, this.config.priceBump))
        throw new TxError(E.ErrReplaceUnderpriced);
    } else {
      this.checkSender(tx);
    }
  }

  /** FP-12, for a transaction that replaces nothing; under EN-6, not for one in the mode, and counting none. */
  private checkSender(tx: FrameTx): void {
    if (this.many(tx)) return;
    let pending = (this.bySender.get(tx.sender) ?? []).length;
    if (this.config.expiring && this.config.expiringPerSender === "many") {
      pending -= this.keys.get(tx.sender)?.get(this.config.expiringKey) ?? 0;
    }
    if (
      pending > 0 &&
      !(this.config.perSender === "disjoint-keys" && this.disjoint(tx))
    ) {
      throw new TxError(E.ErrFrameSenderBusy);
    }
  }

  /** EN-6: whether `tx` is in the mode and exempt from FP-12, identified by its hash alone. */
  private many(tx: FrameTx): boolean {
    return (
      expiring(tx, this.config) && this.config.expiringPerSender === "many"
    );
  }

  /** Neither `tx` nor any pending transaction from its sender uses key 0, and they share no key. */
  private disjoint(tx: FrameTx): boolean {
    const used = this.keys.get(tx.sender) ?? new Map<bigint, number>();
    return (
      !tx.nonceKeys.includes(0n) &&
      !used.has(0n) &&
      !tx.nonceKeys.some((k) => used.has(k))
    );
  }

  /** MA-14: the sender alone, or what FP-10 recorded that can make the pool re-run the prefix. */
  private contentionClass(tx: FrameTx, sim: Simulation): Set<string> {
    const cfg = this.config;
    if (cfg.contention === "sender") return new Set([`sender|${tx.sender}`]);
    const cls = new Set<string>();
    for (const [key, value] of sim.deps.entries()) {
      if (
        key.kind === "nonce_seq" ||
        (key.kind === "balance" && cfg.reuseBalance)
      )
        continue;
      if (key.kind === "code" && value !== "" && !isDelegation(value as string))
        continue;
      if (
        key.kind === "storage" &&
        cfg.recentRoots &&
        key.addr === cfg.recentRootAddress
      )
        continue;
      cls.add(
        key.kind === "storage" && cfg.contention === "storage"
          ? `${key.kind}|${key.addr}`
          : key.id
      );
    }
    return cls;
  }

  /** MA-5: whether a pending transaction from `sender` shares the class `cls`. */
  private shares(cls: ReadonlySet<string>, sender: string): boolean {
    const claims = this.claims.get(sender);
    return claims !== undefined && [...cls].some((x) => claims.has(x));
  }

  /**
   * MA-7: whether a replacement of the baseline `oldHash` with class `cls` is
   * a baseline: every element is the old one's or no pending transaction's.
   */
  private keeps(
    cls: ReadonlySet<string>,
    sender: string,
    oldHash: string
  ): boolean {
    const old = (this.entries.get(oldHash) as Entry).cls;
    const claims = this.claims.get(sender) ?? new Map<string, number>();
    return [...cls].every((x) => old.has(x) || !claims.has(x));
  }

  /** MA-6, check 1: non-zero keys on both sides, and none shared. */
  private checkKeys(tx: FrameTx): void {
    if (!this.disjoint(tx)) throw new TxError(E.ErrFrameSenderBusy);
  }

  /** MA-6, checks 2 to 5: valid for a child of the head, the width to pay for it, and MA-13's floor. */
  private checkAdditional(
    tx: FrameTx,
    sim: Simulation,
    txCharge: bigint,
    replaced: string | null
  ): void {
    const pendingFee = headNextBaseFee(this.head);
    if (tx.maxFee < pendingFee) throw new TxError(E.ErrFeeCapTooLow);
    if (sim.deadline !== null && sim.deadline <= BigInt(this.head.timestamp))
      throw new TxError(E.ErrFrameExpired);
    if ((this.widths.get(tx.sender) ?? 0n) < txCharge)
      throw new TxError(E.ErrFrameInsufficientWidth);
    const price = this.config.loadPrice; // MA-13, compared exactly: tip * c >= price * (c + L)
    if (
      price !== 0n &&
      tx.effectiveTip(pendingFee) * txCharge <
        price * (txCharge + this.load(tx.sender, replaced))
    ) {
      throw new TxError(E.ErrFrameLoadUnderpriced);
    }
  }

  /** MA-8, oldest first. */
  protected expire(now: number): void {
    if (!this.matcha) return;
    const oldest = [...this.entries.values()].sort(
      (a, b) => a.admitted - b.admitted || a.seq - b.seq
    );
    for (const e of oldest) {
      if (!(now - e.admitted > this.config.lifetime)) break;
      this.remove(e.tx.hash, "lifetime");
    }
  }

  /** FP-14: the smallest key is the victim. The latest received has the smallest `-seq`. */
  private evictKey(
    deadline: bigint | null,
    tx: FrameTx,
    seq: number,
    baseFee: bigint
  ): EvictKey {
    const nearest = deadline === null ? Infinity : deadline;
    const tip = tx.effectiveTip(baseFee);
    return this.config.evictFirst === "expiry"
      ? [nearest, tip, -seq]
      : [tip, nearest, -seq];
  }

  /**
   * FP-14: the held transaction to evict for `tx`, or null when `tx` itself
   * is the victim. The reference keeps the held keys in a heap; the minimum
   * over the pool is the same transaction.
   */
  protected victim(
    tx: FrameTx,
    seq: number,
    deadline: bigint | null
  ): string | null {
    const baseFee = headNextBaseFee(this.head);
    let best: [EvictKey, string] | null = null;
    for (const [h, e] of this.entries) {
      const key = this.evictKey(e.sim.deadline, e.tx, e.seq, baseFee);
      if (best === null || compareKeys(key, best[0]) < 0) best = [key, h];
    }
    if (
      best !== null &&
      compareKeys(best[0], this.evictKey(deadline, tx, seq, baseFee)) < 0
    )
      return best[1];
    return null;
  }

  // --- bookkeeping ----------------------------------------------------------

  private inOrder(hashes: Set<string>): string[] {
    return [...hashes].sort(
      (a, b) =>
        (this.entries.get(a) as Entry).seq - (this.entries.get(b) as Entry).seq
    );
  }

  protected addWork(sender: string, gas: bigint): void {
    this.work.set(sender, (this.work.get(sender) ?? 0n) + gas);
  }

  /** Add `e` to `readers` under its sender, payer and dependencies, or take it out. */
  private index(e: Entry, sign: number): void {
    if (sign > 0)
      e.reads = new Set([
        e.tx.sender,
        e.sim.payer,
        ...[...e.sim.deps.keys()].map((k) => k.addr),
      ]);
    for (const a of e.reads) {
      if (sign > 0) {
        if (!this.readers.has(a)) this.readers.set(a, new Set());
        (this.readers.get(a) as Set<string>).add(e.tx.hash);
      } else {
        const hashes = this.readers.get(a) as Set<string>;
        hashes.delete(e.tx.hash);
        if (hashes.size === 0) this.readers.delete(a);
      }
    }
  }

  private account(e: Entry, sign: number): void {
    const payer = e.sim.payer;
    this.reserved.set(
      payer,
      (this.reserved.get(payer) ?? 0n) + BigInt(sign) * e.tx.maxCost
    );
    const count = (this.payerCount.get(payer) ?? 0) + sign;
    this.payerCount.set(payer, count);
    if (count === 0) {
      this.reserved.delete(payer);
      this.payerCount.delete(payer);
    }
  }

  protected insert(e: Entry): void {
    const tx = e.tx;
    this.entries.set(tx.hash, e);
    if (!this.many(tx)) this.byIdentity.set(identity(tx), tx.hash);
    if (!this.bySender.has(tx.sender)) this.bySender.set(tx.sender, []);
    (this.bySender.get(tx.sender) as string[]).push(tx.hash);
    if (!this.keys.has(tx.sender)) this.keys.set(tx.sender, new Map());
    const used = this.keys.get(tx.sender) as Map<bigint, number>;
    for (const k of tx.nonceKeys) used.set(k, (used.get(k) ?? 0) + 1);
    this.account(e, +1);
    this.index(e, +1);
    if (this.matcha && e.cls.size > 0) {
      if (!this.claims.has(tx.sender)) this.claims.set(tx.sender, new Map());
      const claims = this.claims.get(tx.sender) as Map<string, number>;
      for (const x of e.cls) claims.set(x, (claims.get(x) ?? 0) + 1);
    }
    this.reserver.hold(tx.sender, this);
  }

  protected remove(
    txHash: string,
    reason: string,
    release = true,
    account = true
  ): void {
    const e = this.entries.get(txHash) as Entry;
    this.entries.delete(txHash);
    const tx = e.tx;
    this.dropped.set(reason, (this.dropped.get(reason) ?? 0) + 1);
    this.bases.delete(txHash);
    if (e.cls.size > 0 && this.claims.has(tx.sender)) {
      const claims = this.claims.get(tx.sender) as Map<string, number>;
      for (const x of e.cls) {
        const n = (claims.get(x) ?? 0) - 1;
        if (n > 0) claims.set(x, n);
        else claims.delete(x);
      }
      if (claims.size === 0) this.claims.delete(tx.sender);
    }
    const id = identity(tx);
    if (this.byIdentity.get(id) === txHash) this.byIdentity.delete(id);
    const hashes = this.bySender.get(tx.sender) as string[];
    hashes.splice(hashes.indexOf(txHash), 1);
    const used = this.keys.get(tx.sender) as Map<bigint, number>;
    for (const k of tx.nonceKeys) {
      const n = (used.get(k) as number) - 1;
      if (n > 0) used.set(k, n);
      else used.delete(k);
    }
    if (hashes.length === 0) {
      this.bySender.delete(tx.sender);
      this.keys.delete(tx.sender);
      if (release) this.reserver.release(tx.sender, this);
    }
    if (account) this.account(e, -1);
    this.index(e, -1);
    if (this.config.claims && tx.claim !== null && reason !== "stale_nonce") {
      // CG-6
      const id = claimId(tx.claim);
      this.expiredClaims.set(
        id,
        Math.max(this.expiredClaims.get(id) ?? tx.claim.epoch, tx.claim.epoch)
      );
    }
  }
}
