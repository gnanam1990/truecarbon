// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {VerifiedSettlement} from "../src/VerifiedSettlement.sol";

contract MockUSDC is IERC20 {
    string public override name = "USD Coin";
    string public override symbol = "USDC";
    uint8  public override decimals = 6;
    uint256 public override totalSupply;
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;
    function mint(address to, uint256 a) external { totalSupply += a; balanceOf[to] += a; emit Transfer(address(0), to, a); }
    function transfer(address to, uint256 a) public override returns (bool) { _t(msg.sender, to, a); return true; }
    function approve(address s, uint256 a) public override returns (bool) { allowance[msg.sender][s] = a; emit Approval(msg.sender, s, a); return true; }
    function transferFrom(address f, address to, uint256 a) public override returns (bool) {
        uint256 al = allowance[f][msg.sender];
        if (al != type(uint256).max) allowance[f][msg.sender] = al - a;
        _t(f, to, a);
        return true;
    }
    function _t(address f, address to, uint256 a) internal {
        balanceOf[f] -= a; balanceOf[to] += a; emit Transfer(f, to, a);
    }
}

contract VerifiedSettlementTest is Test {
    VerifiedSettlement public vs;
    MockUSDC public usdc;
    address public buyer;
    address public payee;
    address public oracle;
    address public attacker;
    bytes32 public constant CID = keccak256("reforestation-plot-7");

    function setUp() public {
        usdc = new MockUSDC();
        vs = new VerifiedSettlement(usdc);
        buyer = makeAddr("buyer");
        payee = makeAddr("payee");
        oracle = makeAddr("oracle");
        attacker = makeAddr("attacker");

        usdc.mint(buyer, 100_000_000_000);
        vm.prank(buyer);
        usdc.approve(address(vs), type(uint256).max);
    }

    // -----------------------------------------------------------------------
    // Invariant 1: release ONLY by registered oracle
    // -----------------------------------------------------------------------

    function test_invariant1_oracleAttestTrue_releases() public {
        vm.prank(buyer);
        vs.lockClaim(CID, oracle, address(0), 200_000_000, uint64(block.timestamp + 30 days));
        vm.prank(buyer); vs.setPayee(CID, payee);

        uint256 payeeBefore = usdc.balanceOf(payee);
        vm.prank(oracle);
        vs.postAttestation(CID, 0, true);
        assertEq(usdc.balanceOf(payee), payeeBefore + 200_000_000);
    }

    function test_invariant1_attackerCannotRelease() public {
        vm.prank(buyer);
        vs.lockClaim(CID, oracle, address(0), 200_000_000, uint64(block.timestamp + 30 days));
        vm.prank(buyer); vs.setPayee(CID, payee);

        vm.prank(attacker);
        vm.expectRevert(VerifiedSettlement.NotOracle.selector);
        vs.postAttestation(CID, 0, true);
        assertEq(usdc.balanceOf(payee), 0);
    }

    // -----------------------------------------------------------------------
    // Invariant 2: false attestation → refund, never release
    // -----------------------------------------------------------------------

    function test_invariant2_oracleAttestFalse_refunds() public {
        vm.prank(buyer);
        vs.lockClaim(CID, oracle, address(0), 200_000_000, uint64(block.timestamp + 30 days));

        uint256 buyerBefore = usdc.balanceOf(buyer);
        vm.prank(oracle);
        vs.postAttestation(CID, 0, false);
        assertEq(usdc.balanceOf(buyer), buyerBefore + 200_000_000);
        assertEq(usdc.balanceOf(payee), 0);
    }

    // -----------------------------------------------------------------------
    // Invariant 3: no attestation before expiry → auto-refund
    // -----------------------------------------------------------------------

    function test_invariant3_refundExpired() public {
        vm.prank(buyer);
        vs.lockClaim(CID, oracle, address(0), 200_000_000, uint64(block.timestamp + 30 days));

        vm.warp(block.timestamp + 31 days);
        uint256 buyerBefore = usdc.balanceOf(buyer);
        vs.refundExpired(CID, 0);
        assertEq(usdc.balanceOf(buyer), buyerBefore + 200_000_000);
    }

    function test_invariant3_attestAfterExpiry_reverts() public {
        vm.prank(buyer);
        vs.lockClaim(CID, oracle, address(0), 200_000_000, uint64(block.timestamp + 30 days));
        vm.warp(block.timestamp + 31 days);
        vm.prank(oracle);
        vm.expectRevert(VerifiedSettlement.ExpiryNotReached.selector);
        vs.postAttestation(CID, 0, true);
    }

    // -----------------------------------------------------------------------
    // Invariant 4: milestone ordering — cannot skip tranche
    // -----------------------------------------------------------------------

    function test_invariant4_milestoneCannotSkip() public {
        uint96[] memory amts = new uint96[](2);
        amts[0] = 100_000_000; amts[1] = 100_000_000;
        uint64[] memory exps = new uint64[](2);
        exps[0] = uint64(block.timestamp + 30 days);
        exps[1] = uint64(block.timestamp + 60 days);

        vm.prank(buyer);
        vs.lockMilestoneClaim(CID, oracle, address(0), amts, exps);

        // Attest tranche 1 before tranche 0 — must revert.
        vm.prank(oracle);
        vm.expectRevert(VerifiedSettlement.WrongState.selector);
        vs.postAttestation(CID, 1, true);
    }

    function test_invariant4_milestoneSequential() public {
        uint96[] memory amts = new uint96[](2);
        amts[0] = 100_000_000; amts[1] = 100_000_000;
        uint64[] memory exps = new uint64[](2);
        exps[0] = uint64(block.timestamp + 30 days);
        exps[1] = uint64(block.timestamp + 60 days);

        vm.prank(buyer);
        vs.lockMilestoneClaim(CID, oracle, address(0), amts, exps);
        vm.prank(buyer); vs.setPayee(CID, payee);

        // Attest tranche 0 true → release.
        uint256 payeeBefore = usdc.balanceOf(payee);
        vm.prank(oracle);
        vs.postAttestation(CID, 0, true);
        assertEq(usdc.balanceOf(payee), payeeBefore + 100_000_000);

        // Now tranche 1 is reachable.
        vm.prank(oracle);
        vs.postAttestation(CID, 1, true);
        assertEq(usdc.balanceOf(payee), payeeBefore + 200_000_000);
    }

    function test_invariant4_milestonePartialRefund_stillUnlocksNext() public {
        uint96[] memory amts = new uint96[](2);
        amts[0] = 100_000_000; amts[1] = 100_000_000;
        uint64[] memory exps = new uint64[](2);
        exps[0] = uint64(block.timestamp + 30 days);
        exps[1] = uint64(block.timestamp + 60 days);

        vm.prank(buyer);
        vs.lockMilestoneClaim(CID, oracle, address(0), amts, exps);

        // Tranche 0 fails → refund. Tranche 1 should still be reachable.
        vm.prank(oracle);
        vs.postAttestation(CID, 0, false);

        // Tranche 1: auto-refund via expiry (oracle never attests it).
        vm.warp(block.timestamp + 61 days);
        uint256 buyerBefore = usdc.balanceOf(buyer);
        vs.refundExpired(CID, 1);
        assertEq(usdc.balanceOf(buyer), buyerBefore + 100_000_000);
    }

    // -----------------------------------------------------------------------
    // Invariant 5: conservation
    // -----------------------------------------------------------------------

    function test_invariant5_singleRelease() public {
        vm.prank(buyer);
        vs.lockClaim(CID, oracle, address(0), 200_000_000, uint64(block.timestamp + 30 days));
        vm.prank(buyer); vs.setPayee(CID, payee);
        uint256 payeeBefore = usdc.balanceOf(payee);

        vm.prank(oracle);
        vs.postAttestation(CID, 0, true);

        assertEq(usdc.balanceOf(address(vs)), 0, "funds stranded");
        assertEq(usdc.balanceOf(payee), payeeBefore + 200_000_000);
    }

    function test_invariant5_singleRefund() public {
        vm.prank(buyer);
        vs.lockClaim(CID, oracle, address(0), 200_000_000, uint64(block.timestamp + 30 days));
        uint256 buyerBefore = usdc.balanceOf(buyer);

        vm.warp(block.timestamp + 31 days);
        vs.refundExpired(CID, 0);

        assertEq(usdc.balanceOf(address(vs)), 0, "funds stranded");
        assertEq(usdc.balanceOf(buyer), buyerBefore + 200_000_000);
    }

    // -----------------------------------------------------------------------
    // Misc errors
    // -----------------------------------------------------------------------

    function test_zeroAmount_reverts() public {
        vm.prank(buyer);
        vm.expectRevert(VerifiedSettlement.ZeroAmount.selector);
        vs.lockClaim(CID, oracle, address(0), 0, uint64(block.timestamp + 1 days));
    }

    function test_pastExpiry_reverts() public {
        vm.prank(buyer);
        vm.expectRevert(VerifiedSettlement.ExpiryMustBeFuture.selector);
        vs.lockClaim(CID, oracle, address(0), 100, uint64(block.timestamp));
    }

    // -----------------------------------------------------------------------
    // Phase-2: payee param (explicit payee, zero defaults to buyer)
    // -----------------------------------------------------------------------

    function test_payeeParam_explicitPayee_releasesToPayee() public {
        vm.prank(buyer);
        vs.lockClaim(CID, oracle, payee, 200_000_000, uint64(block.timestamp + 30 days));

        VerifiedSettlement.Claim memory c = vs.getClaim(CID);
        assertEq(c.payee, payee, "payee not set from param");
        assertEq(c.buyer, buyer, "buyer mismatch");

        uint256 payeeBefore = usdc.balanceOf(payee);
        vm.prank(oracle);
        vs.postAttestation(CID, 0, true);
        assertEq(usdc.balanceOf(payee), payeeBefore + 200_000_000);
    }

    function test_payeeParam_zeroDefaultsToBuyer() public {
        vm.prank(buyer);
        vs.lockClaim(CID, oracle, address(0), 200_000_000, uint64(block.timestamp + 30 days));

        VerifiedSettlement.Claim memory c = vs.getClaim(CID);
        assertEq(c.payee, buyer, "zero payee should default to buyer");
    }

    function test_milestonePayeeParam_explicitPayee() public {
        uint96[] memory amts = new uint96[](2);
        amts[0] = 100_000_000; amts[1] = 100_000_000;
        uint64[] memory exps = new uint64[](2);
        exps[0] = uint64(block.timestamp + 30 days);
        exps[1] = uint64(block.timestamp + 60 days);

        vm.prank(buyer);
        vs.lockMilestoneClaim(CID, oracle, payee, amts, exps);

        VerifiedSettlement.Claim memory c = vs.getClaim(CID);
        assertEq(c.payee, payee, "milestone payee not set from param");

        uint256 payeeBefore = usdc.balanceOf(payee);
        vm.prank(oracle);
        vs.postAttestation(CID, 0, true);
        assertEq(usdc.balanceOf(payee), payeeBefore + 100_000_000);
    }

    // -----------------------------------------------------------------------
    // Phase-2: refundExpired milestone ordering (N-1 must be resolved)
    // -----------------------------------------------------------------------

    function test_refundExpired_ordering_reverts() public {
        uint96[] memory amts = new uint96[](2);
        amts[0] = 100_000_000; amts[1] = 100_000_000;
        uint64[] memory exps = new uint64[](2);
        exps[0] = uint64(block.timestamp + 30 days);
        exps[1] = uint64(block.timestamp + 31 days);

        vm.prank(buyer);
        vs.lockMilestoneClaim(CID, oracle, address(0), amts, exps);

        // Both tranches expired, but tranche 0 is still Locked.
        vm.warp(block.timestamp + 32 days);
        vm.expectRevert(VerifiedSettlement.WrongState.selector);
        vs.refundExpired(CID, 1);
    }

    function test_refundExpired_ordering_passesAfterResolve() public {
        uint96[] memory amts = new uint96[](2);
        amts[0] = 100_000_000; amts[1] = 100_000_000;
        uint64[] memory exps = new uint64[](2);
        exps[0] = uint64(block.timestamp + 30 days);
        exps[1] = uint64(block.timestamp + 60 days);

        vm.prank(buyer);
        vs.lockMilestoneClaim(CID, oracle, address(0), amts, exps);

        // Resolve tranche 0 first (refund path), then expiry-refund tranche 1.
        vm.prank(oracle);
        vs.postAttestation(CID, 0, false);

        vm.warp(block.timestamp + 61 days);
        uint256 buyerBefore = usdc.balanceOf(buyer);
        vs.refundExpired(CID, 1);
        assertEq(usdc.balanceOf(buyer), buyerBefore + 100_000_000);
    }

    // -----------------------------------------------------------------------
    // Fuzz: conservation under random oracle outcomes + expiry warps
    // -----------------------------------------------------------------------

    function testFuzz_conservation(
        bool attest,
        bool outcome,
        uint8 choice,
        uint64 warpDelta
    ) public {
        warpDelta = uint64(bound(warpDelta, 0, 60 days));
        uint96 amt = 100_000_000;

        vm.prank(buyer);
        vs.lockClaim(CID, oracle, address(0), amt, uint64(block.timestamp + 30 days));
        vm.prank(buyer); vs.setPayee(CID, payee);

        uint256 buyerBefore = usdc.balanceOf(buyer);
        uint256 payeeBefore = usdc.balanceOf(payee);

        if (attest) {
            if (warpDelta < 30 days) {
                vm.warp(block.timestamp + warpDelta);
            }
            vm.prank(oracle);
            try vs.postAttestation(CID, 0, outcome) {} catch {}
        } else {
            vm.warp(block.timestamp + warpDelta);
            try vs.refundExpired(CID, 0) {} catch {}
        }

        // If neither terminal state was reached, the contract still legitimately
        // holds the funds — that's NOT a conservation violation, it's the locked state.
        VerifiedSettlement.Tranche memory t = vs.getTranche(CID, 0);
        if (t.state == VerifiedSettlement.TrancheState.Locked) {
            // funds legitimately still in escrow
            assertEq(usdc.balanceOf(address(vs)), 100_000_000, "locked funds should still be in escrow");
            return;
        }
        // Conservation: vs.balance == 0 if terminal
        assertEq(usdc.balanceOf(address(vs)), 0, "funds stranded in vs");

        // Either payee or buyer got the money, never both, never neither.
        uint256 payeeDelta = usdc.balanceOf(payee) - payeeBefore;
        if (payeeDelta == 0) {
            // refunded: buyer balance = buyerBefore + 100M (full lock amount back)
            assertEq(usdc.balanceOf(buyer), buyerBefore + 100_000_000, "buyer not fully refunded");
        } else {
            assertEq(payeeDelta, 100_000_000, "payee got wrong amount");
            // released: buyer's post-funding balance should be unchanged from buyerBefore
            assertEq(usdc.balanceOf(buyer), buyerBefore, "buyer balance changed unexpectedly on release");
        }
    }
}
