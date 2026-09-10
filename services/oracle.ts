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
  /** Permissionless expiry refund for a tranche past its expiry. */
  refundExpired(claimId: string, trancheIndex: number): Promise<{ txHash: string }>;
}

// ------------------------------------------------------------------
// Env validation — fail fast before any network calls.
// ------------------------------------------------------------------

export interface OracleEnv {
  vault: string;
  buyerPk: string;
  oraclePk: string;
  rpcUrl: string;
  usdc: string;
  explorer: string;
}

export function requireOracleEnv(env: NodeJS.ProcessEnv = process.env): OracleEnv {
  const vault = env.VAULT_ADDRESS ?? "";
  const buyerPk = env.BUYER_KEY ?? "";
  const oraclePk = env.ORACLE_KEY ?? "";
  const missing: string[] = [];
  if (!vault) missing.push("VAULT_ADDRESS");
  if (!buyerPk) missing.push("BUYER_KEY");
  if (!oraclePk) missing.push("ORACLE_KEY");
  if (missing.length > 0) {
    throw new Error(`oracle: missing required env: ${missing.join(", ")}`);
  }
  return {
    vault,
    buyerPk,
    oraclePk,
    rpcUrl: env.ARC_TESTNET_RPC ?? "https://rpc.testnet.arc.network",
    usdc: env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000",
    explorer: env.EXPLORER_BASE ?? "https://testnet.arcscan.app",
  };
}

// ------------------------------------------------------------------
// Survival-doc → bool outcome mapping.
// v1 policy: 6-month survival >= 80% confirms the tranche (true),
// below 80% fails it (false → refund). Pure function, unit-tested.
// ------------------------------------------------------------------

export const SURVIVAL_THRESHOLD_PCT = 80;

export interface SurvivalDoc {
  /** Survival percentage on a 0–100 scale. */
  survivalPct?: number;
  /** Survival rate: 0–1 fraction OR 0–100 percent (auto-detected). */
  survivalRate?: number;
}

export function survivalToOutcome(survivalPct: number): boolean {
  if (!Number.isFinite(survivalPct)) throw new Error("survivalToOutcome: survivalPct must be a finite number");
  return survivalPct >= SURVIVAL_THRESHOLD_PCT;
}

export function mapSurvivalDocToOutcome(doc: SurvivalDoc): boolean {
  let pct: number | undefined = doc.survivalPct;
  if (pct === undefined && doc.survivalRate !== undefined) {
    const r = doc.survivalRate;
    if (!Number.isFinite(r)) throw new Error("mapSurvivalDocToOutcome: survivalRate must be finite");
    pct = r <= 1 ? r * 100 : r;
  }
  if (pct === undefined || !Number.isFinite(pct)) {
    throw new Error("mapSurvivalDocToOutcome: doc must contain survivalPct or survivalRate");
  }
  return survivalToOutcome(pct);
}

// ------------------------------------------------------------------
// Read helpers — getClaim/getTranche status display.
// TrancheState onchain: 0 = Locked, 1 = Released, 2 = Refunded.
// ------------------------------------------------------------------

export interface TrancheView {
  amount: bigint;
  expiry: bigint;
  oracle: string;
  state: number;
  attested: boolean;
  outcome: boolean;
}

export interface ClaimView {
  buyer: string;
  payee: string;
  oracle: string;
  isMilestone: boolean;
  tranches: TrancheView[];
}

export function describeTrancheState(state: number | string | bigint): string {
  const n = Number(state);
  if (n === 0) return "Locked";
  if (n === 1) return "Released";
  if (n === 2) return "Refunded";
  return "Unknown";
}

export function formatTranche(t: TrancheView, idx?: number): string {
  const prefix = idx === undefined ? "tranche" : `tranche[${idx}]`;
  const amount = formatUnits(t.amount, 6);
  const expiry = new Date(Number(t.expiry) * 1000).toISOString();
  return (
    `${prefix} state=${describeTrancheState(t.state)} ` +
    `amount=${amount} USDC expiry=${expiry} ` +
    `attested=${t.attested} outcome=${t.outcome} oracle=${t.oracle}`
  );
}

export function formatClaim(c: ClaimView, claimId: string): string {
  const lines = [
    `claim ${claimId} buyer=${c.buyer} payee=${c.payee} oracle=${c.oracle} milestone=${c.isMilestone}`,
  ];
  c.tranches.forEach((t, i) => lines.push(`  ${formatTranche(t, i)}`));
  return lines.join("\n");
}

function normalizeTranche(raw: { amount: bigint; expiry: bigint; oracle: string; state: number | bigint; attested: boolean; outcome: boolean }): TrancheView {
  return {
    amount: BigInt(raw.amount),
    expiry: BigInt(raw.expiry),
    oracle: raw.oracle,
    state: Number(raw.state),
    attested: raw.attested,
    outcome: raw.outcome,
  };
}

