import { describe, expect, it } from 'vitest';
import { awaitingLabel, formatDays, formatRange, toneForType } from './useLeave';

describe('formatRange', () => {
  it('shows one day on its own', () => {
    expect(formatRange('2026-10-02', '2026-10-02')).toBe('02 Oct');
  });
  it('collapses a range within a month', () => {
    expect(formatRange('2026-10-19', '2026-10-21')).toBe('19–21 Oct');
  });
  it('spells out a range across months', () => {
    expect(formatRange('2026-10-30', '2026-11-02')).toBe('30 Oct – 02 Nov');
  });
});

describe('formatDays', () => {
  it('pluralises and keeps halves', () => {
    expect(formatDays(1)).toBe('1 day');
    expect(formatDays(3)).toBe('3 days');
    expect(formatDays(0.5)).toBe('0.5 days');
    expect(formatDays(2.5)).toBe('2.5 days');
  });
});

describe('awaitingLabel', () => {
  it('says nothing once decided', () => {
    expect(
      awaitingLabel({ status: 'APPROVED', flow: 'SINGLE_LEVEL', awaitingLevel: null }),
    ).toBeNull();
  });
  it('names the level on a two-level request', () => {
    expect(
      awaitingLabel({ status: 'PENDING', flow: 'TEAM_LEAD_THEN_MANAGER', awaitingLevel: 1 }),
    ).toMatch(/1\/2/);
    expect(
      awaitingLabel({ status: 'PENDING', flow: 'TEAM_LEAD_THEN_MANAGER', awaitingLevel: 2 }),
    ).toMatch(/2\/2/);
  });
  it('is plain for a single level', () => {
    expect(awaitingLabel({ status: 'PENDING', flow: 'SINGLE_LEVEL', awaitingLevel: 1 })).toBe(
      'Awaiting approval',
    );
  });
});

describe('toneForType', () => {
  it('maps the type colours onto the pill tones', () => {
    expect(toneForType('cyan')).toBe('blue');
    expect(toneForType('red')).toBe('red');
    expect(toneForType(null)).toBe('gray');
  });
});
