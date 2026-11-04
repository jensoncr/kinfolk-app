const usdFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency",
});

export function formatCurrency(value: number): string {
  return usdFormatter.format(value);
}
