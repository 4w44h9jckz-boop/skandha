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

## What it covers

| exp-mempool-l2s document | Clauses |
| --- | --- |
| `00-model.md` | MD-2 to MD-4, MD-6 with `zero_bytes` and `verdict`, MD-7, MD-8 with `reset`'s verdicts, FEE-1 to FEE-4 |
| `02-frame-pool.md` | FP-2 to FP-16, profiles `eip-8141` and `hegota-testnet`, with the `reuse_balance`, `evict_first`, `expiry_margin` and `static_first` variants, and FP-8 to FP-10 and FP-15 through a client's verdict |
| `04-matcha.md` | MA-2 to MA-14, profile `matcha` (a proposal) |
| `05-aggregation.md` | AG-2 to AG-6, profile `eip-8288`: dependency frames, and receiving a wrapper and admitting its transactions (`src/aggregation.ts`); not building an aggregate (AG-7 to AG-9) |
| `08-recent-roots.md` | RR-3 to RR-7, profiles `eip-8272` and, since its version 2, `hegota-testnet` |
| `09-expiring-nonces.md` | EN-2 to EN-6, profile `eip-8266` |
| `11-surface.md` | SF-1 to SF-9: decoding, the model transaction, the verdict, `eth_sendRawTransaction`, relay, what is taken from peers, head changes and hand-off (`src/surface.ts`, `src/keccak.ts`) |
| `12-replay.md` | RP-1 to RP-6: a profile's verdict on a transaction a chain mined (`src/replay.ts`, and `replay/` over every fixture) |
| `07-focil.md` | IL-1 to IL-6 for frame transactions, version 2: an includer's list from the pool (IL-2), Profile 2 candidates (IL-3), the budget fill per list or per payload, profiles `eip-8369` and `ethrex` (IL-4), and, with validity at the end of the payload as a client's verdict, whether a payload satisfies the lists (IL-5, IL-6) (`src/focil.ts`) |
| `06-lucid.md` | LU-2 to LU-11 and LU-14 to LU-19, profile `eip-8184`, version 3: the sealed pool beside the frame pool behind one reservation tracker, with every `policy` and `evict_first` (`src/sealed.ts`, `src/sealedpool.ts`), and the key round between the block that commits and the block that runs: the commitment, a key message's validity, the key-publisher role's release rule, a committee member's vote, the next slot's tally and what the record says of a missing key (`src/lucidkeys.ts`) |
| `03-block-building.md` | BB-2's order, for frame transactions only |
| `10-claim-gated-admission.md` | CG-2 to CG-10, profile `claim-gated` (a proposal), version 3: claims checked after FP-6, the checks before a wrapper's proofs, what a node remembers after a proof fails, relays, and a ticket's bytes, its BLS12-381 check and the paymaster frame that carries it (`src/claimticket.ts`) |

It does not have the account-nonce pool of `01-nonce-pool.md`, which belongs
to an execution client, block building, so not IL-7's appending or
LU-12's and LU-13's commitments and decrypted transactions, or an
aggregator's side of `05-aggregation.md`.

The key round reads tickets, the scheduling block, key messages, the times
they arrived and votes. LU-15's last step, whether a released key decrypts
its ciphertext, is the one that reads content; it goes through a `Decrypt`
function, and the vectors check which ciphertexts each step asked about.
Keys and commitments are real bytes, checked with this package's
Keccak-256; the decryption itself, ChaCha20-Poly1305 and SSZ, is not here:
the vectors give its outcome as the field `decrypts`. No chain runs
EIP-8184 yet, so the key-publisher role is a rule a node can apply to a
block it observes (`release`), not a service run against one.

A ticket's signature is checked with `@noble/curves`, not with the code the
ticket vectors were made with, so that they judge a verifier that shares
nothing with them. `src/claimticket.ts` decodes EIP-2537's encoding itself,
with its padding rule, and noble checks the range, the curve and the
subgroup when it makes the points. noble's own decoder of compressed points
is not used: it reduces a coordinate of $p$ or more rather than refusing it.

The pool is a port of exp-mempool-l2s `ref/python/emem/`, read alongside the clauses,
and keeps the clause names in its comments. Three shortcuts of the reference
are not ported: FP-14's victim and MA-8's oldest transaction are found by a
pass over the pool rather than kept in a heap, and the sealed pool runs
LU-7's selection again for each question LU-8 and LU-10 ask rather than
carrying it from one admission to the next. Each gives the same answer. Every amount (gas, fees, balances, nonce keys and sequences) and
every deadline is a `bigint`, because the vectors use values up to
$2^{256} - 1$ and a mined transaction's deadline can be $2^{64} - 1$, which a
double cannot hold: the first surface vectors found exactly that in the port,
where a deadline had been a `number`.

## The vectors

`test/vectors/` is a byte-for-byte copy of exp-mempool-l2s `conformance/vectors/` at
the commit in `test/vectors.commit`. `test/vectors.sha256` lists every file's
SHA-256, and the runner refuses to play anything if a file differs from it.
**A vector is never edited here.** When this package and a vector disagree,
the disagreement is settled in exp-mempool-l2s, by the three cases in exp-mempool-l2s's
`conformance/README.md`: the implementation is wrong, the vector is wrong,
or the clause is ambiguous. Then the vectors are copied again:

```sh
tools/sync-vectors.sh <path to an exp-mempool-l2s checkout> <commit>
```

The runner decides from each case's contents whether it can play the case. A
case that adds an account-nonce transaction, builds a block,
drives an aggregator or names a profile this package does not have is
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

## Running

```sh
bun install                 # at the repository root
cd packages/framepool
bun run test                # vitest, one test a vector case
bun run vectors             # one line a failure, the skips by what they need, and the totals
bun run check-types
```
