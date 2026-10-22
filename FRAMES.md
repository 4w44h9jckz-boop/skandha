# Frame transactions on skandha

With `--frames.enable`, a skandha node takes EIP-8141 frame transactions over
`eth_sendRawTransaction` and over a gossipsub topic of its own, and admits
them with `@skandha/framepool` under exp-mempool-l2s `docs/spec/11-surface.md`. The
claim this tests is that checking moves from a rollup's node to "every
mempool node, before admission (EIP-8141)": an open set of nodes, none of them
an operator, each checking for itself.

A node does what the clauses say, in this order:

1. Decodes the bytes (SF-2, SF-3) and names the transaction by keccak256 of
   them.
2. Reads, at its head, the sender's nonce sequences, balance and code, and
   the payer's, from its execution client.
3. Runs FP-2 to FP-7 itself, and only then asks the client to simulate the
   validation prefix at the same head, `ethrex_simulateFrameTransaction`
   (SF-4). The client's answer is the verdict on the prefix; everything else
   the pool decides.
4. Answers `eth_sendRawTransaction` with the hash, or with an error whose
   message starts with the refusal's code (SF-5).
5. Publishes what it admitted on `/frame-transactions/<chain id>/raw`, and
   accepts, ignores or rejects what peers publish there by the same steps
   (SF-6, SF-7): bytes that are not a frame transaction are rejected, any
   other refusal is ignored and not forwarded.
6. At every new head, re-reads the accounts of what it holds, asks the client
   about each transaction still pending, and resets the pool (SF-8).
7. With `--frames.handoff`, sends what it admits to the client's own
   `eth_sendRawTransaction`, which is how a transaction reaches a builder
   (SF-9).

Every admission, relay, head and hand-off is one JSON line in the file
`--frames.log` names.

## Two nodes against the Hegota testnet

Build once, at the repository root:

```sh
bun install && bun run build
```

`bcrypto`'s native module may not build under bun; `NODE_BACKEND=js` selects
its JavaScript backend. A config file names the client; skandha's own
ERC-4337 settings in it are not used by frames:

```json
{
  "entryPoints": ["0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108"],
  "relayers": ["0x0101010101010101010101010101010101010101010101010101010101010101"],
  "rpcEndpoint": "https://rpc1.privacy.ethrex.xyz",
  "canonicalMempoolId": "QmcFZKUX9qoo3StwVycJTAhwdiqbEjcwNvQVK246p3z1rk",
  "canonicalEntryPoint": "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
  "supportedMempools": [{"mempoolId": "QmcFZKUX9qoo3StwVycJTAhwdiqbEjcwNvQVK246p3z1rk", "entryPoint": "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108"}]
}
```

The relayer is a placeholder key that never signs anything here.

Node A takes transactions and hands nothing on:

```sh
NODE_BACKEND=js ./skandha node --configFile hegota.json --dataDir /tmp/a \
  --api.port 14337 --api.wsPort 14437 \
  --p2p.port 14000 --p2p.host 127.0.0.1 --p2p.enrHost 127.0.0.1 --p2p.enrPort 14000 \
  --frames.enable --frames.name A --frames.log /tmp/a.frames.jsonl
```

It prints its ENR (`ENR: enr:...`). Node B boots from it and hands what it
admits to the client:

```sh
NODE_BACKEND=js ./skandha node --configFile hegota.json --dataDir /tmp/b \
  --api.port 14338 --api.wsPort 14438 \
  --p2p.port 14001 --p2p.host 127.0.0.1 --p2p.enrHost 127.0.0.1 --p2p.enrPort 14001 \
  --p2p.bootEnrs <A's ENR> \
  --frames.enable --frames.handoff --frames.name B --frames.log /tmp/b.frames.jsonl
```

Two nodes on one machine need different `--api.wsPort`s: the WebSocket port
defaults to 14337 for both, and the second node exits when it cannot bind it.
`skandha_connectedPeers` on either node shows the other once they are peered.

Send a signed frame transaction to A alone:

```sh
curl -s -X POST -H 'content-type: application/json' http://127.0.0.1:14337/rpc/ \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_sendRawTransaction","params":["0x06..."]}'
```

Then read the logs. A's has `rpc` with `"result":"ok"` and `relay` with the
number of peers; B's has `gossip` with `"from"` A's peer ID and
`"outcome":"accept"`, then `handoff` with the client's answer; both have a
`head` line in which the transaction is removed once a block includes it.
exp-mempool-l2s `docs/spec/11-surface.md`, "Run procedure", is what a run passes on,
and A and B answering differently at the same head is the result that would
show the claim wrong.

A recorded run is in
[`docs/frames/runs/2026-10-20-two-nodes/`](docs/frames/runs/2026-10-20-two-nodes/README.md).

