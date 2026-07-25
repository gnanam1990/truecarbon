import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Wallet } from "ethers";
import { MockOracle } from "../oracle.ts";

describe("MockOracle", () => {
  it("address is derived from the signer key", () => {
    const pk = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const o = new MockOracle("0x0000000000000000000000000000000000000001", "http://localhost:1", pk);
    assert.equal(o.address, new Wallet(pk).address);
  });
});
