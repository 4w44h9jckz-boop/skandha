import { ICliCommandOptions } from "../../util/index.js";

/** Frame transactions on this node (exp-mempool-l2s `docs/spec/11-surface.md`). */
export interface IFramesArgs {
  "frames.enable": boolean;
  "frames.profile": string;
  "frames.rpc"?: string;
  "frames.handoff": boolean;
  "frames.claims": boolean;
  "frames.binding": boolean;
  "frames.boundTemplate"?: string;
  "frames.log"?: string;
  "frames.name"?: string;
  "frames.descriptor"?: string;
}

export const options: ICliCommandOptions<IFramesArgs> = {
  "frames.enable": {
    type: "boolean",
    description:
      "Take EIP-8141 frame transactions over eth_sendRawTransaction and gossip, admitted by @skandha/framepool",
    default: false,
    group: "frames",
  },
  "frames.profile": {
    type: "string",
    description:
      "The frame pool and surface profile: hegota-testnet or eip-8141",
    default: "hegota-testnet",
    group: "frames",
  },
  "frames.rpc": {
    type: "string",
    description:
      "The execution client asked for verdicts and state (SF-4, SF-8); defaults to the config's rpcEndpoint",
    group: "frames",
  },
  "frames.handoff": {
    type: "boolean",
    description:
      "Hand every admitted frame transaction to the client's eth_sendRawTransaction (SF-9)",
    default: false,
    group: "frames",
  },
  "frames.claims": {
    type: "boolean",
    description:
      "Claim-gated admission (CG-1): read the ticket a transaction carries to a ticket paymaster, recognised by its code with eth_getCode, and check it before the client is asked",
    default: false,
    group: "frames",
  },
  "frames.binding": {
    type: "boolean",
    description:
      "With frames.claims, a ticket's claim counts only if the one-time key its message names signed the transaction's signature hash (CG-12)",
    default: false,
    group: "frames",
  },
  "frames.boundTemplate": {
    type: "string",
    description:
      "The bound ticket paymaster's template, as its length and keccak256, length:0x..., which CG-10 recognises a bound ticket paymaster by",
    group: "frames",
  },
  "frames.log": {
    type: "string",
    description:
      "A file for one JSON line per admission, relay, head and hand-off",
    group: "frames",
  },
  "frames.name": {
    type: "string",
    description: "How this node names itself in that log",
    group: "frames",
  },
  "frames.descriptor": {
    type: "string",
    description:
      "A descriptor file (exp-mempool-l2s docs/spec/13-descriptors.md) whose ruleset the frame pool runs in place of the profile's, loaded with the parents beside it; refusals name the descriptor and the rule",
    group: "frames",
  },
};