## As an includer

A node with `--frames.enable` also answers `skandha_frameInclusionList` with
the inclusion list it would publish from its pool at its head, by exp-mempool-l2s's
`docs/spec/07-focil.md`, IL-2: what is pending at the next block's base fee,
by effective tip and then arrival, each frame transaction only if it is a
Profile 2 candidate (IL-3) and its verify cost fits what remains of the
list's budget of $2^{20}$ gas, the whole list within 8,192 bytes:

```sh
curl -s -X POST -H 'content-type: application/json' http://127.0.0.1:14337/rpc/ \
  --data '{"jsonrpc":"2.0","id":1,"method":"skandha_frameInclusionList","params":[{"focil":"eip-8369"}]}'
```

The answer has the list's bytes and hashes in order, its verify cost and the
budget, and its size; the node logs it as an `il` line. `eip-8369` budgets
each list on its own; `ethrex` is the same list, since an includer can only
budget what it lists, but whoever reads the slot's lists then fills one
budget over all of them, in the order they arrive (IL-4). Which of the two
lets one committee member's never-valid entries deny honest ones is what the
inclusion-list vectors of `@skandha/framepool` test, on exp-frames
experiment 25's transactions.

## Tickets: claim-gated admission

With `--frames.claims` as well, a node checks the ticket a transaction
carries before it asks its client anything about the prefix, by exp-mempool-l2s
`docs/spec/10-claim-gated-admission.md` and `docs/spec/11-surface.md`
(version 3). There is nothing to configure: no list of paymasters and no
issuer keys. The node runs version 4's admission: version 5 accepts a ticket
paymaster only under a bond, ERC-8421's stake and reputation (CG-11), and
the surface reads no staking registry, so the node has no stake to check;
`@skandha/framepool` plays the bond's vectors instead.

1. For each `VERIFY` frame's target, the node reads the code at its head
   with `eth_getCode`. An account whose code is the 1,105-byte
   ticket-paymaster template (keccak256
   `0xec9f3f855524392a3891f2f2eb554781236d5565520d68388e455be74bdf3fe0`),
   then a 256-byte key in G2 in EIP-2537's encoding, then 32 bytes, is a
   ticket paymaster, and that key is the issuer (CG-10). A paymaster once
   found is kept; any other target is read again at the next head.
2. The first `VERIFY` frame to a ticket paymaster carries the ticket, 168
   bytes: the epoch (8), a salt (32) and a BLS12-381 signature in G1 (128).
   The node builds the 132-byte message from the transaction's chain,
   sender, nonce keys and sequence, the epoch and the salt (CG-8), and
   checks the signature under the issuer's key (CG-9).
3. After FP-2 to FP-6 it refuses a ticket that does not verify
   (`ErrClaimInvalid`), one for another slot (`ErrClaimWrongSlot`) and one
   whose epoch is not its head's timestamp divided by 384 (`ErrClaimEpoch`),
   then what CG-4 and CG-6 remember from earlier in the epoch, and only
   then asks the client. A junk ticket costs the node one signature check
   and no simulation.

A transaction that carries no ticket is admitted as without the flag. Run
node A above with the flag added:

```sh
NODE_BACKEND=js ./skandha node --configFile hegota.json --dataDir /tmp/a \
  --api.port 14337 --api.wsPort 14437 \
  --p2p.port 14000 --p2p.host 127.0.0.1 --p2p.enrHost 127.0.0.1 --p2p.enrPort 14000 \
  --frames.enable --frames.claims --frames.name A --frames.log /tmp/a.frames.jsonl
```

Its `start` line says `"claims":true`. Each `rpc` and `gossip` line of a
transaction that carries a ticket has `claim`, its epoch, salt and verdict,
and has no `client` when the client was not asked. A ticket paymaster is not
the canonical paymaster, so FP-11 holds it to one pending transaction, as
the testnet's client does: a second spend through the same paymaster waits
for the first to be included. A recorded run is in
[`docs/frames/runs/2026-10-20-tickets/`](docs/frames/runs/2026-10-20-tickets/README.md).

### A ticket bound to its transaction

A ticket names one slot, and nothing the transaction does or pays. A copy of
a transaction whose sender signs nothing, with a higher priority fee or
other calldata, carries the same ticket. exp-mempool-l2s
`docs/spec/10-claim-gated-admission.md` version 6 binds the ticket to its
transaction, and version 7 names the bound template.

- **The message.** It also names a binder: the address of a one-time key
  the buyer chose.
- **Where it rides.** A bound ticket paymaster's frame carries it as 188
  bytes: epoch, salt, binder, signature.
