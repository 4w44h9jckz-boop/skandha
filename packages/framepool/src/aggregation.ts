/**
 * In-mempool aggregation (EIP-8288): exp-mempool-l2s `docs/spec/05-aggregation.md`,
 * AG-5 and AG-6 for receiving a wrapper, with CG-3 to CG-5 and CG-7 of
 * `10-claim-gated-admission.md` under `claims`, and AG-7, AG-9 and AG-10 for
 * a node's aggregate, its fold every interval (`Aggregator`).
 *
 * Nothing here proves anything: a proof is a flag, and a recursive STARK is
 * the list of triples whose hash is its public input, with a flag (decision
 * record 0012). Proving time and memory are counted, not spent: AG-9's and
 * AG-10's linear counts of the circuit's inputs, which bound what an
 * aggregate lists when the profile sets a budget (decision records 0034 and
 * 0042).
 */
import * as E from "./errors.js";
import { TxError } from "./errors.js";
import { counts, dependencies, union } from "./dependencies.js";
import { headNextBaseFee } from "./model.js";
import { FramePool } from "./pool.js";
import {
  Dependency,
  FrameTx,
  LEANSPHINCS,
  compareDependencies,
  dependencyId,
} from "./tx.js";

/** A recursive STARK: the triples its public input is the hash of, and whether it verifies. */
export interface Stark {
  readonly covers: readonly Dependency[];
  readonly valid: boolean;
}

/** AG-5. `txs` holds frame transactions, and the hashes of those sent before. */
export interface Wrapper {
  readonly txs: readonly (FrameTx | string)[];
  readonly mode: number;
  readonly deps: readonly Dependency[];
  readonly proofs: readonly boolean[]; // mode 0: whether each triple's proof verifies
  readonly stark: Stark | null; // mode 1
  readonly signed: readonly boolean[]; // mode 0, CG-3: whether each proof is the one its sender signed; [] if all are
}

const sameDeps = (
  a: readonly Dependency[],
  b: readonly Dependency[]
): boolean =>
  a.length === b.length &&
  a.every((d, i) => dependencyId(d) === dependencyId(b[i]));

/** AG-5 and AG-6: a code refusing the whole wrapper, or one answer per transaction. */
export function receive(
  pool: FramePool,
  wrapper: Wrapper,
  now = 0
): string | string[] {
  const cfg = pool.config;
  const resolved = wrapper.txs.map((entry) =>
    typeof entry === "string" ? pool.entries.get(entry)?.tx ?? null : entry
  );
  const relay = cfg.claims && !cfg.verifies; // CG-7
  try {
    if (relay && wrapper.mode === 1) throw new TxError(E.ErrRelayAggregate); // CG-7 step 1
    if (
      (wrapper.mode !== 0 && wrapper.mode !== 1) ||
      (wrapper.mode === 0 && wrapper.proofs.length !== wrapper.deps.length) ||
      (wrapper.mode === 1 && wrapper.stark === null)
    )
      throw new TxError(E.ErrWrapperMalformed);
    if (wrapper.mode === 0) {
      if (resolved.some((tx) => tx === null))
        throw new TxError(E.ErrWrapperUnknownTx);
      if (!sameDeps(wrapper.deps, union(resolved as FrameTx[], cfg)))
        throw new TxError(E.ErrWrapperDeps);
    } else {
      if (!sameDeps((wrapper.stark as Stark).covers, wrapper.deps))
        throw new TxError(E.ErrWrapperDeps);
      if (cfg.mode1Union) {
        // as far as the node can see (exp-mempool-l2s decision record 0063)
        const listed = new Set(wrapper.deps.map(dependencyId));
        const seen = union(
          resolved.filter((tx): tx is FrameTx => tx !== null),
          cfg
        ).map(dependencyId);
        if (
          !seen.every((id) => listed.has(id)) ||
          (resolved.every((tx) => tx !== null) && seen.length !== listed.size)
        )
          throw new TxError(E.ErrWrapperDeps);
      }
    }
    if (wrapper.mode === 0 || cfg.capAggregates) {
      const [sigs, starks] = counts(wrapper.deps);
      if (
        sigs > cfg.maxSigDepsPerWrapper ||
        starks > cfg.maxStarkDepsPerWrapper
      )
        throw new TxError(E.ErrWrapperTooManyDeps);
    }
    const gated = wrapper.mode === 0 && cfg.claims;
    if (gated) {
      // CG-3
      if (cfg.signedProofs && !wrapper.signed.every((x) => x))
        throw new TxError(E.ErrProofUnsigned);
      for (const tx of resolved as FrameTx[]) pool.precheck(tx);
    }
    if (relay) {
      // CG-7 step 2: no proof verified, and CG-5's record made
      for (const tx of resolved as FrameTx[]) pool.proofVerified(tx, false);
    } else if (wrapper.mode === 0) {
      if (gated) {
        // CG-4, CG-5
        const bad = new Set(
          wrapper.deps.filter((_, i) => !wrapper.proofs[i]).map(dependencyId)
        );
        for (const tx of resolved as FrameTx[])
          pool.proofVerified(
            tx,
            dependencies(tx, cfg).some((d) => bad.has(dependencyId(d)))
          );
      }
      if (!wrapper.proofs.every((x) => x)) throw new TxError(E.ErrWrapperProof);
    } else if (!(wrapper.stark as Stark).valid) {
      throw new TxError(E.ErrWrapperProof);
    }
  } catch (err) {
    if (err instanceof TxError) return err.code;
    throw err;
  }
  const into = relay ? pool.relayed : pool.proven; // CG-7 steps 2 and 3, or AG-6
  for (const d of wrapper.deps) into.add(dependencyId(d));
  const fresh: FrameTx[] = [];
  const seen = new Set<string>();
  for (const tx of resolved) {
    // what the node holds is answered without asking the pool again
    if (tx !== null && !pool.entries.has(tx.hash) && !seen.has(tx.hash)) {
      fresh.push(tx);
      seen.add(tx.hash);
    }
  }
  const answers = new Map<string, string>();
  pool.add(fresh, now).forEach((a, i) => answers.set(fresh[i].hash, a));
  return resolved.map((tx) => {
    if (tx === null) return E.ErrWrapperUnknownTx;
    const a = answers.get(tx.hash);
    answers.delete(tx.hash);
    return a ?? E.ErrAlreadyKnown;
  });
}

