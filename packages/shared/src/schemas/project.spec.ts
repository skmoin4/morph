import { describe, expect, it } from 'vitest';
import {
  canMoveProject,
  changeProjectStatusSchema,
  createTaskSchema,
  moveTaskSchema,
  validateTaskAttachment,
} from './project';

describe('project status transitions', () => {
  it('allows the moves a project really makes', () => {
    expect(canMoveProject('ACTIVE', 'ON_HOLD')).toBe(true);
    expect(canMoveProject('ACTIVE', 'COMPLETED')).toBe(true);
    expect(canMoveProject('ON_HOLD', 'ACTIVE')).toBe(true);
  });

  it('lets a finished or cancelled project be reopened, but not jump sideways', () => {
    expect(canMoveProject('COMPLETED', 'ACTIVE')).toBe(true);
    expect(canMoveProject('CANCELLED', 'ACTIVE')).toBe(true);
    expect(canMoveProject('COMPLETED', 'ON_HOLD')).toBe(false);
    expect(canMoveProject('CANCELLED', 'COMPLETED')).toBe(false);
    expect(canMoveProject('ON_HOLD', 'COMPLETED')).toBe(false);
  });

  it('needs a real reason to cancel', () => {
    expect(changeProjectStatusSchema.safeParse({ status: 'CANCELLED' }).success).toBe(false);
    expect(changeProjectStatusSchema.safeParse({ status: 'CANCELLED', reason: 'no' }).success).toBe(false);
    expect(
      changeProjectStatusSchema.safeParse({ status: 'CANCELLED', reason: 'Client withdrew' }).success,
    ).toBe(true);
    // Other moves need none.
    expect(changeProjectStatusSchema.safeParse({ status: 'ON_HOLD' }).success).toBe(true);
  });
});

describe('task input', () => {
  it('defaults a new task to medium priority in To do', () => {
    const parsed = createTaskSchema.parse({ title: 'Clash detection' });
    expect(parsed.priority).toBe('MEDIUM');
    expect(parsed.status).toBe('TODO');
  });

  it('rejects a due date before the start date', () => {
    const result = createTaskSchema.safeParse({
      title: 'Backwards',
      startDate: '2026-10-10',
      dueDate: '2026-10-01',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a drop with or without a place in the column', () => {
    expect(moveTaskSchema.safeParse({ status: 'DONE' }).success).toBe(true);
    expect(moveTaskSchema.safeParse({ status: 'REVIEW', beforeTaskId: 'abc' }).success).toBe(true);
    expect(moveTaskSchema.safeParse({ status: 'ARCHIVED' }).success).toBe(false);
  });
});

describe('task attachments', () => {
  it('takes drawings, models and documents', () => {
    for (const name of ['plan.dwg', 'model.RVT', 'sheet.xlsx', 'photo.JPG', 'ga.pdf']) {
      expect(validateTaskAttachment({ name, size: 1000 }).ok).toBe(true);
    }
  });

  it('refuses executables, scripts, empty files and anything over the limit', () => {
    for (const name of ['setup.exe', 'run.bat', 'x.js', 'noextension']) {
      expect(validateTaskAttachment({ name, size: 1000 }).ok).toBe(false);
    }
    expect(validateTaskAttachment({ name: 'a.pdf', size: 0 }).ok).toBe(false);
    expect(validateTaskAttachment({ name: 'a.pdf', size: 26 * 1024 * 1024 }).ok).toBe(false);
  });
});
