import { financialYearLabel } from './date';

export const DEFAULT_PROJECT_CODE_PATTERN = '{PREFIX}-{FY}-{TYPE}-{SEQ4}';

export interface ProjectCodeParts {
  /** Company code prefix, e.g. "MOR". */
  prefix: string;
  /** Financial year label, e.g. "26-27". */
  fy: string;
  /** Project type short code, e.g. "HOS". */
  type: string;
  /** Next sequence number for the company + financial year. */
  sequence: number;
}

/**
 * Renders a project code from the company's configured pattern.
 *
 * Supported tokens:
 *   {PREFIX}  company code prefix
 *   {FY}      financial year label
 *   {TYPE}    project type short code
 *   {SEQ}     sequence, unpadded
 *   {SEQn}    sequence, zero-padded to n digits (SEQ3..SEQ6)
 *
 * This is the only place a code is assembled, so the booking service and the
 * seeder cannot drift apart.
 */
export function buildProjectCode(pattern: string, parts: ProjectCodeParts): string {
  const { prefix, fy, type, sequence } = parts;

  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`Project code sequence must be a positive integer, got ${sequence}`);
  }

  const code = pattern
    .replace(/\{PREFIX\}/g, prefix.trim().toUpperCase())
    .replace(/\{FY\}/g, fy.trim())
    .replace(/\{TYPE\}/g, type.trim().toUpperCase())
    .replace(/\{SEQ(\d)\}/g, (_m, width: string) => String(sequence).padStart(Number(width), '0'))
    .replace(/\{SEQ\}/g, String(sequence));

  const leftover = code.match(/\{[A-Z0-9]+\}/);
  if (leftover) {
    throw new Error(`Unknown token ${leftover[0]} in project code pattern "${pattern}"`);
  }

  return code;
}

/** Convenience wrapper that derives the FY label from the booking date. */
export function buildProjectCodeForDate(
  pattern: string,
  opts: {
    prefix: string;
    type: string;
    sequence: number;
    date: string;
    fyStartMonth: number;
  },
): string {
  return buildProjectCode(pattern, {
    prefix: opts.prefix,
    fy: financialYearLabel(opts.date, opts.fyStartMonth),
    type: opts.type,
    sequence: opts.sequence,
  });
}
