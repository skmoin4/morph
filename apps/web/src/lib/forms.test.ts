import { describe, expect, it, vi } from 'vitest';
import type { Resolver } from 'react-hook-form';
import { ApiRequestError } from './api';
import { blankAsNull, blankToNull, mapApiErrorToFields } from './forms';

describe('blankToNull', () => {
  it('turns untouched text into null and leaves real values alone', () => {
    expect(blankToNull({ a: '', b: '  ', c: 'x', d: 0, e: false })).toEqual({
      a: null,
      b: null,
      c: 'x',
      d: 0,
      e: false,
    });
  });
});

describe('blankAsNull', () => {
  it('nulls only the named optional keys before validating', async () => {
    const inner = vi.fn(async (values: Record<string, unknown>) => ({ values, errors: {} }));
    const wrapped = blankAsNull(inner as unknown as Resolver<Record<string, unknown>>, [
      'contactId',
    ]);

    await wrapped({ contactId: '', projectName: '' }, undefined, {} as never);

    // The optional field is null; the required one keeps '' so it fails with
    // its own "required" message instead of a type error about null.
    expect(inner.mock.calls[0][0]).toEqual({ contactId: null, projectName: '' });
  });
});

describe('mapApiErrorToFields', () => {
  it('maps zod issues and duplicate-field details onto form fields', () => {
    const zod = new ApiRequestError(400, {
      code: 'VALIDATION_ERROR',
      message: 'Invalid',
      details: [{ path: 'projectName', message: 'Too short' }],
    });
    expect(mapApiErrorToFields(zod)).toEqual({
      fields: { projectName: 'Too short' },
      message: null,
    });

    const dup = new ApiRequestError(409, {
      code: 'DUPLICATE',
      message: 'A client called "X" already exists.',
      details: { field: 'name' },
    });
    expect(mapApiErrorToFields(dup).fields).toEqual({
      name: 'A client called "X" already exists.',
    });
  });

  it('keeps the message when nothing maps to a field', () => {
    const err = new ApiRequestError(500, { code: 'X', message: 'Boom' });
    expect(mapApiErrorToFields(err)).toEqual({ fields: {}, message: 'Boom' });
    expect(mapApiErrorToFields(new Error('network')).message).toMatch(/try again/i);
  });
});
