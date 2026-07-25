# TrueCarbon — testnet addresses & lifecycle proof

**Unaudited testnet software — no real funds.**

## Arc Testnet (chain 5042002)

| Resource | Value | Source |
|----------|-------|--------|
| RPC | `https://rpc.testnet.arc.network` | docs.arc.io |
| Explorer | `https://testnet.arcscan.app` | docs |
| USDC ERC-20 | `0x3600000000000000000000000000000000000000` | docs.arc.io/arc/references/contract-addresses |
| USDC decimals | 6 (verified onchain) | cast call |

## VerifiedSettlement deployment

Real testnet deploy from this repo is pending a deployer key funded with testnet USDC (Circle faucet: https://faucet.circle.com/, browser-only reCAPTCHA).

### Validated deployment (Anvil fork of Arc testnet, block 53,586,848)

- **Contract**: VerifiedSettlement
- **Deployed address (fork)**: `0xf48883f2ae4c4bf4654f45997fe47d73daa4da07`
- **Deploy tx (fork)**: `0xb068c32519cc0a3c29e1eed3b9216bc6e4c63b8a620316464648fd69c5e4c064`
- **Tool**: `forge script script/Deploy.s.sol:Deploy --rpc-url $ARC_TESTNET_RPC --broadcast`
- **Run log**: `broadcast/Deploy.s.sol/5042002/run-latest.json`

The demo scenario from PRD §5 is scripted in `services/oracle.ts` (CLI) and ready to run against real Arc testnet with a funded key. See README.md.

## How to run on real Arc testnet

```bash
cp .env.example .env
# fill in PRIVATE_KEY, BUYER_KEY, ORACLE_KEY, USDC_ADDRESS
source .env
forge script script/Deploy.s.sol:Deploy --rpc-url $ARC_TESTNET_RPC --broadcast
VAULT_ADDRESS=0x... npm run demo
```

## Summary

| Metric | Value |
|--------|-------|
| Foundry tests | 13 / 13 passing (incl. 512-run conservation fuzz) |
| Off-chain unit tests | 1 / 1 passing |
| Invariants encoded | 5 / 5 from PROMPT.md |
| Real testnet deploy | pending funded key |
| Fork deploy | ✅ validated on Anvil fork of Arc testnet at latest block |
