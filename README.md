# TrueCarbon

**Verified-outcome settlement for climate finance. Built on Arc.**

Buyers lock USDC against an outcome claim; funds release only when a registered outcome oracle posts a confirming attestation. Tranche/milestone claims supported for reforestation-style staged settlement.

Status: early build · Arc testnet · **unaudited — oracle is mocked per PRD §4.**

Docs: [`docs/PRD.md`](docs/PRD.md) · Build prompts: [`PROMPT.md`](PROMPT.md) · Testnet addresses: [`docs/addresses.md`](docs/addresses.md)

## Quickstart

```bash
forge test               # 13 invariant tests
npm install && npm test  # 1 off-chain unit test
```

## Layout

- `src/` — VerifiedSettlement.
- `test/` — Foundry unit + fuzz tests.
- `services/` — mock oracle + demo CLI.
- `script/` — deployment.
- `docs/addresses.md` — testnet addresses.

## Honesty rules

- Oracle is a mock; production needs a real satellite/sensor integration. See `services/README.md`.
- Unaudited testnet software — do not use with real funds.
