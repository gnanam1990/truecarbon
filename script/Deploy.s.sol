// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {VerifiedSettlement} from "../src/VerifiedSettlement.sol";
contract Deploy is Script {
    error ZeroAddress();
    error USDCSymbolMismatch();
    error USDCDecimalsMismatch();

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        if (usdc == address(0)) revert ZeroAddress();

        // Onchain sanity: only deploy against the real USDC token.
        IERC20 token = IERC20(usdc);
        if (keccak256(bytes(token.symbol())) != keccak256(bytes("USDC"))) revert USDCSymbolMismatch();
        if (token.decimals() != 6) revert USDCDecimalsMismatch();

        vm.startBroadcast(pk);
        VerifiedSettlement v = new VerifiedSettlement(IERC20(usdc));
        vm.stopBroadcast();
        console2.log("VerifiedSettlement deployed at:", address(v));
    }
}
