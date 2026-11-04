export function calculateEffectiveMonthlyRent(
  monthlyRent: number | null,
  concessionMonths = 0,
  leaseTermMonths = 12,
) {
  if (monthlyRent == null || !Number.isFinite(monthlyRent) || monthlyRent <= 0) {
    return null;
  }

  const safeLeaseTerm = Number.isFinite(leaseTermMonths) && leaseTermMonths > 0 ? leaseTermMonths : 12;
  const safeConcession = Number.isFinite(concessionMonths)
    ? Math.max(0, Math.min(concessionMonths, safeLeaseTerm))
    : 0;

  return Math.max(0, Math.round((monthlyRent * (safeLeaseTerm - safeConcession)) / safeLeaseTerm));
}
