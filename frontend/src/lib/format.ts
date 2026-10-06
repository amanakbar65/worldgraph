/**
 * Number formatting that follows the viewer's own locale.
 * An Indian browser (en-IN) gets lakh/crore grouping; others get
 * thousand/million. Money stays in its own currency; we never convert.
 */

/** Short form for big numbers: 1.2M, 12L, 3.4K… */
export function formatCompact(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/** A money amount in its own currency, e.g. ₹95.40 or $81.20. */
export function formatMoney(
  value: number,
  currency: string,
  locale?: string,
  options: { compact?: boolean } = {},
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    notation: options.compact ? "compact" : "standard",
    maximumFractionDigits: options.compact ? 1 : 2,
  }).format(value);
}

/** A probability (0–1) as a whole percentage, e.g. 0.623 → "62%". */
export function formatProbability(p: number): string {
  const clamped = Math.min(1, Math.max(0, p));
  return `${Math.round(clamped * 100)}%`;
}

/**
 * A change in percentage points with an arrow, e.g. +0.08 → "▲ 8".
 * Arrows always accompany colour, so meaning never depends on colour alone.
 */
export function formatPointChange(delta: number): string {
  const points = Math.round(delta * 100);
  if (points === 0) return "• 0";
  return `${points > 0 ? "▲" : "▼"} ${Math.abs(points)}`;
}
