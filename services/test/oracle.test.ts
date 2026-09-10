import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Wallet, parseUnits } from "ethers";
import {
  MockOracle,
  InMemorySettlement,
  requireOracleEnv,
  survivalToOutcome,
  mapSurvivalDocToOutcome,
  describeTrancheState,
  formatTranche,
  formatClaim,
  SURVIVAL_THRESHOLD_PCT,
} from "../oracle.ts";

describe("MockOracle", () => {
  it("address is derived from the signer key", () => {
    const pk = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const o = new MockOracle("0x0000000000000000000000000000000000000001", "http://localhost:1", pk);
    assert.equal(o.address, new Wallet(pk).address);
  });

  it("constructor throws on missing vault/signer (env validation)", () => {
    const pk = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    assert.throws(() => new MockOracle("", "http://localhost:1", pk), /vaultAddress/);
    assert.throws(
      () => new MockOracle("0x0000000000000000000000000000000000000001", "http://localhost:1", ""),
      /signerPk/
    );
  });

  it("exposes refundExpired + read helpers on the interface", () => {
    const pk = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const o = new MockOracle("0x0000000000000000000000000000000000000001", "http://localhost:1", pk);
    assert.equal(typeof o.refundExpired, "function");
    assert.equal(typeof o.getClaim, "function");
    assert.equal(typeof o.getTranche, "function");
    assert.equal(typeof o.describeTranche, "function");
    assert.equal(typeof o.describeClaim, "function");
    assert.equal(typeof o.attestFromSurvivalDoc, "function");
  });
});

describe("requireOracleEnv", () => {
  it("throws if VAULT/BUYER_PK/ORACLE_PK missing", () => {
    assert.throws(() => requireOracleEnv({} as NodeJS.ProcessEnv), /VAULT_ADDRESS/);
    assert.throws(
      () => requireOracleEnv({ VAULT_ADDRESS: "0x1" } as unknown as NodeJS.ProcessEnv),
      /BUYER_KEY/
    );
    assert.throws(
      () =>
        requireOracleEnv({
          VAULT_ADDRESS: "0x1",
          BUYER_KEY: "0x2",
        } as unknown as NodeJS.ProcessEnv),
      /ORACLE_KEY/
    );
  });

  it("returns env when complete", () => {
    const env = requireOracleEnv({
      VAULT_ADDRESS: "0x1",
      BUYER_KEY: "0x2",
      ORACLE_KEY: "0x3",
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(env.vault, "0x1");
    assert.equal(env.buyerPk, "0x2");
    assert.equal(env.oraclePk, "0x3");
  });
});

describe("survival doc → outcome (80% threshold)", () => {
  it(`threshold is ${SURVIVAL_THRESHOLD_PCT}%`, () => {
    assert.equal(SURVIVAL_THRESHOLD_PCT, 80);
  });

  it("maps >=80% to true, <80% to false", () => {
    assert.equal(survivalToOutcome(95), true);
    assert.equal(survivalToOutcome(80), true);
    assert.equal(survivalToOutcome(79.9), false);
    assert.equal(survivalToOutcome(62), false);
    assert.equal(mapSurvivalDocToOutcome({ survivalPct: 95 }), true);
    assert.equal(mapSurvivalDocToOutcome({ survivalPct: 62 }), false);
  });

  it("accepts survivalRate fraction or percent", () => {
    assert.equal(mapSurvivalDocToOutcome({ survivalRate: 0.95 }), true);
    assert.equal(mapSurvivalDocToOutcome({ survivalRate: 0.62 }), false);
    assert.equal(mapSurvivalDocToOutcome({ survivalRate: 85 }), true);
  });

  it("throws on empty/invalid doc", () => {
    assert.throws(() => mapSurvivalDocToOutcome({}), /survivalPct|survivalRate/);
    assert.throws(() => survivalToOutcome(NaN), /finite/);
  });
});

describe("read helpers (status display)", () => {
  it("describeTrancheState maps 0/1/2", () => {
    assert.equal(describeTrancheState(0), "Locked");
    assert.equal(describeTrancheState(1), "Released");
    assert.equal(describeTrancheState(2), "Refunded");
    assert.equal(describeTrancheState(9), "Unknown");
  });

  it("formatTranche/formatClaim render status", () => {
    const t = {
      amount: parseUnits("100", 6),
      expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
      oracle: "0x0000000000000000000000000000000000000001",
      state: 1,
      attested: true,
      outcome: true,
    };
    const s = formatTranche(t, 0);
    assert.match(s, /Released/);
    assert.match(s, /100/);
    const c = formatClaim(
      { buyer: "0xb", payee: "0xp", oracle: "0xo", isMilestone: true, tranches: [t] },
      "0xclaim"
    );
    assert.match(c, /0xclaim/);
    assert.match(c, /Released/);
  });
});

describe("mock-integration: settlement flow (no network)", () => {
  const amt = (n: string) => parseUnits(n, 6);

  it("attest true → release", () => {
    const now = Math.floor(Date.now() / 1000);
    const s = new InMemorySettlement([amt("100"), amt("100")], [now + 30 * 86400, now + 60 * 86400], now);
    // Survival doc 95% → true → release tranche 0.
    const outcome = mapSurvivalDocToOutcome({ survivalPct: 95 });
    assert.equal(outcome, true);
    assert.equal(s.postAttestation(0, outcome), "Released");
    assert.equal(s.tranches[0].state, "Released");
    assert.equal(s.released, amt("100"));
    assert.match(s.status(0), /Released/);
  });

  it("attest false → refund", () => {
    const now = Math.floor(Date.now() / 1000);
    const s = new InMemorySettlement([amt("100"), amt("100")], [now + 30 * 86400, now + 60 * 86400], now);
    assert.equal(s.postAttestation(0, true), "Released");
    // Survival doc 62% → false → refund tranche 1.
    const outcome = mapSurvivalDocToOutcome({ survivalPct: 62 });
    assert.equal(outcome, false);
    assert.equal(s.postAttestation(1, outcome), "Refunded");
    assert.equal(s.refunded, amt("100"));
  });

  it("ordering: N+1 requires N resolved (attest + refundExpired)", () => {
    const now = Math.floor(Date.now() / 1000);
    const s = new InMemorySettlement([amt("100"), amt("100")], [now + 30 * 86400, now + 31 * 86400], now);
    // Attest out of order must revert.
    assert.throws(() => s.postAttestation(1, true), /WrongState/);
    // Expire both, refund out of order must also revert (mirrors refundExpired ordering).
    s.now = now + 32 * 86400;
    assert.throws(() => s.refundExpired(1), /WrongState/);
    // Resolve tranche 0 first, then tranche 1 refund succeeds.
    s.now = now; // back in time: attest tranche 0 before expiry
    assert.equal(s.postAttestation(0, false), "Refunded");
    s.now = now + 32 * 86400;
    assert.equal(s.refundExpired(1), "Refunded");
  });
});
