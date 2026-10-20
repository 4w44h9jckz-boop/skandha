/**
 * Receiving a wrapper (EIP-8288): exp-mempool-l2s `docs/spec/05-aggregation.md`,
 * AG-5 and AG-6, with CG-3 to CG-5 and CG-7 of
 * `10-claim-gated-admission.md` under `claims`.
 *
 * Nothing here proves anything: a proof is a flag, and a recursive STARK is
 * the list of triples whose hash is its public input, with a flag (decision
 * record 0012). Building an aggregate, AG-7 to AG-9, is not here.
 */
import * as E from "./errors.js";
import { TxError } from "./errors.js";
import { counts, union } from "./dependencies.js";
import { FramePool } from "./pool.js";
import { Dependency, FrameTx, dependencyId } from "./tx.js";

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
      if (!sameDeps(wrapper.deps, union(resolved as FrameTx[])))
        throw new TxError(E.ErrWrapperDeps);
    } else if (!sameDeps((wrapper.stark as Stark).covers, wrapper.deps)) {
      throw new TxError(E.ErrWrapperDeps);
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
            tx.dependencies.some((d) => bad.has(dependencyId(d)))
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
