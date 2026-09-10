/**
 * TrueCarbon demo entrypoint.
 * ---------------------------
 * Thin wrapper around the real CLI in `services/oracle.ts` (scenario1).
 * `package.json` runs `tsx services/demo.ts`; this file exists so
 * `npm run demo` does not fail with file-not-found.
 *
 * - `npm run demo -- --help` prints usage and exits 0 (no network).
 * - `npm run demo` with missing env fails gracefully with a clear
 *   message (exit 1, no stack trace, no network).
 * - With env present, it points at the real scenario; it never
 *   initiates network calls itself.
 */
import { MockOracle } from "./oracle.ts";

export { MockOracle };
export type { IOutcomeOracle } from "./oracle.ts";

const USAGE = `TrueCarbon demo (mock oracle — scenario1)

Usage:
  npm run demo -- --help            Show this help (no network calls)
  npm run demo                      Validate env, then explain how to run scenario1

Real scenario lives in services/oracle.ts (scenario1):
  planting-confirmed tranche 1 release, survival-check-failed tranche 2 refund.

Required env (see .env.example):
  VAULT_ADDRESS   Deployed VerifiedSettlement address
  BUYER_KEY       Buyer private key (funded on Arc testnet)
  ORACLE_KEY      Oracle signer private key (registered onchain per-claim)

Optional env (have defaults in services/oracle.ts):
  ARC_TESTNET_RPC (default https://rpc.testnet.arc.network)
  EXPLORER_BASE   (default https://testnet.arcscan.app)
  USDC_ADDRESS    (default 0x3600000000000000000000000000000000000000)

To run the live scenario against Arc testnet:
  tsx services/oracle.ts
`;

function isDirectRun(): boolean {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }

  const missing = ["VAULT_ADDRESS", "BUYER_KEY", "ORACLE_KEY"].filter(
    (k) => !process.env[k]
  );
  if (missing.length > 0) {
    console.error(`demo: missing required env: ${missing.join(", ")}`);
    console.error(`demo: copy .env.example to .env and fill in the values above.`);
    console.error(`demo: run \`npm run demo -- --help\` for usage.`);
    process.exitCode = 1;
    return;
  }

  console.log("demo: env looks complete.");
  console.log("demo: live scenario lives in services/oracle.ts (scenario1) — run `tsx services/oracle.ts`.");
}

if (isDirectRun()) {
  main();
}
