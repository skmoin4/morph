import { describe, expect, it } from 'vitest';
import { describeRate, formatHoursPlain, formatSigned, levelTone } from './useCost';

describe('formatSigned', () => {
  it('shows a true minus for reversals and rupee grouping', () => {
    expect(formatSigned('20000.00')).toBe('₹ 20,000');
    expect(formatSigned('-4000.00')).toBe('−₹ 4,000');
    expect(formatSigned('1250.50')).toBe('₹ 1,250.50');
    expect(formatSigned('0')).toBe('₹ 0');
  });
});

describe('formatHoursPlain', () => {
  it('groups in the Indian style and trims zeros', () => {
    expect(formatHoursPlain(2734)).toBe('2,734 h');
    expect(formatHoursPlain(40.5)).toBe('40.5 h');
  });
});

describe('levelTone', () => {
  it('maps the alert level to a tone', () => {
    expect(levelTone(0)).toBe('good');
    expect(levelTone(80)).toBe('warn');
    expect(levelTone(100)).toBe('bad');
  });
});

describe('describeRate', () => {
  it('explains one segment, and a rate change across two', () => {
    expect(
      describeRate({
        hours: 8,
        rateApplied: 500,
        rateBreakdown: [
          {
            from: '2026-09-28',
            to: '2026-09-28',
            hours: '8.00',
            rate: '500.00',
            amount: '4000.00',
          },
        ],
      }),
    ).toBe('2026-09-28: 8 h × ₹500 = ₹4,000');
    const two = describeRate({
      hours: 16,
      rateApplied: null,
      rateBreakdown: [
        {
          from: '2026-09-28',
          to: '2026-09-30',
          hours: '24.00',
          rate: '500.00',
          amount: '12000.00',
        },
        { from: '2026-10-01', to: '2026-10-01', hours: '8.00', rate: '600.00', amount: '4800.00' },
      ],
    });
    expect(two).toContain('2026-09-28 to 2026-09-30: 24 h × ₹500');
    expect(two).toContain('₹600');
  });
  it('says nothing when there is no breakdown', () => {
    expect(describeRate({ hours: null, rateApplied: null, rateBreakdown: null })).toBeNull();
  });
});
