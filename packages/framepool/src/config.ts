/**
 * FP-1: the `eip-8141` and `hegota-testnet` profiles; MA-1: the `matcha`
 * proposal; AG-1: `eip-8288`; RR-1: `eip-8272`; EN-1: `eip-8266`.
 */

function hexAddress(i: number): string {
  return "0x" + i.toString(16).padStart(40, "0");
}

export const PRECOMPILES: ReadonlySet<string> = new Set([
  ...Array.from({ length: 0x11 }, (_, i) => hexAddress(i + 1)),
  hexAddress(0x100),
]);

export const EXPIRY_VERIFIER_MASTER =
  "0x81413f0cF12e9b6a49B1D0439E081c577D57FfFf";
export const EXPIRY_VERIFIER_TESTNET =
  "0x0000000000000000000000000000000000008141";
export const RECENT_ROOT_ADDRESS = "0x0000000000000000000000000000000000008272";
export const EXPIRING_KEY = 2n ** 256n - 1n;

export interface FramePoolConfig {
  readonly name: string;
  readonly maxVerifyGas: bigint;
  readonly maxVerifyStateGas: bigint | null;
  readonly maxPendingNoncanonical: number;
  readonly capCodelessPayers: boolean;
  readonly perSender: "one" | "disjoint-keys" | "matcha";
  readonly expiryVerifier: string;
  readonly priceBump: number;
  readonly priceLimit: bigint;
  readonly maxPending: number;
  readonly canonicalPaymasterCode: string;
  readonly expiryVerifierCode: string;
  readonly precompiles: ReadonlySet<string>;
  readonly reuseBalance: boolean; // FP-15 step 3, or MA-9 under "matcha"
  readonly evictFirst: "expiry" | "tip"; // FP-14
  readonly expiryMargin: number; // FP-8, FP-15 step 2: seconds added to the head's timestamp
  readonly staticFirst: boolean; // Admission: FP-11 and FP-12 before FP-8
  // MA-1, read only when perSender is "matcha"
  readonly widthCap: bigint;
  readonly safetyFactor: number; // read as the decimal it is written as (MA-2)
  readonly lifetime: number;
  readonly loadPrice: bigint; // MA-13; 0 turns it off
  readonly contention: "sender" | "storage" | "slot"; // MA-14
  // AG-1, read only when dependencyFrames is true
  readonly dependencyFrames: boolean;
  readonly depFrameMode: number; // DEP_VERIFY_FRAME_MODE: 3 at the pinned commit, 4 on master
  readonly leanstark: "defined" | "reserved"; // AG-2
  readonly depInBatch: boolean; // whether a dependency frame may follow a frame with ATOMIC_BATCH_FLAG (AG-2)
  readonly zeroDataHash: "literal" | "sig_hash"; // AG-4: whether a zero data_hash stands for the signature hash
  readonly mode1Union: boolean; // whether AG-5 checks a mode 1 wrapper's deps against its transactions
  readonly maxDependenciesPerFrame: number;
  readonly maxSigsPerTx: number;
  readonly maxStarksPerTx: number;
  readonly maxSigDepsPerWrapper: number;
  readonly maxStarkDepsPerWrapper: number;
  readonly aggregationInterval: number;
  readonly capAggregates: boolean;
  readonly forwardWrappers: boolean;
  // AG-9: ms; null bounds nothing. Read by the aggregator (`Aggregator`).
  readonly provingBudget: number | null;
  readonly proveBase: number;
  readonly proveRecursive: number;
  readonly proveSig: number;
  readonly proveStark: number;
  // AG-10: MiB; null bounds nothing
  readonly memoryBudget: number | null;
  readonly memoryBase: number;
  readonly memoryRecursive: number;
  readonly memorySig: number;
  readonly memoryStark: number;
  // RR-1, read only when recentRoots is true
  readonly recentRoots: boolean;
  readonly recentRootAddress: string;
  readonly recentRootCode: string;
  readonly recentRootLength: number;
  readonly maxRecentRootReferences: number;
  readonly rootMargin: number; // RR-5
  // EN-1, read only when expiring is true
  readonly expiring: boolean;
  readonly expiringKey: bigint;
  readonly nonceRing: string; // EN-2: the account whose storage holds seen(h)
  readonly maxExpirySecs: number;
  readonly expiringNonceGas: bigint;
  readonly expiringPerSender: "many" | "one"; // EN-6
  // CG-1, read only when claims is true
  readonly claims: boolean;
  readonly claimEpoch: number; // seconds; a head's epoch is its timestamp divided by this
  readonly claimMemory: "slot" | "claim" | "none"; // CG-4
  readonly signedProofs: boolean; // CG-3: whether a sender's signature covers its wrapper's proofs
  readonly verifies: boolean; // CG-7: false makes the node a relay, which verifies no proof
  readonly bond: boolean; // CG-11: a bond on the ticket paymaster, with AM-1's stake and reputation parameters below
  // 14-erc-8421.md, AM-1, read when ruleset is "erc-8421", and the stake and reputation ones under `bond` (CG-11);
  // a descriptor sets them (13-descriptors.md, DS-6)
  readonly ruleset: "eip-8141" | "erc-8421";
  readonly maxVerifyGasPerEntity: bigint;
  readonly maxVerifyGasStakedEntity: bigint;
  readonly minStakeValue: bigint;
  readonly minUnstakeDelay: bigint;
  readonly minInclusionRateDenominator: number;
  readonly throttlingSlack: number;
  readonly banSlack: number;
  readonly refreshSeconds: number;
  readonly throttledEntityMempoolCount: number;
  readonly throttledEntityLiveBlocks: number; // not modelled
  readonly throttledEntityBlockCount: number; // not modelled
  readonly sameUnstakedEntityMempoolCount: number;
  readonly maxTxsAllowedUnstakedEntity: number;
  readonly sameNonceKeyMempoolCount: number;
  readonly sameSenderMempoolCount: number;
}

