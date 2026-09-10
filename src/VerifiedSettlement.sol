// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "forge-std/interfaces/IERC20.sol";

library SafeTransferLib {
    error TransferFailed();
    function safeTransferFrom(IERC20 t, address f, address to, uint256 a) internal {
        (bool ok, bytes memory d) = address(t).call(abi.encodeWithSelector(IERC20.transferFrom.selector, f, to, a));
        if (!ok || (d.length != 0 && !abi.decode(d, (bool)))) revert TransferFailed();
    }
    function safeTransfer(IERC20 t, address to, uint256 a) internal {
        (bool ok, bytes memory d) = address(t).call(abi.encodeWithSelector(IERC20.transfer.selector, to, a));
        if (!ok || (d.length != 0 && !abi.decode(d, (bool)))) revert TransferFailed();
    }
}

/// @title VerifiedSettlement
/// @notice TrueCarbon — verified-outcome settlement for climate finance.
///
/// Per-claim flow:
///   - Buyer locks USDC against a claimId, registering an oracle address.
///   - Oracle (oracle-only) posts an attestation: outcome=true|false.
///   - true  → funds release to the registered payee (the project/NGO).
///   - false → funds refund to the buyer (dead trees, unmet target, etc.).
///   - No attestation before expiry → auto-refund to buyer.
///
/// Milestone variant:
///   - lockMilestoneClaim(claimId, oracle, tranches[], expiries[]) — multi-tranche.
///   - Tranche N+1 cannot be attested before tranche N has been resolved
///     (released or refunded) — state machine enforced.
///
/// Invariants (encoded in test/VerifiedSettlement.t.sol):
///   1. A tranche releases ONLY when its registered oracle posts a confirming
///      attestation (true) — no other caller can trigger release.
///   2. A failed/negative oracle attestation routes to refund, never to release.
///   3. No attestation before expiry → auto-refund, same as a failed check.
///   4. Multi-tranche claims cannot skip a tranche; N+1 requires N resolved.
///   5. Conservation: total released + refunded never exceeds total locked.
contract VerifiedSettlement {
    using SafeTransferLib for IERC20;

    enum TrancheState { Locked, Released, Refunded }

    struct Tranche {
        uint96  amount;
        uint64  expiry;
        address oracle;       // override per-tranche; falls back to claim.oracle if zero
        TrancheState state;
        bool    attested;      // has any attestation been posted
        bool    outcome;       // last attestation's outcome
    }

    struct Claim {
        address buyer;        // refund destination
        address payee;        // release destination
        address oracle;       // default oracle for this claim
        bool    isMilestone;  // multi-tranche?
        Tranche[] tranches;
    }

    IERC20 public immutable usdc;
    mapping(bytes32 => Claim) public claims;

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    event ClaimLocked(bytes32 indexed claimId, address indexed buyer, address indexed payee, uint256 trancheCount);
    event Attested(bytes32 indexed claimId, uint256 trancheIndex, bool outcome, address oracle);
    event Released(bytes32 indexed claimId, uint256 trancheIndex, address payee, uint96 amount);
    event Refunded(bytes32 indexed claimId, uint256 trancheIndex, address buyer, uint96 amount);

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------

    error UnknownClaim();
    error ZeroAddress();
    error ZeroAmount();
    error ExpiryMustBeFuture();
    error WrongState();
    error NotOracle();
    error ExpiryNotReached();
    error Exceeded();
    error InvalidMilestone();
    error NotBuyer();

    // ------------------------------------------------------------------
    // Construction
    // ------------------------------------------------------------------

    constructor(IERC20 _usdc) { if (address(_usdc) == address(0)) revert ZeroAddress(); usdc = _usdc; }

    // ------------------------------------------------------------------
    // Single-claim lock
    // ------------------------------------------------------------------

    function lockClaim(
        bytes32 claimId,
        address oracle,
        address payee,
        uint96  amount,
        uint64  expiry
    ) external {
        if (oracle == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (expiry <= block.timestamp) revert ExpiryMustBeFuture();
        if (claims[claimId].buyer != address(0)) revert UnknownClaim();

        Claim storage c = claims[claimId];
        c.buyer = msg.sender;
        c.payee = payee == address(0) ? msg.sender : payee;
        c.oracle = oracle;
        Tranche storage t = c.tranches.push();
        t.amount = amount;
        t.expiry = expiry;
        t.oracle = oracle;

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit ClaimLocked(claimId, msg.sender, c.payee, 1);
    }

    function setPayee(bytes32 claimId, address payee) external {
        Claim storage c = _claim(claimId);
        if (msg.sender != c.buyer) revert NotBuyer();
        if (payee == address(0)) revert ZeroAddress();
        c.payee = payee;
    }

    // ------------------------------------------------------------------
    // Milestone-claim lock
    // ------------------------------------------------------------------

    function lockMilestoneClaim(
        bytes32 claimId,
        address oracle,
        address payee,
        uint96[] calldata trancheAmounts,
        uint64[] calldata expiries
    ) external {
        if (oracle == address(0)) revert ZeroAddress();
        if (trancheAmounts.length == 0 || trancheAmounts.length != expiries.length) revert InvalidMilestone();
        if (claims[claimId].buyer != address(0)) revert UnknownClaim();

        Claim storage c = claims[claimId];
        c.buyer = msg.sender;
        c.payee = payee == address(0) ? msg.sender : payee;
        c.oracle = oracle;
        c.isMilestone = true;

        uint256 total;
        for (uint256 i = 0; i < trancheAmounts.length; i++) {
            if (trancheAmounts[i] == 0) revert ZeroAmount();
            if (expiries[i] <= block.timestamp) revert ExpiryMustBeFuture();
            Tranche storage t = c.tranches.push();
            t.amount = trancheAmounts[i];
            t.expiry = expiries[i];
            t.oracle = oracle;
            total += trancheAmounts[i];
        }

        usdc.safeTransferFrom(msg.sender, address(this), total);
        emit ClaimLocked(claimId, msg.sender, c.payee, trancheAmounts.length);
    }

    // ------------------------------------------------------------------
    // Oracle attestation
    // ------------------------------------------------------------------

    function postAttestation(
        bytes32 claimId,
        uint256 trancheIndex,
        bool    outcome
    ) external {
        Claim storage c = _claim(claimId);
        if (trancheIndex >= c.tranches.length) revert Exceeded();
        Tranche storage t = c.tranches[trancheIndex];
        if (t.state != TrancheState.Locked) revert WrongState();
        if (block.timestamp > t.expiry) revert ExpiryNotReached();

        address oracle = t.oracle != address(0) ? t.oracle : c.oracle;
        if (msg.sender != oracle) revert NotOracle();

        // Milestone invariant 4: tranche N+1 requires tranche N resolved.
        if (c.isMilestone && trancheIndex > 0) {
            if (c.tranches[trancheIndex - 1].state != TrancheState.Released &&
                c.tranches[trancheIndex - 1].state != TrancheState.Refunded) {
                revert WrongState();
            }
        }

        t.attested = true;
        t.outcome = outcome;

        if (outcome) {
            t.state = TrancheState.Released;
            usdc.safeTransfer(c.payee, t.amount);
            emit Released(claimId, trancheIndex, c.payee, t.amount);
        } else {
            t.state = TrancheState.Refunded;
            usdc.safeTransfer(c.buyer, t.amount);
            emit Refunded(claimId, trancheIndex, c.buyer, t.amount);
        }
        emit Attested(claimId, trancheIndex, outcome, msg.sender);
    }

    // ------------------------------------------------------------------
    // Auto-refund on expiry
    // ------------------------------------------------------------------

    function refundExpired(bytes32 claimId, uint256 trancheIndex) external {
        Claim storage c = _claim(claimId);
        if (trancheIndex >= c.tranches.length) revert Exceeded();
        Tranche storage t = c.tranches[trancheIndex];
        if (t.state != TrancheState.Locked) revert WrongState();
        if (block.timestamp <= t.expiry) revert ExpiryNotReached();

        // Milestone invariant 4 (same as postAttestation):
        // tranche N+1 requires tranche N resolved (Released or Refunded).
        if (c.isMilestone && trancheIndex > 0) {
            if (c.tranches[trancheIndex - 1].state != TrancheState.Released &&
                c.tranches[trancheIndex - 1].state != TrancheState.Refunded) {
                revert WrongState();
            }
        }

        t.state = TrancheState.Refunded;
        usdc.safeTransfer(c.buyer, t.amount);
        emit Refunded(claimId, trancheIndex, c.buyer, t.amount);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function getClaim(bytes32 claimId) external view returns (Claim memory) { return claims[claimId]; }
    function getTranche(bytes32 claimId, uint256 idx) external view returns (Tranche memory) { return claims[claimId].tranches[idx]; }

    function _claim(bytes32 id) internal view returns (Claim storage) {
        Claim storage c = claims[id];
        if (c.buyer == address(0)) revert UnknownClaim();
        return c;
    }
}
