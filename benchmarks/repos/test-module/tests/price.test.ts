import { describe, expect, it } from "vitest";
import { calculatePrice } from "../src/price";

describe("calculatePrice", () => {
  it("applies tax", () => {
    expect(calculatePrice({ subtotal: 10, taxRate: 0.1 })).toBe(11);
  });
});