// ------------------------------------------------------------------
// Mock oracle — manually triggerable. The interface here is the same shape
// a real satellite/sensor integration would expose.
// ------------------------------------------------------------------

const TRANCHE_ABI = [
  "function postAttestation(bytes32,uint256,bool)",
  "function refundExpired(bytes32,uint256)",
  "function getClaim(bytes32) view returns (tuple(address buyer, address payee, address oracle, bool isMilestone, tuple(uint96 amount, uint64 expiry, address oracle, uint8 state, bool attested, bool outcome)[] tranches))",
  "function getTranche(bytes32,uint256) view returns (tuple(uint96 amount, uint64 expiry, address oracle, uint8 state, bool attested, bool outcome))",
];

export class MockOracle implements IOutcomeOracle {
  constructor(
    private vaultAddress: string,
    private rpcUrl: string,
    private signerPk: string
  ) {
    if (!vaultAddress) throw new Error("MockOracle: vaultAddress is required");
    if (!signerPk) throw new Error("MockOracle: signerPk is required");
  }

  get address() {
    return new Wallet(this.signerPk).address;
  }

  private contract(signerPk: string = this.signerPk) {
    const provider = new JsonRpcProvider(this.rpcUrl);
    const signer = new Wallet(signerPk, provider);
    return new Contract(this.vaultAddress, TRANCHE_ABI, signer);
  }

  async attest(claimId: string, trancheIndex: number, outcome: boolean) {
    const vault = this.contract();
    const tx = await vault.postAttestation(claimId, trancheIndex, outcome);
    const r = await tx.wait();
    return { txHash: r.hash };
  }

  async refundExpired(claimId: string, trancheIndex: number) {
    const vault = this.contract();
    const tx = await vault.refundExpired(claimId, trancheIndex);
    const r = await tx.wait();
    return { txHash: r.hash };
  }

  /** Map a survival doc (>=80% → true) to a bool outcome, then attest it. */
  async attestFromSurvivalDoc(claimId: string, trancheIndex: number, doc: SurvivalDoc) {
    const outcome = mapSurvivalDocToOutcome(doc);
    return { ...(await this.attest(claimId, trancheIndex, outcome)), outcome };
  }

  async getClaim(claimId: string): Promise<ClaimView> {
    const provider = new JsonRpcProvider(this.rpcUrl);
    const vault = new Contract(this.vaultAddress, TRANCHE_ABI, provider);
    const raw = await vault.getClaim(claimId);
    return {
      buyer: raw.buyer,
      payee: raw.payee,
      oracle: raw.oracle,
      isMilestone: raw.isMilestone,
      tranches: (raw.tranches as unknown[] as Parameters<typeof normalizeTranche>[0][]).map(normalizeTranche),
    };
  }

  async getTranche(claimId: string, trancheIndex: number): Promise<TrancheView> {
    const provider = new JsonRpcProvider(this.rpcUrl);
    const vault = new Contract(this.vaultAddress, TRANCHE_ABI, provider);
    const raw = await vault.getTranche(claimId, trancheIndex);
    return normalizeTranche(raw);
  }

  async describeTranche(claimId: string, trancheIndex: number): Promise<string> {
    return formatTranche(await this.getTranche(claimId, trancheIndex), trancheIndex);
  }

  async describeClaim(claimId: string): Promise<string> {
    return formatClaim(await this.getClaim(claimId), claimId);
  }
}

// ------------------------------------------------------------------
// In-memory settlement — mirrors VerifiedSettlement's state machine for
// mock-integration tests (no network). Ordering rule matches the contract:
// tranche N+1 requires tranche N resolved (Released or Refunded), for both
// postAttestation and refundExpired.
// ------------------------------------------------------------------

export type SettlementState = "Locked" | "Released" | "Refunded";

export interface InMemoryTranche {
  amount: bigint;
  expiry: number;
  state: SettlementState;
  attested: boolean;
  outcome: boolean;
}

export class InMemorySettlement {
  tranches: InMemoryTranche[] = [];
  released = 0n;
  refunded = 0n;

  constructor(amounts: bigint[], expiries: number[], public now = Math.floor(Date.now() / 1000)) {
    if (amounts.length === 0 || amounts.length !== expiries.length) throw new Error("InvalidMilestone");
    this.tranches = amounts.map((a, i) => ({ amount: a, expiry: expiries[i], state: "Locked" as SettlementState, attested: false, outcome: false }));
  }

  private requireResolved(idx: number) {
    if (idx > 0) {
      const prev = this.tranches[idx - 1].state;
      if (prev !== "Released" && prev !== "Refunded") throw new Error("WrongState: tranche N-1 not resolved");
    }
  }

  postAttestation(idx: number, outcome: boolean): SettlementState {
    const t = this.tranches[idx];
    if (!t) throw new Error("Exceeded");
    if (t.state !== "Locked") throw new Error("WrongState");
    if (this.now > t.expiry) throw new Error("ExpiryNotReached");
    this.requireResolved(idx);
    t.attested = true;
    t.outcome = outcome;
    t.state = outcome ? "Released" : "Refunded";
    if (outcome) this.released += t.amount;
    else this.refunded += t.amount;
    return t.state;
  }