/**
 * AG-5 to AG-7, AG-9 and AG-10 for the node whose pool this is: it receives
 * wrappers through `receive` and folds what it holds every interval with
 * `aggregate`. The proven triples live on the pool (AG-6).
 */
export class Aggregator {
  private previous: string[] = []; // AG-7 step 1: its last aggregate, in order
  private previousDeps: Dependency[] = []; // AG-9 rule 1: what that aggregate's STARK covers
  private readonly sent = new Set<string>(); // the transactions it has sent in an aggregate
  private received: [Wrapper, string[]][] = []; // AG-7 step 2: each aggregate received since, and its list
  private readonly direct = new Set<string>(); // AG-9 rule 3: triples whose proofs it verified in a mode 0 wrapper
  private readonly firstCover = new Map<string, Wrapper>(); // AG-9 rule 4: the first aggregate covering each triple
  provingTime = 0; // AG-9: the last aggregate's, in ms, 0 when it listed nothing
  memory = 0; // AG-10: the last aggregate's, in MiB, 0 when it listed nothing

  constructor(readonly pool: FramePool) {}

  /** AG-5 and AG-6, recording what AG-7 and AG-9 read later. */
  receive(wrapper: Wrapper, now = 0): string | string[] {
    const pool = this.pool;
    const resolved = wrapper.txs.map((entry) =>
      typeof entry === "string" ? pool.entries.get(entry)?.tx ?? null : entry
    );
    const out = receive(pool, wrapper, now);
    if (typeof out === "string") return out;
    if (!(pool.config.claims && !pool.config.verifies)) {
      for (const d of wrapper.deps) {
        const id = dependencyId(d);
        if (wrapper.mode === 0) this.direct.add(id);
        else if (!this.firstCover.has(id)) this.firstCover.set(id, wrapper);
      }
    }
    if (wrapper.mode === 1)
      this.received.push([
        wrapper,
        resolved
          .filter((tx): tx is FrameTx => tx !== null)
          .map((tx) => tx.hash),
      ]);
    return out;
  }

