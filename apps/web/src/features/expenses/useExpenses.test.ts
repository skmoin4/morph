import { describe, expect, it } from 'vitest';
import { formatFileSize, formatRupees, parseAmountInput } from './useExpenses';

describe('parseAmountInput', () => {
  it('reads plain, comma and rupee-sign amounts', () => {
    expect(parseAmountInput('1250')).toBe('1250.00');
    expect(parseAmountInput('1,250.5')).toBe('1250.50');
    expect(parseAmountInput('₹ 27,500')).toBe('27500.00');
    expect(parseAmountInput('0.99')).toBe('0.99');
  });
  it('refuses nonsense, zero and too many decimals', () => {
    expect(parseAmountInput('')).toBeNull();
    expect(parseAmountInput('abc')).toBeNull();
    expect(parseAmountInput('0')).toBeNull();
    expect(parseAmountInput('-5')).toBeNull();
    expect(parseAmountInput('12.345')).toBeNull();
    expect(parseAmountInput('1.2.3')).toBeNull();
  });
});

describe('formatRupees', () => {
  it('groups in the Indian style, with paise only when present', () => {
    expect(formatRupees('27500.00')).toBe('₹ 27,500');
    expect(formatRupees('1250000')).toBe('₹ 12,50,000');
    expect(formatRupees('300.50')).toBe('₹ 300.50');
  });
});

describe('formatFileSize', () => {
  it('uses sensible units', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
