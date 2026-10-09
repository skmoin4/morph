import type { AuthenticatedUser } from '../types/authenticated-user';

/**
 * Field-level masking.
 *
 * Salary, cost rate, project value and margin are stripped from responses
 * unless the user holds the matching permission. This runs on the way out, so
 * a field cannot leak because one endpoint forgot to narrow its `select`.
 *
 * Each entry maps a response field name to the permission that reveals it.
 */
const FIELD_PERMISSIONS: Record<string, string> = {
  // Salary
  monthlyAmount: 'salary.view',
  monthlySalary: 'salary.view',
  salary: 'salary.view',
  salaries: 'salary.view',

  // Employee cost rate
  hourlyRate: 'cost.view',
  costRate: 'cost.view',
  costRates: 'cost.view',
  rateApplied: 'cost.view',

  // Cost amounts
  actualLabourCost: 'cost.view',
  actualExpenseCost: 'cost.view',
  actualTotalCost: 'cost.view',
  costToDate: 'cost.view',

  // Commercials
  projectValue: 'project.value.view',

  // Derived margin
  margin: 'margin.view',
  marginAmount: 'margin.view',
  marginPercent: 'margin.view',
};

export const MASKED_FIELD_NAMES = Object.keys(FIELD_PERMISSIONS);

/** Fields this user is not allowed to see. */
export function forbiddenFieldsFor(user: AuthenticatedUser): Set<string> {
  const forbidden = new Set<string>();
  for (const [field, permission] of Object.entries(FIELD_PERMISSIONS)) {
    if (!user.permissions.has(permission)) forbidden.add(field);
  }
  return forbidden;
}

/**
 * Removes forbidden fields from a response payload, at any depth.
 *
 * The field is deleted rather than nulled: a null would be indistinguishable
 * from "no rate set yet", and the frontend would render ₹0 instead of hiding
 * the column.
 */
export function maskSensitiveFields<T>(payload: T, forbidden: Set<string>): T {
  if (forbidden.size === 0) return payload;
  return walk(payload, forbidden, 0) as T;
}

const MAX_DEPTH = 12;

function walk(value: unknown, forbidden: Set<string>, depth: number): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, forbidden, depth + 1));
  }

  // Dates, Decimals and Buffers are values, not structures to descend into.
  if (
    value instanceof Date ||
    value instanceof Buffer ||
    typeof (value as { toFixed?: unknown }).toFixed === 'function'
  ) {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbidden.has(key)) continue;
    out[key] = walk(child, forbidden, depth + 1);
  }
  return out;
}
