# TrueCarbon — PRD v1.0

**Verified-outcome settlement for climate finance. Built on Arc.**

## 1. Problem
The voluntary carbon market moves billions annually, and multiple large investigations have found that a substantial share of sold credits represent reductions that were never actually realized — credits get paid for on a *claim*, not a *verified outcome*. The same structural problem recurs across reforestation funding (trees claimed planted that die within months) and community renewable projects (generation claimed that a grid meter never confirms).

## 2. Solution (MVP scope)
**VerifiedSettlement (contract), a generic primitive, not one project's ledger.** A buyer locks USDC against a specific outcome claim (e.g., "X tons sequestered by project Y, verifiable by oracle Z"). Funds release ONLY when a registered, pluggable **outcome oracle** posts a confirming attestation onchain before an expiry — otherwise auto-refund. The oracle interface is intentionally generic: a satellite-imagery verifier, a sensor network, or a manual auditor-attestation service can all plug in without changing the settlement contract.

**Milestone variant (reforestation-style).** The same contract supports staged claims — tranche 1 on planting confirmation, tranche 2 only if a later survival-rate oracle check clears a threshold — directly reusing the single-release-per-tranche pattern rather than inventing new logic.

## 3. Why Arc specifically
USDC-native gas makes frequent, granular verification-triggered micro-settlements viable (a small reforestation plot's tranche is a real dollar amount, not large enough to justify expensive gas elsewhere). Arc Explorer gives any buyer, auditor, or journalist a public, permanent settlement trail tied to the specific verification event — directly answering "was this credit actually verified" with a link, not a claim.

## 4. Non-goals (v1)
No actual satellite/sensor integration built from scratch — use a mocked oracle interface with a clearly-labeled manual-attestation fallback · no token · no secondary trading of credits.

## 5. Demo moment
A buyer locks 200 USDC against a reforestation claim, tranche 1 (planting). A mock planting-oracle confirms → tranche 1 releases. Tranche 2 (6-month survival) sits locked until a second mock oracle call — confirm it passes 80% survival → releases; simulate a failing case where survival check fails → funds auto-refund to buyer rather than pay for dead trees.

## 6. Honesty rules
Label the oracle as mocked/interface-only until a real verification partner is integrated · unaudited testnet · real transactions only.