- **The binding.** The claim counts only if the transaction carries a
  `secp256k1` signature with an empty `msg` whose resolved signer is the
  binder, valid over EIP-8141's signature hash (CG-12).

Two flags turn it on, beside `--frames.claims`:

- `--frames.binding` refuses an unbound claim with `ErrClaimUnbound`
  before the client is asked. The node computes the signature hash from the
  bytes it received and recovers the signer itself.
- `--frames.boundTemplate <length>:<keccak256>` names the bound ticket
  paymaster's template. Version 7 names exp-frames experiment 48's,
  `1185:0x52c656815e560bb189c3fb362c9628432ca1ed6b720e239857775236c18bc1d3`,
  which the `claim-gated` profile carries. On the Hegota testnet the bound
  paymaster `0xca7aa9eb83846186c1562abab968d1568ad55228` has it, and the
  version 5 paymasters do not. With `--frames.binding` and no template,
  every ticket is unbound.

Under `binding`, a replacement under the same bound ticket is its holder's
re-pricing, and version 8 of the clause no longer counts it as a removal
(CG-6): the holder may re-price at each 10 percent bump, while the client's
simulation accepts its `max_cost`, which a bound paymaster caps at its
denomination. A transaction with a proof dependency still re-prices only
under a new ticket (CG-5).

The `start` line logs `binding` and the template. Each transaction's `claim`
logs its `binder` and `bound`.

## A ruleset from a file

`--frames.descriptor <file>` runs the frame pool under the ruleset a
descriptor file names (exp-mempool-l2s `docs/spec/13-descriptors.md`), in
place of the profile's; `--frames.profile` still picks the chain the surface
speaks for. The node loads the file's parents from the descriptor files
beside it, each found by its identifier. Copies of exp-mempool-l2s's three
descriptors are in `packages/framepool/test/descriptors/`:

| File | Identifier | Runs on the node |
| --- | --- | --- |
| `eip-8141.json` | `bafkreic7kyifykopewlbznmhicjvfrmbxhmfwaaxglrdcgrttm2qw5blb4` | yes |
| `claim-gated.json` | `bafkreifhtepzdwqnimltyd573ba7wsmln556axhbbxhqez6be547llopxe` | no: refused at start |
| `erc-8421.json` | `bafkreieanbgdpq22vtfsa4rz4zll2lhf4qofoi75hbubqqhlqzepvyvjsy` | no: refused at start |

The `start` line says `descriptor`, the loaded identifier, and `ruleset`,
the profile it compiled to. Every refused `rpc` and `gossip` line has
`rule`, the module that refused it, and `descriptor`, and so does the
JSON-RPC error's `data`: `{"rule": "FP-6", "descriptor": "bafkrei..."}`.

ERC-8421's standard ruleset (`14-erc-8421.md`) traces each validation
frame for its opcodes, its calls and the address each storage slot is
associated with, which an execution client's verdict does not give, and
`11-surface.md` specifies the surface for the canonical mempool only. So the
node refuses that descriptor with the reason, and `@skandha/framepool`'s
vectors play it instead, against `StandardPool`.

`claim-gated.json` carries, since `10-claim-gated-admission.md` version 5,
the bond on the ticket paymaster (CG-11), which reads each paymaster's stake
from ERC-8421's staking registry. The surface reads no registry, so the node
refuses that descriptor too, and `--frames.claims` runs claim-gated
admission without the bond.

## What it does not do

- Blob-carrying frame transactions and EIP-8288's dependency frames are not
  decoded beyond their bytes. EIP-8272's recent-root verifier frame is: the
  `hegota-testnet` profile models it, its tuples give the slots the pool
  evicts by, and the client's verdict stands for their check against the
  contract. A node's slot is the header's `slotNumber`, not its block
  number.
- A node neither takes EIP-8288 wrappers nor folds them. The aggregator is in
  `@skandha/framepool`, and its two-node exchange runs in one process
  ([`packages/framepool/README.md`](packages/framepool/README.md), "Two
  aggregators"): `AGGREGATED_VK` and `DEPS_HASH` are still to be chosen in
  the EIP, so no recursive STARK can be made or checked to it.
- The client is asked about every pending transaction at every head, because
  its simulation does not return the sender slots a prefix read. That is one
  simulation per pending transaction per head.
- A canonical paymaster is not recognised by its code at the surface, so a
  paymaster is held to FP-11's cap of one pending transaction.
- The includer lists frame transactions only: the account-nonce half of a
  list belongs to an execution client's pool. It does not gossip its list or
  sign it; it answers with what it would publish.
- gossipsub expects a topic validator to answer within about 100 ms; asking
  the client takes longer, which costs a peer score, not a delivery, between
  two nodes.
