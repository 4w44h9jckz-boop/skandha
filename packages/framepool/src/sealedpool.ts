/**
 * The sealed transaction pool (EIP-8184, LUCID): exp-mempool-l2s
 * `docs/spec/06-lucid.md`, LU-4, LU-5 and LU-8 to LU-11.
 *
 * A third subpool behind the reservation tracker (MD-11), beside the frame
 * pool. It holds at most one sealed transaction per sender, at the sender's
 * nonce, and nothing the next block could not charge.
 *
 * Unlike the reference, which carries LU-7's walk incrementally, this pool
 * runs the selection again for each question LU-8 and LU-10 ask. The answers
 * are the clauses' either way; only the cost differs.
 */
import * as E from "./errors.js";
import { TxError } from "./errors.js";
import { Head, State, headNextBaseFee } from "./model.js";
import { Reserver } from "./reserver.js";
import {
  SEALED_OFF,
  SealedPoolConfig,
  SealedTx,
  compareCommitment,
  fees,
  select,
  tobGasLimit,
} from "./sealed.js";
import { replaces } from "./tx.js";

export class SealedPool {
  private entries = new Map<string, SealedTx>(); // by hash, in the order admitted
  private bySender = new Map<string, string>();

  constructor(
    private head: Head,
    private state: State,
    readonly config: SealedPoolConfig = SEALED_OFF,
    readonly reserver: Reserver = new Reserver()
  ) {}

  // --- the pool interface (MD-8, MD-9) ------------------------------------------

  add(txs: SealedTx[]): string[] {
    return txs.map((tx) => {
      try {
        this.addOne(tx);
        return E.OK;
      } catch (err) {
        if (err instanceof TxError) return err.code;
        throw err;
      }
    });
  }

  /** LU-11. */
  reset(head: Head, state: State): void {
    this.head = head;
    this.state = state;
    const baseFee = headNextBaseFee(head);
    const room = tobGasLimit(this.config, head.gasLimit);
    for (const tx of [...this.entries.values()])
      if (
        tx.nonce < state.nonce(tx.sender) ||
        state.balance(tx.sender) < tx.cost ||
        fees(tx, baseFee) === null ||
        tx.gasLimit > room
      )
        this.remove(tx);
    if (this.config.policy === "every-head") {
      const keep = new Set(this.selectFrom(this.txs()).map((t) => t.hash));
      for (const tx of this.txs()) if (!keep.has(tx.hash)) this.remove(tx);
    }
  }

  content(): Map<string, SealedTx[]> {
    return new Map(
      [...this.bySender].map(([s, h]) => [s, [this.entries.get(h) as SealedTx]])
    );
  }

  get(hash: string): SealedTx | undefined {
    return this.entries.get(hash);
  }

  txs(): SealedTx[] {
    return [...this.entries.values()];
  }

  /** LU-7 over what the pool holds, against its state and the head's gas limit. */
  selection(baseFee: bigint, minTip = 0n): SealedTx[] {
    return select(
      this.txs(),
      this.state,
      baseFee,
      minTip,
      this.head.gasLimit,
      this.config
    );
  }

  // --- admission --------------------------------------------------------------------

  /** LU-7 over `sts` at the pending base fee and a minimum tip of 0. */
  private selectFrom(sts: SealedTx[]): SealedTx[] {
    return select(
      sts,
      this.state,
      this.baseFee(),
      0n,
      this.head.gasLimit,
      this.config
    );
  }

  private baseFee(): bigint {
    return headNextBaseFee(this.head);
  }

  /** LU-8's test: whether the selection over the pool and `tx`, less `without`, takes `tx`. */
  private placed(tx: SealedTx, without: string | undefined): boolean {
    const others = this.txs().filter((t) => t.hash !== without);
    return this.selectFrom([...others, tx]).some((t) => t.hash === tx.hash);
  }

  /** LU-10: the victim for `tx`, and whether `tx` is admitted for it. */
  private victim(tx: SealedTx): [SealedTx, boolean] {
    const b = this.baseFee();
    const order = this.txs().sort((x, y) => compareCommitment(x, y, b));
    const last = order[order.length - 1];
    const before = (v: SealedTx): boolean => compareCommitment(tx, v, b) < 0;
    if (this.config.evictFirst === "last") return [last, before(last)];
    const taken = new Set(this.selectFrom([...order, tx]).map((t) => t.hash));
    for (let i = order.length - 1; i >= 0; i--)
      if (!taken.has(order[i].hash))
        return [order[i], before(order[i]) || taken.has(tx.hash)];
    return [last, before(last)];
  }

  private addOne(tx: SealedTx): void {
    const c = this.config;
    if (this.entries.has(tx.hash)) throw new TxError(E.ErrAlreadyKnown); // LU-4
    if (!c.sealed) throw new TxError(E.ErrTxTypeNotSupported);
    if (tx.signatureId !== 1) throw new TxError(E.ErrSTMalformed);
    if (!tx.validSignature) throw new TxError(E.ErrInvalidSender);
    if (!tx.ciphertextOk) throw new TxError(E.ErrSTMalformed);
    if (tx.size > c.maxBytesPerSt) throw new TxError(E.ErrOversizedData);
    if (tx.gasLimit > c.maxTxGas) throw new TxError(E.ErrGasLimitTooHigh);
    if (tx.gasLimit < c.calldataGasPerByte * BigInt(tx.size))
      throw new TxError(E.ErrFloorDataGas);
    const baseFee = this.baseFee(); // LU-5
    if (tx.gasLimit > tobGasLimit(c, this.head.gasLimit))
      throw new TxError(E.ErrSTExceedsToB);
    if (this.reserver.heldByOther(tx.sender, this))
      throw new TxError(E.ErrAlreadyReserved);
    const nonce = this.state.nonce(tx.sender);
    if (tx.nonce < nonce) throw new TxError(E.ErrNonceTooLow);
    if (tx.nonce > nonce) throw new TxError(E.ErrNonceTooHigh);
    if (this.state.balance(tx.sender) < tx.cost)
      throw new TxError(E.ErrInsufficientFunds);
    if (fees(tx, baseFee) === null) throw new TxError(E.ErrFeeCapTooLow);
    const oldHash = this.bySender.get(tx.sender);
    if (oldHash !== undefined) {
      // LU-9
      const held = this.entries.get(oldHash) as SealedTx;
      const bumped = (BigInt(100 + c.priceBump) * held.maxTobFee) / 100n;
      if (!replaces(held, tx, c.priceBump) || tx.maxTobFee < bumped)
        throw new TxError(E.ErrReplaceUnderpriced);
    }
    if (c.policy !== "any" && !this.placed(tx, oldHash))
      throw new TxError(E.ErrSTNotIncludable); // LU-8
    let victim: SealedTx | undefined;
    if (oldHash === undefined && this.entries.size >= c.stSlots) {
      // LU-10
      const [v, admitted] = this.victim(tx);
      if (!admitted) throw new TxError(E.ErrUnderpriced);
      victim = v;
    }
    if (victim !== undefined) this.remove(victim);
    if (oldHash !== undefined)
      this.remove(this.entries.get(oldHash) as SealedTx, false);
    else if (!this.reserver.hold(tx.sender, this))
      throw new TxError(E.ErrAlreadyReserved);
    this.entries.set(tx.hash, tx);
    this.bySender.set(tx.sender, tx.hash);
  }

  private remove(tx: SealedTx, release = true): void {
    this.entries.delete(tx.hash);
    this.bySender.delete(tx.sender);
    if (release) this.reserver.release(tx.sender, this);
  }
}