export const EIP_8141: FramePoolConfig = Object.freeze({
  name: "eip-8141",
  maxVerifyGas: 100_000n,
  maxVerifyStateGas: 500_000n,
  maxPendingNoncanonical: 1,
  capCodelessPayers: false,
  perSender: "one",
  expiryVerifier: EXPIRY_VERIFIER_MASTER,
  priceBump: 10,
  priceLimit: 1n,
  maxPending: 4096,
  canonicalPaymasterCode: "canonical-paymaster",
  expiryVerifierCode: "expiry-verifier",
  precompiles: PRECOMPILES,
  reuseBalance: false,
  evictFirst: "expiry",
  expiryMargin: 0,
  staticFirst: false,
  widthCap: 2n ** 24n,
  safetyFactor: 2,
  lifetime: 10800,
  loadPrice: 0n,
  contention: "sender",
  dependencyFrames: false,
  depFrameMode: 3,
  leanstark: "defined",
  depInBatch: true,
  zeroDataHash: "literal",
  mode1Union: false,
  maxDependenciesPerFrame: 256,
  maxSigsPerTx: 16,
  maxStarksPerTx: 1,
  maxSigDepsPerWrapper: 16,
  maxStarkDepsPerWrapper: 1,
  aggregationInterval: 1.0,
  capAggregates: true,
  forwardWrappers: false,
  provingBudget: null,
  proveBase: 0,
  proveRecursive: 0,
  proveSig: 0,
  proveStark: 0,
  memoryBudget: null,
  memoryBase: 0,
  memoryRecursive: 0,
  memorySig: 0,
  memoryStark: 0,
  recentRoots: false,
  recentRootAddress: RECENT_ROOT_ADDRESS,
  recentRootCode: "recent-root",
  recentRootLength: 8192,
  maxRecentRootReferences: 16,
  rootMargin: 0,
  expiring: false,
  expiringKey: EXPIRING_KEY,
  nonceRing: "nonce-ring",
  maxExpirySecs: 60,
  expiringNonceGas: 13_000n,
  expiringPerSender: "many",
  claims: false,
  claimEpoch: 384,
  claimMemory: "slot",
  signedProofs: false,
  verifies: true,
  bond: false,
  ruleset: "eip-8141",
  maxVerifyGasPerEntity: 100_000n,
  maxVerifyGasStakedEntity: 1_000_000n,
  minStakeValue: 10n ** 18n,
  minUnstakeDelay: 86400n,
  minInclusionRateDenominator: 10,
  throttlingSlack: 10,
  banSlack: 50,
  refreshSeconds: 3600,
  throttledEntityMempoolCount: 4,
  throttledEntityLiveBlocks: 10,
  throttledEntityBlockCount: 4,
  sameUnstakedEntityMempoolCount: 10,
  maxTxsAllowedUnstakedEntity: 10000,
  sameNonceKeyMempoolCount: 4,
  sameSenderMempoolCount: 64,
});

export function withChanges(
  config: FramePoolConfig,
  changes: Partial<FramePoolConfig>
): FramePoolConfig {
  return Object.freeze({ ...config, ...changes });
}

export const HEGOTA_TESTNET = withChanges(EIP_8141, {
  name: "hegota-testnet",
  maxVerifyGas: 500_000n,
  maxVerifyStateGas: null,
  capCodelessPayers: true,
  perSender: "disjoint-keys",
  expiryVerifier: EXPIRY_VERIFIER_TESTNET,
  recentRoots: true, // RR-1's hegota-testnet column: the testnet runs EIP-8272, at eip-8272's constants
});

export const MATCHA = withChanges(EIP_8141, {
  name: "matcha",
  perSender: "matcha",
  reuseBalance: true,
});

export const EIP_8288 = withChanges(EIP_8141, {
  name: "eip-8288",
  dependencyFrames: true,
});

/** AG-1: EIP-8288 at master `899bef0a`, with leanSTARK reserved (exp-mempool-l2s decision record 0063). */
export const EIP_8288_MASTER = withChanges(EIP_8288, {
  name: "eip-8288-master",
  depFrameMode: 4,
  leanstark: "reserved",
  depInBatch: false,
  zeroDataHash: "sig_hash",
  mode1Union: true,
});

export const EIP_8272 = withChanges(EIP_8141, {
  name: "eip-8272",
  recentRoots: true,
});

export const EIP_8266 = withChanges(EIP_8141, {
  name: "eip-8266",
  expiring: true,
});

export const CLAIM_GATED = withChanges(EIP_8288, {
  name: "claim-gated",
  claims: true,
  bond: true,
});

export const PROFILES: ReadonlyMap<string, FramePoolConfig> = new Map(
  [
    EIP_8141,
    HEGOTA_TESTNET,
    MATCHA,
    EIP_8288,
    EIP_8288_MASTER,
    EIP_8272,
    EIP_8266,
    CLAIM_GATED,
  ].map((c) => [c.name, c])
);
