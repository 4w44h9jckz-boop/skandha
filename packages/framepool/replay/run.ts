/**
 * Replays every fixture of a snapshot under its chain's profile (emem
 * `docs/spec/12-replay.md`, RP-6) and prints the results as markdown. The
 * output depends only on the snapshot and this package, so a committed
 * results.md can be checked by running this again.
 *
 * Usage: bun replay/run.ts replay/fixtures-exp-frames-85ee60d.json
 */
/* eslint-disable no-console */
import { readFileSync } from "node:fs";
import {
  FramePoolConfig,
  PROFILES,
  ParentHeader,
  ReplayResult,
  SURFACE_PROFILES,
  SurfaceConfig,
  addressForm,
  replay,
} from "../src/index.js";

interface Fixture {
  hash: string;
  chain_id: string;
  envelope: "keyed" | "plain";
  block: number;
  payer: string;
  client: string;
  raw: string | null;
  parent: {
    number: number;
    timestamp: number;
    gas_limit: string;
    gas_used: string;
    base_fee: string;
  } | null;
}

const path = process.argv[2];
const snapshot = JSON.parse(readFileSync(path, "utf8")) as {
  source: string;
  headers: string;
  fixtures: Fixture[];
};

function profile(
  name: string,
  surface: Partial<SurfaceConfig>
): [FramePoolConfig, SurfaceConfig] {
  return [
    addressForm(PROFILES.get(name) as FramePoolConfig),
    { ...(SURFACE_PROFILES.get(name) as SurfaceConfig), ...surface },
  ];
}

/** RP-6: the profiles a fixture is judged under, by chain, the first being the one the falsifier is about. */
function profilesFor(f: Fixture): [string, FramePoolConfig, SurfaceConfig][] {
  const chainId = BigInt(f.chain_id);
  if (chainId === 8141n)
    return [
      ["hegota-testnet", ...profile("hegota-testnet", {})],
      ["eip-8141", ...profile("eip-8141", { chainId })],
    ];
  return [
    [
      "eip-8141 (plain)",
      ...profile("eip-8141", { chainId, envelope: f.envelope }),
    ],
  ];
}

const parentOf = (f: Fixture): ParentHeader | null =>
  f.parent === null
    ? null
    : {
        number: f.parent.number,
        timestamp: f.parent.timestamp,
        gasLimit: BigInt(f.parent.gas_limit),
        gasUsed: BigInt(f.parent.gas_used),
        baseFee: BigInt(f.parent.base_fee),
      };

const cell = (r: ReplayResult): string =>
  r.comparison === "not replayed"
    ? "not replayed"
    : `${r.verdict}, ${r.comparison}${
        r.differences && r.differences.length > 0
          ? ` (${r.differences.join(", ")})`
          : ""
      }`;

const rows: string[] = [];
const tally = new Map<string, Map<string, number>>();
const count = (profileName: string, key: string): void => {
  const t = tally.get(profileName) ?? new Map<string, number>();
  t.set(key, (t.get(key) ?? 0) + 1);
  tally.set(profileName, t);
};
for (const f of snapshot.fixtures) {
  const cells: string[] = [];
  for (const [name, cfg, scfg] of profilesFor(f)) {
    const r =
      f.raw === null
        ? ({ comparison: "not replayed" } as ReplayResult)
        : replay(
            Buffer.from(f.raw.slice(2), "hex"),
            f.hash,
            f.payer,
            parentOf(f),
            cfg,
            scfg
          );
    count(
      name,
      r.comparison === "explained"
        ? `explained (${(r.differences ?? []).join(", ")})`
        : r.comparison
    );
    if (r.header === "missing") count(name, "header missing");
    cells.push(`${name}: ${cell(r)}`);
  }
  rows.push(
    `| \`${f.hash.slice(0, 18)}\` | ${f.chain_id} | ${f.block} | ${cells.join(
      "<br>"
    )} |`
  );
}

console.log(`# Replay of mined frame transactions

Every fixture of \`${path
  .split("/")
  .pop()}\` judged as emem's \`docs/spec/12-replay.md\`
says, by \`bun replay/run.ts ${path
  .split("/")
  .slice(-2)
  .join("/")}\`. Its input is
${snapshot.source}, with parent headers from ${snapshot.headers}. Generated: do
not edit; run the command again and compare.

## Totals
`);
for (const [name, t] of tally) {
  console.log(
    `- **${name}**: ${[...t]
      .sort()
      .map(([k, v]) => `${v} ${k}`)
      .join("; ")}`
  );
}
console.log(`
## Fixtures

| Hash | Chain | Block | Verdict, comparison (differences) |
| --- | --- | --- | --- |
${rows.join("\n")}`);
