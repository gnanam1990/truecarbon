# TrueCarbon

**Verified-outcome settlement for climate finance. Built on Arc.**

Buyers lock USDC against an outcome claim; funds release only when a registered outcome oracle posts a confirming attestation. Tranche/milestone claims supported for reforestation-style staged settlement.

Status: early build · Arc testnet · **unaudited — oracle is mocked per PRD §4.**

Docs: [`docs/PRD.md`](docs/PRD.md) · Build prompts: [`PROMPT.md`](PROMPT.md) · Testnet addresses: [`docs/addresses.md`](docs/addresses.md)

## Quickstart

```bash
forge test
npm install && npm test
```

## Honesty rules

- Oracle is a mock; production needs a real satellite/sensor integration. See `services/README.md` for what that would require.
- Unaudited testnet software — do not use with real funds.
