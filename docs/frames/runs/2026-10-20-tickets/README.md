# One node, tickets from the Hegota testnet: 2026-10-20

A node with `--frames.claims` and nothing else configured, given the
testnet's own ticket transactions. The claim it tests is that a node can
check "a prepaid, unlinkable claim checked before the proof, a blind
ticket" itself, before it asks its client anything: exp-mempool-l2s
`docs/spec/10-claim-gated-admission.md` version 4 and
`docs/spec/11-surface.md` version 3. What would show it wrong, written
before the run: the node asks its client about a ticket that does not
verify, or refuses a ticket that does, or needs to be told which
paymasters issue tickets.

## Setup

- skandha at `0e7e632`, built with `bun install && bun run build`;
  framepool's vectors from exp-mempool-l2s `10fd022`.
- The Hegota testnet's client, as `web3_clientVersion` answered
  (`client-version.txt`), at `https://rpc1.privacy.ethrex.xyz`.
- Node A as in [`FRAMES.md`](../../../../FRAMES.md), "Tickets: claim-gated
  admission", with `--frames.log` writing `a.frames.jsonl`. No hand-off and
  no peers: nothing here needs them.

The transactions are those of a wallet's run on the testnet, recorded in
kohaku-rs `eea02a3`, `crates/frame-ticket/tests/fixtures/record.json`, all
from fresh senders paying through one ticket paymaster,
`0x273795f6eb2730d50c3544cbef1e0c1adba4f541`, whose code (1,393 bytes at
the run's head) is the template, a key and a denomination. The node was not
told this address or its key. The last is a transaction with no ticket,
exp-mempool-l2s' `sf-05-send-raw.json`'s first, mined long before.

## What happened

Head 482,700 has timestamp 1792494913, so its epoch is
$\lfloor 1792494913 / 384 \rfloor = 4667955$; the tickets name 4667928, the
epoch they were spent in.

| Time (UTC) | Transaction | Answer | Claim read | Client asked |
| --- | --- | --- | --- | --- |
| 11:15:18.025 | `0xe178b6f6…` a signature that is no ticket | `ErrClaimInvalid` | epoch 4667928, not valid | no |
| 11:15:18.358 | `0x01d9a6d1…` a spent ticket under another sender | `ErrClaimInvalid` | epoch 4667928, not valid | no |
| 11:15:18.737 | `0x2af5f559…` a spent ticket at its sender's next sequence | `ErrClaimInvalid` | epoch 4667928, not valid | no |
| 11:15:18.969 | `0x0bba93ca…` the mined spend | `ErrClaimEpoch` | epoch 4667928, valid | no |
| 11:15:19.243 | `0x045fb58b…` no ticket | `ErrNonceTooLow` | none | no |

A line with no `client` field is a transaction the client was not asked
about (SF-4). The testnet's client, asked about the first three when the
wallet sent them, simulated each prefix and answered `validation prefix
frame reverted`.

## Result

- **Would show it wrong, not observed.** The node found the ticket
  paymaster by its code alone, refused the three tickets that do not verify
  with one signature check each and no simulation, and read the mined
  ticket as valid, refusing it only because its epoch has passed.
- **Limits.** No fresh ticket was admitted here: that needs an issuer
  signing one for the current epoch, which the vectors stand in for
  (`sf-05-send-raw.json`: the mined spend at the head it was built on is
  asked about and admitted). One node, one client, five transactions.
- A ticket paymaster is held to FP-11's one pending transaction, as the
  testnet's client holds it (`FRAMES.md`).
