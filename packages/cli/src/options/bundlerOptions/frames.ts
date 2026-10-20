import { ICliCommandOptions } from "../../util/index.js";

/** Frame transactions on this node (emem `docs/spec/11-surface.md`). */
export interface IFramesArgs {
  "frames.enable": boolean;
  "frames.profile": string;
  "frames.rpc"?: string;
  "frames.handoff": boolean;
  "frames.log"?: string;
  "frames.name"?: string;
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
};