  /** AG-7: this interval's aggregate, or null for a node that lists nothing; AG-9 and AG-10 bound it. */
  aggregate(): Wrapper | null {
    const pool = this.pool;
    const cfg = pool.config;
    const owned = new Map<string, readonly Dependency[]>();
    for (const [h, e] of pool.entries) {
      const deps = dependencies(e.tx, cfg); // AG-4 under the profile
      if (deps.length > 0) owned.set(h, deps);
    }
    const received = this.received;
    this.received = [];
    this.provingTime = 0;
    this.memory = 0;
    if (owned.size === 0 || (cfg.claims && !cfg.verifies)) {
      // CG-7 step 5: a relay builds none
      this.previous = [];
      this.previousDeps = [];
      return null;
    }
    const listed: string[] = [];
    const chosen = new Set<string>();
    const deps = new Map<string, Dependency>();
    const covered = new Set<string>(); // AG-9: what the inputs taken and the direct proofs cover
    const taken = new Set<Wrapper | "previous">(); // the inputs taken
    let time = 0;
    let memory = 0;
    const previousCover = new Set(this.previousDeps.map(dependencyId));
    const proveOf = (d: Dependency): number =>
      d.scheme === LEANSPHINCS ? cfg.proveSig : cfg.proveStark;
    const memoryOf = (d: Dependency): number =>
      d.scheme === LEANSPHINCS ? cfg.memorySig : cfg.memoryStark;

    const consider = (h: string, source: Wrapper | null = null): void => {
      if (chosen.has(h) || !owned.has(h)) return;
      const mine = owned.get(h) as readonly Dependency[];
      const more = new Map(deps);
      for (const d of mine) more.set(dependencyId(d), d);
      if (cfg.capAggregates) {
        const [sigs, starks] = counts([...more.values()]);
        if (
          sigs > cfg.maxSigDepsPerWrapper ||
          starks > cfg.maxStarkDepsPerWrapper
        )
          return;
      }
      const inputs = new Map<Wrapper | "previous", readonly Dependency[]>(); // AG-9: the inputs it adds
      const verify = new Map<string, Dependency>();
      const sourceCover = new Set((source?.deps ?? []).map(dependencyId));
      for (const d of mine) {
        const id = dependencyId(d);
        if (
          covered.has(id) ||
          verify.has(id) ||
          [...inputs.values()].some((c) =>
            c.some((x) => dependencyId(x) === id)
          )
        )
          continue;
        let key: Wrapper | "previous";
        let cover: readonly Dependency[];
        if (previousCover.has(id)) {
          key = "previous"; // 1
          cover = this.previousDeps;
        } else if (source !== null && sourceCover.has(id)) {
          key = source; // 2
          cover = source.deps;
        } else if (this.direct.has(id) || !this.firstCover.has(id)) {
          verify.set(id, d); // 3
          continue;
        } else {
          key = this.firstCover.get(id) as Wrapper; // 4
          cover = key.deps;
        }
        if (!taken.has(key)) inputs.set(key, cover);
      }
      const extra =
        (listed.length > 0 ? 0 : cfg.proveBase) +
        cfg.proveRecursive * inputs.size +
        [...verify.values()].reduce((t, d) => t + proveOf(d), 0);
      if (cfg.provingBudget !== null && time + extra > cfg.provingBudget)
        return;
      const moreMemory =
        (listed.length > 0 ? 0 : cfg.memoryBase) +
        cfg.memoryRecursive * inputs.size +
        [...verify.values()].reduce((m, d) => m + memoryOf(d), 0); // AG-10, over AG-9's inputs
      if (cfg.memoryBudget !== null && memory + moreMemory > cfg.memoryBudget)
        return;
      for (const [key, cover] of inputs) {
        taken.add(key);
        for (const d of cover) covered.add(dependencyId(d));
      }
      for (const id of verify.keys()) covered.add(id);
      time += extra;
      memory += moreMemory;
      for (const [id, d] of more) deps.set(id, d);
      chosen.add(h);
      listed.push(h);
    };

    for (const h of this.previous) consider(h); // 1
    while (received.length > 0) {
      // 2: the one with the most transactions not yet listed, ties to the first received
      let best = 0;
      let most = -1;
      received.forEach(([, hashes], i) => {
        const n = hashes.filter((h) => owned.has(h) && !chosen.has(h)).length;
        if (n > most) {
          most = n;
          best = i;
        }
      });
      const [wrapper, hashes] = received.splice(best, 1)[0];
      for (const h of hashes) consider(h, wrapper);
    }
    const baseFee = headNextBaseFee(pool.head); // 3
    const rest = [...owned.keys()]
      .filter((h) => !chosen.has(h))
      .map(
        (h) =>
          pool.entries.get(h) as NonNullable<
            ReturnType<typeof pool.entries.get>
          >
      )
      .sort((a, b) => {
        const ta = a.tx.effectiveTip(baseFee);
        const tb = b.tx.effectiveTip(baseFee);
        return ta > tb ? -1 : ta < tb ? 1 : a.seq - b.seq;
      });
    for (const e of rest) consider(e.tx.hash);
    if (listed.length === 0) {
      this.previous = [];
      this.previousDeps = [];
      return null;
    }
    const entries = listed.map((h) =>
      this.sent.has(h) ? h : (pool.entries.get(h) as { tx: FrameTx }).tx
    );
    for (const h of listed) this.sent.add(h);
    this.previous = listed;
    const coveredDeps = [...deps.values()].sort(compareDependencies);
    this.previousDeps = coveredDeps;
    this.provingTime = time;
    this.memory = memory;
    return {
      txs: entries,
      mode: 1,
      deps: coveredDeps,
      proofs: [],
      stark: { covers: coveredDeps, valid: true },
      signed: [],
    };
  }
}
