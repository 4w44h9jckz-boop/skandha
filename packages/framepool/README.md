# `@skandha/framepool`

The mempool rules for EIP-8141 frame transactions, in TypeScript. This package
is a second implementation of the frame pool that
[emem](https://github.com/4w44h9jckz-boop/emem) specifies in `docs/spec/`. It
is checked against emem's hand-written conformance vectors, and emem's
specification is the normative one. The reasons are in emem's decision record
0035.

The pool itself depends on nothing else in skandha. Since emem's item 42 it
also has the surface around it, `src/surface.ts`: a type `0x06` transaction
decoded from its bytes and named by its keccak256, the validation prefix's
outcome taken from an execution client's verdict, and the steps of
`eth_sendRawTransaction`, relay and a new head. `@skandha/node` uses it to take
frame transactions over the bundler's JSON-RPC and gossip; [`FRAMES.md`](../../FRAMES.md)
says how to run two such nodes against the Hegota testnet.

## What it covers

| emem document | Clauses |
| --- | --- |
| `00-model.md` | MD-2 to MD-4, MD-6 with `zero_bytes` and `verdict`, MD-7, MD-8 with `reset`'s verdicts, FEE-1 to FEE-4 |
| `02-frame-pool.md` | FP-2 to FP-16, profiles `eip-8141` and `hegota-testnet`, with the `reuse_balance`, `evict_first`, `expiry_margin` and `static_first` variants, and FP-8 to FP-10 and FP-15 through a client's verdict |
| `04-matcha.md` | MA-2 to MA-14, profile `matcha` (a proposal) |
| `05-aggregation.md` | AG-2 to AG-4 and AG-6's admission rule, profile `eip-8288`; not the aggregator (AG-5, AG-7 to AG-9) |
| `08-recent-roots.md` | RR-3 to RR-7, profiles `eip-8272` and, since emem's version 2, `hegota-testnet` |
| `09-expiring-nonces.md` | EN-2 to EN-6, profile `eip-8266` |
| `11-surface.md` | SF-1 to SF-9: decoding, the model transaction, the verdict, `eth_sendRawTransaction`, relay, what is taken from peers, head changes and hand-off (`src/surface.ts`, `src/keccak.ts`) |
| `12-replay.md` | RP-1 to RP-6: a profile's verdict on a transaction a chain mined (`src/replay.ts`, and `replay/` over every fixture) |
| `07-focil.md` | IL-1 to IL-6 for frame transactions, version 2: an includer's list from the pool (IL-2), Profile 2 candidates (IL-3), the budget fill per list or per payload, profiles `eip-8369` and `ethrex` (IL-4), and, with validity at the end of the payload as a client's verdict, whether a payload satisfies the lists (IL-5, IL-6) (`src/focil.ts`) |
| `03-block-building.md` | BB-2's order, for frame transactions only |

It does not have the account-nonce pool of `01-nonce-pool.md`, which belongs
to an execution client, the sealed pool of `06-lucid.md`, block building, so
not IL-7's appending, or the claim-gated admission of
`10-claim-gated-admission.md`.

The pool is a port of emem's `ref/python/emem/`, read alongside the clauses,
and keeps the clause names in its comments. Two shortcuts of the reference
are not ported: FP-14's victim and MA-8's oldest transaction are found by a
pass over the pool rather than kept in a heap. Both give the same
transaction. Every amount (gas, fees, balances, nonce keys and sequences) and
every deadline is a `bigint`, because the vectors use values up to
$2^{256} - 1$ and a mined transaction's deadline can be $2^{64} - 1$, which a
double cannot hold: the first surface vectors found exactly that in the port,
where a deadline had been a `number`.

## The vectors

`test/vectors/` is a byte-for-byte copy of emem's `conformance/vectors/` at
the commit in `test/vectors.commit`. `test/vectors.sha256` lists every file's
SHA-256, and the runner refuses to play anything if a file differs from it.
**A vector is never edited here.** When this package and a vector disagree,
the disagreement is settled in emem, by the three cases in emem's
`conformance/README.md`: the implementation is wrong, the vector is wrong,
or the clause is ambiguous. Then the vectors are copied again:

```sh
tools/sync-vectors.sh <path to an emem checkout> <commit>
```

The runner decides from each case's contents whether it can play the case. A
case that adds an account-nonce or sealed transaction, builds a block,
drives an aggregator or names a profile this package does not have is
skipped, and the skip names what is missing. There is no list of
skipped cases by name: a list could quietly take in a failing case, and a rule
over what the case contains cannot.

`bun run vectors` prints one line for each failing case, the skipped cases
grouped by what they need, and the totals. The emem commit it was last
played against, with its totals, is in this package's latest commit message.

## The replay

`replay/` plays emem's `12-replay.md` over every frame transaction
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

## Running

```sh
bun install                 # at the repository root
cd packages/framepool
bun run test                # vitest, one test a vector case
bun run vectors             # one line a failure, the skips by what they need, and the totals
bun run check-types
```