  refundExpired(idx: number): SettlementState {
    const t = this.tranches[idx];
    if (!t) throw new Error("Exceeded");
    if (t.state !== "Locked") throw new Error("WrongState");
    if (this.now <= t.expiry) throw new Error("ExpiryNotReached");
    this.requireResolved(idx);
    t.state = "Refunded";
    this.refunded += t.amount;
    return t.state;
  }

  status(idx: number): string {
    const t = this.tranches[idx];
    if (!t) throw new Error("Exceeded");
    return `tranche[${idx}] state=${t.state} amount=${formatUnits(t.amount, 6)} USDC attested=${t.attested} outcome=${t.outcome}`;
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
  "function lockMilestoneClaim(bytes32,address,address,uint96[],uint64[])",
  "function setPayee(bytes32,address)",
  "function postAttestation(bytes32,uint256,bool)",
  "function refundExpired(bytes32,uint256)",
  "function getClaim(bytes32) view returns (tuple(address buyer, address payee, address oracle, bool isMilestone, tuple(uint96 amount, uint64 expiry, address oracle, uint8 state, bool attested, bool outcome)[] tranches))",
  "function getTranche(bytes32,uint256) view returns (tuple(uint96 amount, uint64 expiry, address oracle, uint8 state, bool attested, bool outcome))",
];

function link(kind: "tx" | "address", id: string) {
  return `${EXPLORER}/${kind}/${id}`;
}

async function scenario1() {
  // Fail fast before any network calls.
  const env = requireOracleEnv();
  console.log("\n=== Scenario 1: planting-confirmed tranche 1 release, survival-check-failed tranche 2 refund ===\n");
  const provider = new JsonRpcProvider(env.rpcUrl);
  const buyer = new Wallet(env.buyerPk, provider);
  const oracle = new Wallet(env.oraclePk, provider);

  const vault = new Contract(env.vault, VAULT_ABI, buyer);
  const usdc = new Contract(env.usdc, ERC20_ABI, buyer);

  const claimId = keccak256(toUtf8Bytes("reforestation-plot-7"));
  const trancheAmts = [parseUnits("100", 6), parseUnits("100", 6)]; // 100 + 100 USDC
  const expiries = [
    BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60),
    BigInt(Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60),
  ];

  // Lock (payee = buyer explicitly; pass zero address to default to buyer).
  const buyerAddr = await buyer.getAddress();
  let tx = await usdc.approve(env.vault, trancheAmts[0] * 2n);
  await tx.wait();
  tx = await vault.lockMilestoneClaim(claimId, await oracle.getAddress(), buyerAddr, trancheAmts, expiries);
  const r0 = await tx.wait();
  console.log(`  lockMilestoneClaim  ${link("tx", tx.hash)}  block ${r0!.blockNumber}`);

  // Tranche 0 (planting) — survival doc 95% >= 80% → true → release.
  const plantingDoc: SurvivalDoc = { survivalPct: 95 };
  const plantingOutcome = mapSurvivalDocToOutcome(plantingDoc);
  console.log(`  planting doc survival=${plantingDoc.survivalPct}% → outcome=${plantingOutcome}`);
  const vO = new Contract(env.vault, VAULT_ABI, oracle);
  tx = await vO.postAttestation(claimId, 0, plantingOutcome);
  await tx.wait();
  console.log(`  attest[0] = ${plantingOutcome}     ${link("tx", tx.hash)}  (planting confirmed)`);

  // Tranche 1 (6-month survival) — survival doc 62% < 80% → false → refund.
  const survivalDoc: SurvivalDoc = { survivalPct: 62 };
  const survivalOutcome = mapSurvivalDocToOutcome(survivalDoc);
  console.log(`  survival doc survival=${survivalDoc.survivalPct}% → outcome=${survivalOutcome}`);
  tx = await vO.postAttestation(claimId, 1, survivalOutcome);
  const r1 = await tx.wait();
  console.log(`  attest[1] = ${survivalOutcome}    ${link("tx", tx.hash)}  block ${r1!.blockNumber}  (survival check failed → refund)`);

  // Read-back: display onchain status.
  const tranche0 = await vault.getTranche(claimId, 0);
  const tranche1 = await vault.getTranche(claimId, 1);
  console.log(`  status[0]: ${formatTranche(normalizeTranche(tranche0), 0)}`);
  console.log(`  status[1]: ${formatTranche(normalizeTranche(tranche1), 1)}`);

  // Keep module-level fallbacks referenced (parity with .env.example).
  void ARC_RPC; void EXPLORER; void VAULT; void USDC; void BUYER_PK; void ORACLE_PK;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  scenario1().catch((e) => { console.error(e); process.exit(1); });
}
