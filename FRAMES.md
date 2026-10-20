# Frame transactions on skandha

With `--frames.enable`, a skandha node takes EIP-8141 frame transactions over
`eth_sendRawTransaction` and over a gossipsub topic of its own, and admits
them with `@skandha/framepool` under emem's `docs/spec/11-surface.md`. The
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
emem's `docs/spec/11-surface.md`, "Run procedure", is what a run passes on,
and A and B answering differently at the same head is the result that would
show the claim wrong.

A recorded run is in
[`docs/frames/runs/2026-10-20-two-nodes/`](docs/frames/runs/2026-10-20-two-nodes/README.md).

## What it does not do

- Blob-carrying frame transactions and EIP-8288's dependency frames are not
  decoded beyond their bytes. EIP-8272's recent-root verifier frame is: the
  `hegota-testnet` profile models it, its tuples give the slots the pool
  evicts by, and the client's verdict stands for their check against the
  contract. A node's slot is the header's `slotNumber`, not its block
  number.
- The client is asked about every pending transaction at every head, because
  its simulation does not return the sender slots a prefix read. That is one
  simulation per pending transaction per head.
- A canonical paymaster is not recognised by its code at the surface, so a
  paymaster is held to FP-11's cap of one pending transaction.
- gossipsub expects a topic validator to answer within about 100 ms; asking
  the client takes longer, which costs a peer score, not a delivery, between
  two nodes.
