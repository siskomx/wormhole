import { describe, expect, it } from "vitest";
import { assertAllowedHttpUrl, isPrivateAddress } from "../src/network-guard.js";

describe("network guard", () => {
  it("classifies local and private addresses", () => {
    expect(isPrivateAddress("localhost")).toBe(true);
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.0.0.5")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
  });

  it("blocks private and non-http URLs while allowing public http targets", async () => {
    await expect(assertAllowedHttpUrl("file:///tmp/example")).rejects.toThrow(/Unsupported URL protocol/);
    await expect(assertAllowedHttpUrl("http://127.0.0.1:3000")).rejects.toThrow(/Private network URL/);
    await expect(assertAllowedHttpUrl("https://93.184.216.34")).resolves.toBeInstanceOf(URL);
  });
});
