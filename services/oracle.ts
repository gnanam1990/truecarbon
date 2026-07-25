/**
 * TrueCarbon — mock oracle service
 * ---------------------------------
 * Per PRD §4, v1 uses a manually-triggerable oracle in place of a real
 * satellite/sensor integration. The `IOutcomeOracle` interface below is the
 * integration boundary — replacing `MockOracle` with a real verifier means
 * implementing the same interface and pointing the onchain oracle address
 * at it.
 *
 * Honesty: this file is honest about what it is. There is no fabricated
 * "satellite integration" here; this is a placeholder that lets the demo
 * exercise the full settlement path.
 */
import { Contract, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes, formatUnits, parseUnits } from "ethers";

export interface IOutcomeOracle {
  /** Address of the onchain oracle authorized to post attestations for this claim. */
  readonly address: string;
  /** Sign attestations for a given claimId + trancheIndex + outcome. */
  attest(claimId: string, trancheIndex: number, outcome: boolean): Promise<{ txHash: string }>;
}

// ------------------------------------------------------------------
// Mock oracle — manually triggerable. The interface here is the same shape
// a real satellite/sensor integration would expose.
// ------------------------------------------------------------------

export class MockOracle implements IOutcomeOracle {
  constructor(
    private vaultAddress: string,
    private rpcUrl: string,
    private signerPk: string
  ) {}

  get address() {
    return new Wallet(this.signerPk).address;
  }

  async attest(claimId: string, trancheIndex: number, outcome: boolean) {
    const provider = new JsonRpcProvider(this.rpcUrl);
    const signer = new Wallet(this.signerPk, provider);
    const vault = new Contract(
      this.vaultAddress,
      [
        "function postAttestation(bytes32,uint256,bool)",
        "function getTranche(bytes32,uint256) view returns (tuple(uint96,uint64,address,uint8,bool,bool))",
      ],
      signer
    );
    const tx = await vault.postAttestation(claimId, trancheIndex, outcome);
    const r = await tx.wait();
    return { txHash: r.hash };
  }
}

// ------------------------------------------------------------------
// Production-integration documentation (per services/README.md).
//
// To replace MockOracle with a real verification partner:
//   1. Implement IOutcomeOracle for the partner's API:
//        - Data source: their satellite/sensor/auditor pipeline
//        - Attestation format: call vault.postAttestation(claimId, trancheIndex, outcome)
//        - Key management: their signing key registered onchain as the oracle
//   2. Update the deploy script to point each claim at the new oracle address.
//   3. Keep the onchain `oracle` field per-claim so the verification
//      authority remains explicit, not implicit.
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Demo CLI
// ------------------------------------------------------------------

const ARC_RPC = process.env.ARC_TESTNET_RPC ?? "https://rpc.testnet.arc.network";
const EXPLORER = process.env.EXPLORER_BASE ?? "https://testnet.arcscan.app";
const VAULT = process.env.VAULT_ADDRESS ?? "";
const USDC = process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";
const BUYER_PK = process.env.BUYER_KEY ?? "";
const ORACLE_PK = process.env.ORACLE_KEY ?? "";

const ERC20_ABI = ["function approve(address,uint256) returns (bool)"];
const VAULT_ABI = [
  "function lockMilestoneClaim(bytes32,address,uint96[],uint64[])",
  "function setPayee(bytes32,address)",
  "function postAttestation(bytes32,uint256,bool)",
  "function refundExpired(bytes32,uint256)",
];

function link(kind: "tx" | "address", id: string) {
  return `${EXPLORER}/${kind}/${id}`;
}

async function scenario1() {
  console.log("\n=== Scenario 1: planting-confirmed tranche 1 release, survival-check-failed tranche 2 refund ===\n");
  const provider = new JsonRpcProvider(ARC_RPC);
  const buyer = new Wallet(BUYER_PK, provider);
  const oracle = new Wallet(ORACLE_PK, provider);

  const vault = new Contract(VAULT, VAULT_ABI, buyer);
  const usdc = new Contract(USDC, ERC20_ABI, buyer);

  const claimId = keccak256(toUtf8Bytes("reforestation-plot-7"));
  const trancheAmts = [parseUnits("100", 6), parseUnits("100", 6)]; // 100 + 100 USDC
  const expiries = [
    BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60),
    BigInt(Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60),
  ];

  // Lock
  let tx = await usdc.approve(VAULT, trancheAmts[0] * 2n);
  await tx.wait();
  tx = await vault.lockMilestoneClaim(claimId, await oracle.getAddress(), trancheAmts, expiries);
  const r0 = await tx.wait();
  console.log(`  lockMilestoneClaim  ${link("tx", tx.hash)}  block ${r0!.blockNumber}`);

  // Tranche 0 (planting) — oracle confirms true
  const vO = new Contract(VAULT, VAULT_ABI, oracle);
  tx = await vO.postAttestation(claimId, 0, true);
  await tx.wait();
  console.log(`  attest[0] = true     ${link("tx", tx.hash)}  (planting confirmed)`);

  // Tranche 1 (6-month survival) — oracle returns false (survival check failed)
  tx = await vO.postAttestation(claimId, 1, false);
  const r1 = await tx.wait();
  console.log(`  attest[1] = false    ${link("tx", tx.hash)}  block ${r1!.blockNumber}  (survival check failed → refund)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  scenario1().catch((e) => { console.error(e); process.exit(1); });
}
