# TrueCarbon oracle service

This is the **mock** oracle service. Per PRD §4, v1 deliberately ships with a manually-triggerable oracle in place of a real satellite/sensor integration. The boundary is the `IOutcomeOracle` interface in `oracle.ts` — replacing `MockOracle` with a real verifier means implementing that interface and pointing the onchain oracle field at the new address.

## What this is

- `oracle.ts` — `IOutcomeOracle` interface + `MockOracle` class + demo CLI.
- `test/oracle.test.ts` — 1 unit test (address derivation).

## What this is not (v1)

- **Not** a real satellite/sensor integration. The "oracle" here is a manually-triggerable signer that posts attestations on demand. It deliberately produces no fabricated "real" verification claims.
- **Not** a tokenization or secondary-trading layer.

## What a production integration would need to replace this

1. A data source: satellite imagery pipeline, sensor network, or auditor attestation API.
2. An attestation format compatible with `VerifiedSettlement.postAttestation(bytes32,uint256,bool)`.
3. Key management: the partner's signing key registered onchain as the oracle for the relevant claim.
4. Operational monitoring: at minimum, alert on failed/expiry paths so claims are refunded, not silently dropped.

Update the deploy script to point each claim at the new oracle address; the onchain field remains per-claim so verification authority stays explicit.
