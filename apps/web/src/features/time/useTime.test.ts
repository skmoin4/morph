import { describe, expect, it } from 'vitest';
import { addDaysIso, formatCell, formatHoursMinutes, parseHoursInput, weekLabel } from './useTime';

describe('parseHoursInput', () => {
  it('reads plain and decimal hours', () => {
    expect(parseHoursInput('8')).toBe(8);
    expect(parseHoursInput('7.5')).toBe(7.5);
    expect(parseHoursInput('7,5')).toBe(7.5);
    expect(parseHoursInput('2h')).toBe(2);
  });
  it('reads h:mm and minutes', () => {
    expect(parseHoursInput('1:30')).toBe(1.5);
    expect(parseHoursInput('0:45')).toBe(0.75);
    expect(parseHoursInput('90m')).toBe(1.5);
    expect(parseHoursInput('45 min')).toBe(0.75);
  });
  it('treats blank as zero, which clears the cell', () => {
    expect(parseHoursInput('')).toBe(0);
    expect(parseHoursInput('   ')).toBe(0);
  });
  it('refuses what is not a time', () => {
    expect(parseHoursInput('abc')).toBeNull();
    expect(parseHoursInput('1:75')).toBeNull();
    expect(parseHoursInput('-2')).toBeNull();
    expect(parseHoursInput('1.2.3')).toBeNull();
  });
});

describe('formatting', () => {
  it('shows hours and minutes', () => {
    expect(formatHoursMinutes(7.5)).toBe('7h 30m');
    expect(formatHoursMinutes(8)).toBe('8h');
    expect(formatHoursMinutes(0.33)).toBe('20m');
    expect(formatHoursMinutes(1.33)).toBe('1h 20m');
  });
  it('shows a cell without trailing zeros', () => {
    expect(formatCell(0)).toBe('');
    expect(formatCell(8)).toBe('8');
    expect(formatCell(1.5)).toBe('1.5');
    expect(formatCell(1.333)).toBe('1.33');
  });
  it('labels a week, with or without a month change', () => {
    expect(weekLabel('2026-10-05', '2026-10-11')).toBe('05–11 Oct 2026');
    expect(weekLabel('2026-09-28', '2026-10-04')).toBe('28 Sep – 04 Oct 2026');
  });
  it('moves dates across month ends', () => {
    expect(addDaysIso('2026-09-28', 7)).toBe('2026-10-05');
    expect(addDaysIso('2026-10-05', -7)).toBe('2026-09-28');
  });
});
