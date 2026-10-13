# `@skandha/framepool`

The mempool rules for EIP-8141 frame transactions, in TypeScript. This package
is a second implementation of the frame pool that
[emem](https://github.com/4w44h9jckz-boop/emem) specifies in `docs/spec/`. It
is checked against emem's hand-written conformance vectors, and emem's
specification is the normative one. The reasons are in emem's decision record
0035.

It does not depend on the rest of skandha, and nothing in skandha calls it
yet. Taking frame transactions over the bundler's RPC and P2P needs signing,
RLP and a client to simulate the validation prefix, and comes later.

## What it covers

| emem document | Clauses |
| --- | --- |
| `00-model.md` | MD-2 to MD-4, MD-7, FEE-1 to FEE-4 |
| `02-frame-pool.md` | FP-2 to FP-16, profiles `eip-8141` and `hegota-testnet`, with the `reuse_balance`, `evict_first`, `expiry_margin` and `static_first` variants |
| `04-matcha.md` | MA-2 to MA-14, profile `matcha` (a proposal) |
| `05-aggregation.md` | AG-2 to AG-4 and AG-6's admission rule, profile `eip-8288`; not the aggregator (AG-5, AG-7 to AG-9) |
| `08-recent-roots.md` | RR-3 to RR-7, profile `eip-8272` |
| `09-expiring-nonces.md` | EN-2 to EN-6, profile `eip-8266` |
| `03-block-building.md` | BB-2's order, for frame transactions only |

It does not have the account-nonce pool of `01-nonce-pool.md`, which belongs
to an execution client, the sealed pool of `06-lucid.md`, block building, or
the inclusion lists of `07-focil.md`.

The code is a port of emem's `ref/python/emem/`, read alongside the clauses,
and keeps the clause names in its comments. Two shortcuts of the reference
are not ported: FP-14's victim and MA-8's oldest transaction are found by a
pass over the pool rather than kept in a heap. Both give the same
transaction. Every amount (gas, fees, balances, nonce keys and sequences) is
a `bigint`, because the vectors use values up to $2^{256} - 1$.

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
case that adds an account-nonce or sealed transaction, builds a block, lists
an inclusion list or drives an aggregator is skipped, and the skip names what
is missing. There is no list of skipped cases by name: a list could quietly
take in a failing case, and a rule over what the case contains cannot.

## Running

```sh
bun install                 # at the repository root
cd packages/framepool
bun run test                # vitest, one test a vector case
bun run vectors             # one line a failure, the skips by what they need, and the totals
bun run check-types
```

On 2026-10-13, against emem `6932e756`, `bun run vectors` printed
`212 passed, 0 failed, 261 skipped, 75 vector files`. The played cases by
emem's vector set:

| Set | Played | Skipped |
| --- | --- | --- |
| `model` | 18 | 0 |
| `frame-pool` | 82 | 4 |
| `matcha` | 46 | 0 |
| `aggregation` | 28 | 59 |
| `recent-roots` | 26 | 8 |
| `expiring` | 12 | 4 |
| `nonce-pool`, `lucid`, `focil`, `block-building` | 0 | 186 |

The four skipped `frame-pool` cases are FP-13's, where a sender's
reservation passes between the frame pool and the account-nonce pool. They
need that pool on the other side.
