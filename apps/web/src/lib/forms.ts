import type { FieldValues, Resolver } from 'react-hook-form';
import { ApiRequestError } from './api';

/** Forms hold '' for an untouched optional field; the API wants null. */
export function blankToNull<T extends Record<string, unknown>>(values: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] = typeof value === 'string' && value.trim() === '' ? null : value;
  }
  return out as T;
}

/**
 * Pulls field-level messages out of an API error so a form can show them under
 * the right input. Returns the leftover message when nothing mapped.
 */
export function mapApiErrorToFields(error: unknown): {
  fields: Record<string, string>;
  message: string | null;
} {
  if (!(error instanceof ApiRequestError)) {
    return { fields: {}, message: 'Could not save. Try again.' };
  }
  const fields = { ...error.fieldErrors };
  const details = error.details as { field?: string } | undefined;
  if (details && typeof details === 'object' && typeof details.field === 'string') {
    fields[details.field] = error.message;
  }
  return { fields, message: Object.keys(fields).length > 0 ? null : error.message };
}

/**
 * Wraps a zod resolver so an untouched *optional* field ('' from an input or an
 * empty <select>) reaches validation as null. Without it, `.optional().nullable()`
 * ids reject '' and the form blocks on a field the user never had to fill.
 *
 * Only the named keys are converted: a required field left blank must keep its
 * own "required" message rather than becoming a type error about null.
 */
export function blankAsNull<T extends FieldValues>(
  resolver: Resolver<T>,
  optionalKeys: string[],
): Resolver<T> {
  return (values, context, options) => {
    const next: Record<string, unknown> = { ...values };
    for (const key of optionalKeys) {
      if (typeof next[key] === 'string' && (next[key] as string).trim() === '') next[key] = null;
    }
    return resolver(next as T, context, options);
  };
}
