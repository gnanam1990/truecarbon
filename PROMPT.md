# TrueCarbon — staged Claude Code build prompts

Read docs/PRD.md fully first. One stage at a time.

---
## STAGE 1 — Core contract (VerifiedSettlement)

Foundry, tests before implementation.

INVARIANTS:
1. A tranche releases ONLY when its registered oracle address posts a confirming attestation — no other caller can trigger release.
2. A failed/negative oracle attestation (e.g., survival check fails) routes to refund, never to release.
3. No attestation before expiry → auto-refund, same as a failed check.
4. Multi-tranche claims (reforestation-style) cannot skip a tranche — tranche N+1 requires tranche N resolved (released or refunded), state machine enforced.
5. Conservation: fuzz that total released + total refunded never exceeds total locked, across arbitrary oracle-response sequences.

BUILD: `lockClaim(claimId, oracle, amount, expiry)`, `lockMilestoneClaim(claimId, oracle, tranches[], expiries[])`, `postAttestation(claimId, trancheIndex, outcome: bool)` (oracle-only), `refundExpired(claimId, trancheIndex)`. Full suite + fuzz on invariant 5. Report test count and invariants covered.

---
## STAGE 2 — Oracle adapter (mocked, pluggable interface)

TypeScript service (services/) implementing a generic `IOutcomeOracle` pattern:
- `mock-oracle.ts`: a manually-triggerable stand-in for a real verification service (planting confirmation, survival-rate check) — clearly labeled as a placeholder for a real satellite/sensor integration.
- Document in services/README.md exactly what a production oracle integration would need to replace this (data source, attestation format, key management) — be honest about what's real vs. stubbed.
- Tests using the mock, no fabricated "real" verification claims anywhere in code or docs.

---
## STAGE 3 — Arc testnet deployment + lifecycle proof

Deploy to Arc testnet (RPC https://rpc.testnet.arc.network, chain 5042002). Verify USDC address onchain (symbol/decimals) before use; read docs.arc.io/arc/references/evm-differences first. Deployer key from .env, never committed.

Run both demo scenarios from PRD §5 as real transactions: (1) planting-confirmed tranche 1 release, (2) survival-check-failed tranche 2 auto-refund. Capture explorer links into docs/addresses.md. Verify source on testnet.arcscan.app.

---
## STAGE 4 — Demo interface

Minimal CLI or single-page UI: claim list, tranche states, a control to manually trigger the mock oracle's confirm/fail response for each demo scenario, printing the real explorer link. Label the oracle as "mocked — interface for a real verification partner." Update README. Commit and report final state.
