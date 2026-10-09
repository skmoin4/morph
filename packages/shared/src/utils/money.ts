import { Decimal } from 'decimal.js';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type MoneyLike = string | number | Decimal;

export function money(v: MoneyLike): Decimal {
  return new Decimal(v ?? 0);
}

/** Always serialise money as a 2-dp string — never a float. */
export function toMoneyString(v: MoneyLike): string {
  return money(v).toFixed(2);
}

export function addMoney(...values: MoneyLike[]): string {
  return values.reduce((acc: Decimal, v) => acc.plus(money(v)), new Decimal(0)).toFixed(2);
}

/** hours × rate, rounded to 2 dp — the one way cost is ever computed. */
export function hoursTimesRate(hours: MoneyLike, rate: MoneyLike): string {
  return money(hours).times(money(rate)).toFixed(2);
}

export function marginPercent(value: MoneyLike, cost: MoneyLike): string {
  const v = money(value);
  if (v.isZero()) return '0.00';
  return v.minus(money(cost)).dividedBy(v).times(100).toFixed(2);
}

/** Indian grouping: 1050000 -> "10,50,000" */
export function formatIndianNumber(v: MoneyLike, decimals = 0): string {
  const d = money(v);
  const negative = d.isNegative();
  const fixed = d.abs().toFixed(decimals);
  const [whole, frac] = fixed.split('.');
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${negative ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

export function formatCurrency(v: MoneyLike, currency = '₹', decimals = 0): string {
  return `${currency} ${formatIndianNumber(v, decimals)}`;
}

/** Dashboard short form: 1050000 -> "10.5 L", 32500000 -> "3.25 Cr" */
export function formatShortIndian(v: MoneyLike): string {
  const d = money(v);
  const abs = d.abs();
  const sign = d.isNegative() ? '-' : '';
  if (abs.gte(10_000_000)) return `${sign}${abs.dividedBy(10_000_000).toFixed(2)} Cr`;
  if (abs.gte(100_000)) return `${sign}${abs.dividedBy(100_000).toFixed(2)} L`;
  if (abs.gte(1_000)) return `${sign}${abs.dividedBy(1_000).toFixed(1)} K`;
  return `${sign}${abs.toFixed(0)}`;
}

export function formatCurrencyShort(v: MoneyLike, currency = '₹'): string {
  return `${currency} ${formatShortIndian(v)}`;
}
