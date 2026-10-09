import { describe, expect, it } from 'vitest';
import {
  addMoney,
  formatCurrencyShort,
  formatIndianNumber,
  formatShortIndian,
  hoursTimesRate,
  marginPercent,
  toMoneyString,
} from './money';
import {
  addDays,
  distanceMetres,
  endOfWeek,
  exclusiveEndToInclusive,
  formatExclusiveEndInclusive,
  financialYearLabel,
  formatDisplayDate,
  startOfWeek,
  toOfficeDateString,
} from './date';

describe('money', () => {
  it('keeps two decimal places without float drift', () => {
    expect(toMoneyString('0.1')).toBe('0.10');
    expect(addMoney('0.1', '0.2')).toBe('0.30');
    expect(addMoney('1050000', '0.005')).toBe('1050000.01');
  });

  it('computes hours x rate the way the cost ledger does', () => {
    expect(hoursTimesRate('7.5', '850.00')).toBe('6375.00');
    expect(hoursTimesRate('0', '850.00')).toBe('0.00');
  });

  it('computes margin percent and survives a zero project value', () => {
    expect(marginPercent('1000000', '750000')).toBe('25.00');
    expect(marginPercent('0', '5000')).toBe('0.00');
  });

  it('groups numbers the Indian way', () => {
    expect(formatIndianNumber('1050000')).toBe('10,50,000');
    expect(formatIndianNumber('999')).toBe('999');
    expect(formatIndianNumber('-1050000')).toBe('-10,50,000');
  });

  it('shortens large numbers for dashboards', () => {
    expect(formatShortIndian('1050000')).toBe('10.50 L');
    expect(formatShortIndian('32500000')).toBe('3.25 Cr');
    expect(formatCurrencyShort('1050000')).toBe('₹ 10.50 L');
  });
});

describe('dates', () => {
  it('reads the office-local date for an instant', () => {
    // 18:45 UTC is already the next day in Kolkata (+5:30).
    const instant = new Date('2026-10-05T18:45:00Z');
    expect(toOfficeDateString(instant, 'Asia/Kolkata')).toBe('2026-10-06');
    expect(toOfficeDateString(instant, 'Asia/Riyadh')).toBe('2026-10-05');
  });

  it('puts timesheet weeks on a Monday', () => {
    expect(startOfWeek('2026-10-06')).toBe('2026-10-05'); // Tuesday -> Monday
    expect(startOfWeek('2026-10-05')).toBe('2026-10-05');
    expect(startOfWeek('2026-10-11')).toBe('2026-10-05'); // Sunday -> same week
    expect(endOfWeek('2026-10-06')).toBe('2026-10-11');
  });

  it('labels the financial year from the start month', () => {
    expect(financialYearLabel('2026-10-06', 4)).toBe('26-27');
    expect(financialYearLabel('2026-03-31', 4)).toBe('25-26');
    expect(financialYearLabel('2026-04-01', 4)).toBe('26-27');
  });

  it('formats dates for display', () => {
    expect(formatDisplayDate('2026-10-04')).toBe('04 Oct 2026');
  });

  it('measures geofence distance', () => {
    const office = { lat: 21.1458, lng: 79.0882 }; // Nagpur
    expect(distanceMetres(office, office)).toBe(0);
    // ~0.001 degrees of latitude is a little over 100 m.
    expect(distanceMetres(office, { lat: 21.1468, lng: 79.0882 })).toBeGreaterThan(100);
    expect(distanceMetres(office, { lat: 21.1468, lng: 79.0882 })).toBeLessThan(120);
  });
});

describe('effective-dated display', () => {
  it('shows an exclusive end date as the last day the row applied', () => {
    // Stored as the day the next rate starts; a user reads "to 30 Sep".
    expect(formatExclusiveEndInclusive('2026-10-01')).toBe('30 Sep 2026');
    expect(formatExclusiveEndInclusive('2026-10-01T00:00:00.000Z')).toBe('30 Sep 2026');
    expect(formatExclusiveEndInclusive(new Date('2026-10-01T00:00:00.000Z'))).toBe('30 Sep 2026');
  });

  it('steps back across a month and a year boundary', () => {
    expect(formatExclusiveEndInclusive('2026-03-01')).toBe('28 Feb 2026');
    expect(formatExclusiveEndInclusive('2027-01-01')).toBe('31 Dec 2026');
    // 2028 is a leap year.
    expect(formatExclusiveEndInclusive('2028-03-01')).toBe('29 Feb 2028');
  });

  it('returns null for an open-ended row', () => {
    expect(formatExclusiveEndInclusive(null)).toBeNull();
    expect(formatExclusiveEndInclusive(undefined)).toBeNull();
    expect(formatExclusiveEndInclusive('')).toBeNull();
  });

  it('leaves a contiguous chain with no visible gap or overlap', () => {
    // Stored: [2021-11-01, 2026-10-01) then [2026-10-01, null)
    const first = { from: '2021-11-01', to: '2026-10-01' };
    const second = { from: '2026-10-01', to: null };

    expect(formatExclusiveEndInclusive(first.to)).toBe('30 Sep 2026');
    expect(formatDisplayDate(second.from)).toBe('01 Oct 2026');
    // The displayed end is the day before the next start: adjacent, not equal.
    expect(exclusiveEndToInclusive(first.to)).toBe('2026-09-30');
    expect(addDays(exclusiveEndToInclusive(first.to), 1)).toBe(second.from);
  });
});
