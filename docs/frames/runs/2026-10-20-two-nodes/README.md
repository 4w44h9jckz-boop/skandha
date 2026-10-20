# Two nodes, one frame transaction, the Hegota testnet: 2026-10-20

The run exp-mempool-l2s `docs/spec/11-surface.md` describes under "Run procedure", for
the proof-of-concept entry M1. The claim is that checking moves from a
rollup's node to "every mempool node, before admission (EIP-8141)". What would
show it wrong, written before the run: two honest nodes reach different
verdicts on the same transaction at the same head.

## Setup

- skandha at `3573f1a`, built with `bun install && bun run build`; framepool's
  vectors from `2665c5d3`, a commit of the specification before it was
  published as `exp-mempool-l2s`.
- The Hegota testnet's client, as `web3_clientVersion` answered:
  `ethrex/v23.0.0-hegota-testnet-hotfix-64b8fc09` (`client-version.txt`), at
  `https://rpc1.privacy.ethrex.xyz`.
- Node A: `--frames.enable`, no hand-off, peer ID
  `16Uiu2HAm8878JnUHBE8NK56QcorCFfUrpskm9rj1X5V22ZZ1vHM4`.
- Node B: `--frames.enable --frames.handoff`, booted from A's ENR, peer ID
  `16Uiu2HAmHdigMm1wXUn8bd4p6JauzDE41mXRsTp7Hp2JTQvNCMJj`. The two nodes were
  each other's only peer.
- Commands as in [`FRAMES.md`](../../../../FRAMES.md), with `--frames.log`
  writing `a.frames.jsonl` and `b.frames.jsonl`.

The transaction is exp-frames' example 1a layout, a self-verifying transfer
of 10^12 wei from a fresh key funded by the testnet faucet: frames
`[VERIFY(self, 20,000), SENDER(transfer, 30,000)]`, one SECP256K1 signature,
nonce sequence 1, 165 bytes. It was built and signed with exp-frames'
library, outside this repository; the key was generated for the run and is
not recorded anywhere.

## What happened

| Time (UTC) | Node | Event |
| --- | --- | --- |
| 03:41:44.495 | A | `eth_sendRawTransaction`: the client's verdict `valid`, admitted, answered `0xd9d959ff…0851a` at head 478,398 |
| 03:41:44.497 | A | published on `/frame-transactions/8141/raw` to 1 peer |
| 03:41:44.795 | B | received by gossip from A's peer ID, the client's verdict `valid`, admitted, gossip outcome `accept`, head 478,398 |
| 03:41:44.901 | B | handed to the client's `eth_sendRawTransaction`, which answered the same hash |
| 03:41:49.841 | B | head 478,399: removed, included |
| 03:41:50.161 | A | head 478,399: removed, included |

The chain's receipt (`receipt.json`): transaction
`0xd9d959ffa3f7a952c681bb59a1738730b608d971b6e866d038443ec839a0851a`, block
478,399 (`0x9c35d871…064181`), status 1, payer the sender
`0x36b454257f551962ef6c9eb0134b635a5e479095`, gas used 26,102.

## Result

- **Done when, met.** A transaction first seen by node A was gossiped to node
  B and mined by an ethrex node. A never sent it to a client: it only asked
  the client for verdicts. B's hand-off is the only submission.
- **Would show it wrong, not observed.** At head 478,398 both nodes admitted
  the transaction on the same verdict, and at 478,399 both removed it as
  included.
- **Limits.** One transaction and two nodes on one machine, sharing one
  client: the run shows the path works and the two verdicts agree, not that
  they agree under load, with different clients, or across a network.
  An earlier run the same day, on the code before it was committed, did the
  same with `0xd3892004…c690`, mined in block 478,263; it is not counted.
