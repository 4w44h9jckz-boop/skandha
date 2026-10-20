# `@skandha/framepool`

The mempool rules for EIP-8141 frame transactions, in TypeScript. This package
is a second implementation of the frame pool that
[exp-mempool-l2s](https://github.com/4w44h9jckz-boop/exp-mempool-l2s) specifies in `docs/spec/`. It
is checked against exp-mempool-l2s's hand-written conformance vectors, and exp-mempool-l2s's
specification is the normative one. The reasons are in exp-mempool-l2s's decision record
0035.

The pool itself depends on nothing else in skandha. Since exp-mempool-l2s's item 42 it
also has the surface around it, `src/surface.ts`: a type `0x06` transaction
decoded from its bytes and named by its keccak256, the validation prefix's
outcome taken from an execution client's verdict, and the steps of
`eth_sendRawTransaction`, relay and a new head. `@skandha/node` uses it to take
frame transactions over the bundler's JSON-RPC and gossip; [`FRAMES.md`](../../FRAMES.md)
says how to run two such nodes against the Hegota testnet.

Since exp-mempool-l2s's `13-descriptors.md` a ruleset can also be a file: a
descriptor names the rules as modules with their parameters, has an
identifier derived from its canonical encoding, and may inherit from a
parent. `src/descriptor.ts` loads one with its own strict JSON parser and
compiles it to a pool profile, and a refusal under it names the module and
the descriptor. ERC-8421's standard ruleset (`14-erc-8421.md`) is one such
file and runs as `StandardPool`, a frame pool with six of its modules
replaced. The node loads a descriptor with `--frames.descriptor`; ERC-8421's
needs a tracer the execution client does not offer, so the node refuses it
and only the vectors play it.

Since exp-mempool-l2s's `05-aggregation.md` version 4 it also has the
aggregator, `Aggregator` in `src/aggregation.ts`: a node's side of EIP-8288,
which receives wrappers (AG-5, AG-6) and folds, once an interval, every
transaction it holds into one aggregate (AG-7), within the limits of AG-5,
a proving budget (AG-9) and a memory budget (AG-10). Under the profile
`eip-8288-master`, EIP-8288 as ethereum/EIPs master has it, the defined
scheme is leanSPHINCS: a dependency frame that uses leanSTARK is refused,
as the EIP reserves it. `test/two-folds.ts` runs two pools, each with its
aggregator, that fold the same dependencies and each accept the other's
fold (below).

## What it covers

| exp-mempool-l2s document | Clauses |
| --- | --- |
| `00-model.md` | MD-2 to MD-4, version 10: an account's stake, and MD-6 with `zero_bytes`, `verdict` and a slot's association, MD-7, MD-8 with `reset`'s verdicts, FEE-1 to FEE-4 |
| `02-frame-pool.md` | FP-2 to FP-16, profiles `eip-8141` and `hegota-testnet`, with the `reuse_balance`, `evict_first`, `expiry_margin` and `static_first` variants, and FP-8 to FP-10 and FP-15 through a client's verdict |
| `04-matcha.md` | MA-2 to MA-14, profile `matcha` (a proposal) |
| `05-aggregation.md` | AG-2 to AG-7, AG-9 and AG-10, version 4, profiles `eip-8288` and `eip-8288-master`: dependency frames, receiving a wrapper and admitting its transactions, and the aggregator's fold with its proving time and memory (`src/aggregation.ts`); not AG-8's charge to a block, which is block building |
| `08-recent-roots.md` | RR-3 to RR-7, profiles `eip-8272` and, since its version 2, `hegota-testnet` |
| `09-expiring-nonces.md` | EN-2 to EN-6, profile `eip-8266` |
| `11-surface.md` | SF-1 to SF-9: decoding, the model transaction, the verdict, `eth_sendRawTransaction`, relay, what is taken from peers, head changes and hand-off (`src/surface.ts`, `src/keccak.ts`) |
| `12-replay.md` | RP-1 to RP-6: a profile's verdict on a transaction a chain mined (`src/replay.ts`, and `replay/` over every fixture) |
| `07-focil.md` | IL-1 to IL-6 for frame transactions, version 2: an includer's list from the pool (IL-2), Profile 2 candidates (IL-3), the budget fill per list or per payload, profiles `eip-8369` and `ethrex` (IL-4), and, with validity at the end of the payload as a client's verdict, whether a payload satisfies the lists (IL-5, IL-6) (`src/focil.ts`) |
| `03-block-building.md` | BB-2's order, for frame transactions only |
| `10-claim-gated-admission.md` | CG-2 to CG-10, profile `claim-gated` (a proposal), version 3: claims checked after FP-6, the checks before a wrapper's proofs, what a node remembers after a proof fails, relays, and a ticket's bytes, its BLS12-381 check and the paymaster frame that carries it (`src/claimticket.ts`) |
| `13-descriptors.md` | DS-1 to DS-8: a ruleset as a file, its strict parse, canonical encoding and CIDv1 identifier, modules, inheritance, completeness, the profile it compiles to, and the rule and descriptor a refusal names (`src/descriptor.ts`) |
| `14-erc-8421.md` | AM-2 to AM-14 and AM-16: ERC-8421's standard alternative mempool as a pool, entities, stake, per-entity budgets, `pre_verify` frames, trace and storage rules, keyed-nonce lifecycle and limits, local rules, solvency, reputation and blame (`src/erc8421.ts`, `StandardPool`) |

It does not have the account-nonce pool of `01-nonce-pool.md`, which belongs
to an execution client, the sealed pool of `06-lucid.md`, or block building,
so not IL-7's appending or AG-8.

A ticket's signature is checked with `@noble/curves`, not with the code the
ticket vectors were made with, so that they judge a verifier that shares
nothing with them. `src/claimticket.ts` decodes EIP-2537's encoding itself,
with its padding rule, and noble checks the range, the curve and the
subgroup when it makes the points. noble's own decoder of compressed points
is not used: it reduces a coordinate of $p$ or more rather than refusing it.

The pool is a port of exp-mempool-l2s `ref/python/emem/`, read alongside the clauses,
and keeps the clause names in its comments. Two shortcuts of the reference
are not ported: FP-14's victim and MA-8's oldest transaction are found by a
pass over the pool rather than kept in a heap. Both give the same
transaction. Every amount (gas, fees, balances, nonce keys and sequences) and
every deadline is a `bigint`, because the vectors use values up to
$2^{256} - 1$ and a mined transaction's deadline can be $2^{64} - 1$, which a
double cannot hold: the first surface vectors found exactly that in the port,
where a deadline had been a `number`.

## The vectors

`test/vectors/` is a byte-for-byte copy of exp-mempool-l2s `conformance/vectors/` at
the commit in `test/vectors.commit`, and `test/descriptors/` of its
`docs/spec/descriptors/`, which the descriptor vectors load by path.
`test/vectors.sha256` and `test/descriptors.sha256` list every file's
SHA-256, and the runner refuses to play anything if a file differs from it.
**A vector is never edited here.** When this package and a vector disagree,
the disagreement is settled in exp-mempool-l2s, by the three cases in exp-mempool-l2s's
`conformance/README.md`: the implementation is wrong, the vector is wrong,
or the clause is ambiguous. Then the vectors are copied again:

```sh
tools/sync-vectors.sh <path to an exp-mempool-l2s checkout> <commit>
```

The runner decides from each case's contents whether it can play the case. A
case that adds an account-nonce or sealed transaction, builds a block,
runs an operation or names a profile this package does not have is
skipped, and the skip names what is missing. There is no list of
skipped cases by name: a list could quietly take in a failing case, and a rule
over what the case contains cannot.

`bun run vectors` prints one line for each failing case, the skipped cases
grouped by what they need, and the totals. The exp-mempool-l2s commit it was last
played against, with its totals, is in this package's latest commit message.

## The replay

`replay/` plays exp-mempool-l2s `12-replay.md` over every frame transaction
[exp-frames](https://github.com/4w44h9jckz-boop/exp-frames) has mined:

```sh
bun replay/snapshot.ts <exp-frames checkout> https://rpc1.privacy.ethrex.xyz replay/fixtures-exp-frames-<commit>.json
bun replay/run.ts replay/fixtures-exp-frames-85ee60d.json > replay/results.md
```

The snapshot keeps each fixture's bytes only if they hash to the chain's
hash, with its receipt's payer and its parent block's header; it reads no
state, because the testnet answers a state read at an old block with the
latest state. `replay/results.md` is generated: run the second command again
and compare. Its totals are the result.

## Two aggregators

`bun run two-folds` plays the exchange in `test/two-folds.ts`, and
`test/unit/two-folds.test.ts` checks it. Two nodes, A and B, each a frame
pool with its aggregator under `eip-8288-master`, take twelve users' mode 0
wrappers, each spend with one leanSPHINCS dependency and every third with a
zero `data_hash`, which stands for the spend's signature hash. Even users go
to A, odd ones to B. Proving time is AG-9's at the laptop's costs that
exp-mempool-l2s's experiment 24 reports, within a budget of one aggregation
interval.

| Round | Each node folds | Its dependencies | Proving time | The other's answer |
| --- | --- | --- | --- | --- |
| 1 | its own 6, directly | 6 | 99.5 ms | `ok` for each of 6 |
| 2 | all 12, its last aggregate and the other's as inputs | 12, the other's | 435.1 ms | `ErrAlreadyKnown` for each of 12 |
| 3 | the 10 left after a block includes one spend from each | 10, the other's | 257.1 ms | `ErrAlreadyKnown` for each of 10 |
| 4 | A's fold with one dependency left out | 9 | | `ErrWrapperDeps` |

In rounds 2 and 3 neither node refuses the other's fold, and each spend in it
is one it already holds. After the block, each node folds again with its last
aggregate as one recursive input, which discards the two included spends'
dependencies: the price of a dropped dependency is one recursive input, not a
proof of each dependency left.

The two nodes are two pools in one process. Two running nodes cannot
exchange a fold yet: `AGGREGATED_VK` and `DEPS_HASH` are still to be chosen
in EIP-8288, so no recursive STARK can be made or checked to it. The
model's recursive STARK is the list of dependencies it covers.

## Running

```sh
bun install                 # at the repository root
cd packages/framepool
bun run test                # vitest, one test a vector case
bun run vectors             # one line a failure, the skips by what they need, and the totals
bun run two-folds           # two aggregators fold the same dependencies
bun run check-types
```
