import { describe, expect, it } from 'vitest';
import { alertLevelFor, burnPercent, healthForLevel, planAlert, type HealthValue } from './rules';

describe('burnPercent', () => {
  it('is hours used over hours budgeted, to one decimal', () => {
    expect(burnPercent(80, 100)).toBe(80);
    expect(burnPercent(2734, 2800)).toBe(97.6);
    expect(burnPercent(0, 100)).toBe(0);
  });
  it('can go past 100', () => {
    expect(burnPercent(150, 100)).toBe(150);
  });
  it('has no opinion without a budget', () => {
    expect(burnPercent(10, 0)).toBeNull();
    expect(burnPercent(10, -5)).toBeNull();
  });
});

describe('alertLevelFor', () => {
  it('has thresholds at 80 and 100, inclusive', () => {
    expect(alertLevelFor(79.9)).toBe(0);
    expect(alertLevelFor(80)).toBe(80);
    expect(alertLevelFor(99.9)).toBe(80);
    expect(alertLevelFor(100)).toBe(100);
    expect(alertLevelFor(250)).toBe(100);
    expect(alertLevelFor(null)).toBe(0);
  });
});

describe('planAlert', () => {
  const plan = (previousLevel: number, percent: number | null, currentHealth: HealthValue = 'HEALTHY') =>
    planAlert({ previousLevel, percent, currentHealth });

  it('stays quiet while under 80', () => {
    expect(plan(0, 40)).toEqual({ level: 0, notify: null, health: 'HEALTHY' });
  });
  it('alerts on first reaching 80, and marks the project at risk', () => {
    expect(plan(0, 82)).toEqual({ level: 80, notify: 80, health: 'AT_RISK' });
  });
  it('does not repeat itself at the same level', () => {
    expect(plan(80, 90, 'AT_RISK')).toEqual({ level: 80, notify: null, health: 'AT_RISK' });
    expect(plan(100, 130, 'CRITICAL')).toEqual({ level: 100, notify: null, health: 'CRITICAL' });
  });
  it('alerts again on reaching 100', () => {
    expect(plan(80, 101, 'AT_RISK')).toEqual({ level: 100, notify: 100, health: 'CRITICAL' });
  });
  it('a jump straight past 80 gives the 100 alert only', () => {
    expect(plan(0, 120)).toEqual({ level: 100, notify: 100, health: 'CRITICAL' });
  });
  it('drops the level when corrections bring the burn back down, and clears the health it set', () => {
    expect(plan(100, 85, 'CRITICAL')).toEqual({ level: 80, notify: null, health: 'AT_RISK' });
    expect(plan(80, 60, 'AT_RISK')).toEqual({ level: 0, notify: null, health: 'HEALTHY' });
  });
  it('alerts again after a drop and a second crossing', () => {
    const down = plan(100, 70, 'CRITICAL');
    expect(down.level).toBe(0);
    expect(plan(down.level, 105, down.health).notify).toBe(100);
  });
  it('never overrides a worse health someone set by hand', () => {
    expect(plan(0, 85, 'CRITICAL')).toEqual({ level: 80, notify: 80, health: 'CRITICAL' });
  });
  it('does not clear a health a person set that the level did not', () => {
    expect(plan(80, 60, 'CRITICAL').health).toBe('CRITICAL');
  });
  it('treats a project with no budget as quiet', () => {
    expect(plan(0, null)).toEqual({ level: 0, notify: null, health: 'HEALTHY' });
  });
  it('maps levels to health', () => {
    expect(healthForLevel(0)).toBe('HEALTHY');
    expect(healthForLevel(80)).toBe('AT_RISK');
    expect(healthForLevel(100)).toBe('CRITICAL');
  });
});
