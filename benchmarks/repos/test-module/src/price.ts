export function calculatePrice(input: {
  subtotal: number;
  discountPercent?: number;
  taxRate: number;
}): number {
  if (input.subtotal < 0 || input.taxRate < 0) {
    throw new Error("Invalid price input");
  }

  const discount = input.discountPercent ? input.subtotal * input.discountPercent : 0;
  const taxable = input.subtotal - discount;
  return Math.round(taxable * (1 + input.taxRate) * 100) / 100;
}
