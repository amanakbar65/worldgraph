/**
 * How key numbers and their changes are written, shared by the KPI tile and
 * the compare table so both always say the same.
 */

/**
 * Digits that suit the size of the number: 81.24, 412.6, 1,284, 1.4M, and
 * three significant digits below 1 (0.752, 0.002), so small values and
 * small changes keep their meaning instead of rounding to 0.
 */
export function formatKpiNumber(value: number, locale?: string): string {
  const abs = Math.abs(value);
  if (abs >= 100_000) {
    return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
  }
  if (abs > 0 && abs < 1) return new Intl.NumberFormat(locale, { maximumSignificantDigits: 3 }).format(value);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : 2;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
}

/**
 * The change as it is shown: 0 when it is too small to be real next to the
 * value (rounding noise, a millionth of it or less), so it reads "unchanged"
 * with no ▲/▼ and no risk or opportunity colour.
 */
export function shownChange(change: number | null, latest?: number): number | null {
  if (change === null) return null;
  return Math.abs(change) <= Math.max(Math.abs(latest ?? 0), 1) * 1e-6 ? 0 : change;
}
