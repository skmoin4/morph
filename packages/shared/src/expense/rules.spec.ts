import { describe, expect, it } from 'vitest';
import {
  checkLimits,
  expenseEditable,
  expenseWindowStart,
  looksLikePdf,
  looksLikeReceipt,
  monthRangeOf,
} from './rules';

describe('checkLimits', () => {
  it('passes a claim inside both limits', () => {
    expect(
      checkLimits({ amount: 4000, perClaimLimit: 5000, perMonthLimit: 10000, monthSoFar: 2000 }),
    ).toEqual({ exceededClaim: false, exceededMonth: false, messages: [] });
  });
  it('treats the limit itself as allowed', () => {
    expect(
      checkLimits({ amount: 5000, perClaimLimit: 5000, perMonthLimit: null, monthSoFar: 0 })
        .exceededClaim,
    ).toBe(false);
  });
  it('flags a claim over the per-claim limit, in rupees', () => {
    const r = checkLimits({ amount: 27500, perClaimLimit: 25000, perMonthLimit: null, monthSoFar: 0 });
    expect(r.exceededClaim).toBe(true);
    expect(r.messages[0]).toMatch(/₹25,000 per-claim/);
  });
  it('flags a month that goes over, counting what is already claimed', () => {
    const r = checkLimits({ amount: 3000, perClaimLimit: null, perMonthLimit: 10000, monthSoFar: 8000 });
    expect(r.exceededMonth).toBe(true);
    expect(r.messages[0]).toMatch(/₹11,000/);
  });
  it('flags both at once, and says both', () => {
    const r = checkLimits({ amount: 9000, perClaimLimit: 5000, perMonthLimit: 10000, monthSoFar: 5000 });
    expect(r.messages).toHaveLength(2);
  });
  it('has no opinion when a category has no limits', () => {
    expect(
      checkLimits({ amount: 1e6, perClaimLimit: null, perMonthLimit: null, monthSoFar: 1e6 }).messages,
    ).toEqual([]);
  });
  it('does not drift on pennies', () => {
    const r = checkLimits({ amount: 0.1, perClaimLimit: null, perMonthLimit: 0.3, monthSoFar: 0.2 });
    expect(r.exceededMonth).toBe(false);
  });
});

describe('expenseEditable', () => {
  it('lets only a draft or a rejected claim be changed', () => {
    expect(expenseEditable('DRAFT')).toBe(true);
    expect(expenseEditable('REJECTED')).toBe(true);
    expect(expenseEditable('PENDING_MANAGER')).toBe(false);
    expect(expenseEditable('PENDING_FINANCE')).toBe(false);
    expect(expenseEditable('APPROVED')).toBe(false);
  });
});

describe('receipts', () => {
  const pdf = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const exe = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00]);
  it('accepts a PDF and common photos by their first bytes', () => {
    expect(looksLikePdf(pdf)).toBe(true);
    expect(looksLikeReceipt(pdf)).toBe(true);
    expect(looksLikeReceipt(jpeg)).toBe(true);
  });
  it('refuses anything else, whatever it is named', () => {
    expect(looksLikeReceipt(exe)).toBe(false);
    expect(looksLikeReceipt(new Uint8Array())).toBe(false);
  });
});

describe('dates', () => {
  it('finds the 90-day window', () => {
    expect(expenseWindowStart('2026-10-09')).toBe('2026-07-11');
  });
  it('finds a month, including a leap February', () => {
    expect(monthRangeOf('2026-10-09')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthRangeOf('2028-02-15')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});
