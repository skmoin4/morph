import { describe, expect, it } from 'vitest';
import { formatMinutes, STATUS_LABEL, timeIn } from './useAttendance';
import { CELL_STYLE } from './badges';

describe('formatMinutes', () => {
  it('writes hours and zero-padded minutes', () => {
    expect(formatMinutes(487)).toBe('8h 07m');
    expect(formatMinutes(0)).toBe('0h 00m');
    expect(formatMinutes(60)).toBe('1h 00m');
  });

  it('never goes negative', () => {
    expect(formatMinutes(-30)).toBe('0h 00m');
  });
});

describe('timeIn', () => {
  it('shows an instant on the office clock, not the viewer’s', () => {
    // 03:58Z is 09:28 in India and 06:58 in Riyadh.
    expect(timeIn('2026-10-05T03:58:00.000Z', 'Asia/Kolkata')).toBe('09:28');
    expect(timeIn('2026-10-05T03:58:00.000Z', 'Asia/Riyadh')).toBe('06:58');
  });

  it('shows a dash for nothing', () => {
    expect(timeIn(null, 'Asia/Kolkata')).toBe('—');
    expect(timeIn(undefined, 'Asia/Kolkata')).toBe('—');
  });
});

describe('status vocabulary', () => {
  it('has a label and a register code for every status', () => {
    for (const status of Object.keys(STATUS_LABEL) as Array<keyof typeof STATUS_LABEL>) {
      expect(STATUS_LABEL[status]).toBeTruthy();
      expect(CELL_STYLE[status].code).toBeDefined();
    }
  });
});
