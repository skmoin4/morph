/**
 * Budget rules, pure so the posting hooks, the screens and the tests agree.
 *
 * The budget a project has is its **hours** (`budgetHours`); the cost side has
 * no separate budget, only the contract value and the margin it implies. So a
 * budget alert is about hours burned, counted from *approved* time only —
 * the same hours that have posted to the ledger.
 *
 *  - Alerts fire when the burn first reaches 80 % and again at 100 %.
 *  - A project that jumps straight past 80 % to 100 % gets the 100 % alert only.
 *  - The level is remembered on the project, so a later posting at the same
 *    level says nothing; if corrections bring the burn back below a threshold,
 *    the level drops with it, and crossing again alerts again.
 */
export type AlertLevel = 0 | 80 | 100;
export type HealthValue = 'HEALTHY' | 'AT_RISK' | 'CRITICAL';

export const ALERT_AT_WARNING = 80;
export const ALERT_AT_LIMIT = 100;

/** Percent of the hours budget used, to one decimal; null when there is no budget. */
export function burnPercent(actualHours: number, budgetHours: number): number | null {
  if (!(budgetHours > 0)) return null;
  return Math.round((actualHours / budgetHours) * 1000) / 10;
}

export function alertLevelFor(percent: number | null): AlertLevel {
  if (percent === null) return 0;
  if (percent >= ALERT_AT_LIMIT) return 100;
  if (percent >= ALERT_AT_WARNING) return 80;
  return 0;
}

export function healthForLevel(level: AlertLevel): HealthValue {
  return level === 100 ? 'CRITICAL' : level === 80 ? 'AT_RISK' : 'HEALTHY';
}

const SEVERITY: Record<HealthValue, number> = { HEALTHY: 0, AT_RISK: 1, CRITICAL: 2 };

export interface AlertPlan {
  /** The level the project is at now. */
  level: AlertLevel;
  /** The threshold to tell people about, when one was just crossed upwards. */
  notify: 80 | 100 | null;
  /** The health to store. */
  health: HealthValue;
}

/**
 * What to do when a project's hours change.
 *
 * Health follows the alert level but never overrides a worse state a person set
 * by hand: going up takes the worse of the two; coming back down only clears a
 * health that the previous level had set.
 */
export function planAlert(args: {
  previousLevel: number;
  percent: number | null;
  currentHealth: HealthValue;
}): AlertPlan {
  const previous: AlertLevel = args.previousLevel >= 100 ? 100 : args.previousLevel >= 80 ? 80 : 0;
  const level = alertLevelFor(args.percent);
  const derived = healthForLevel(level);

  let health = args.currentHealth;
  if (level > previous) {
    health = SEVERITY[derived] > SEVERITY[health] ? derived : health;
  } else if (level < previous && health === healthForLevel(previous)) {
    health = derived;
  }
  return { level, notify: level > previous ? (level as 80 | 100) : null, health };
}
