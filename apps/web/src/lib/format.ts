import {
  formatCurrency,
  formatCurrencyShort,
  formatDisplayDate,
  formatIndianNumber,
  formatShortIndian,
} from '@opsvera/shared';

/**
 * Display helpers, re-exported from the shared package so the API and the web
 * app format money and dates identically.
 */
export {
  formatCurrency,
  formatCurrencyShort,
  formatDisplayDate,
  formatIndianNumber,
  formatShortIndian,
};

/** "7.50" -> "7h 30m" */
export function formatHours(hours: string | number): string {
  const value = Number(hours);
  const whole = Math.floor(Math.abs(value));
  const minutes = Math.round((Math.abs(value) - whole) * 60);
  const sign = value < 0 ? '-' : '';
  return minutes === 0 ? `${sign}${whole}h` : `${sign}${whole}h ${minutes}m`;
}

/** Seconds -> "01:23:45", for the running timer. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** "Rajesh Deshmukh" -> "RD" */
export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
