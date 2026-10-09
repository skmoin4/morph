import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@opsvera/shared';
import { taskAccess } from './taskAccess';

const user = (scopes: Record<string, string>, employeeId: string | null = 'emp-1') =>
  ({ employeeId, scopes }) as unknown as SessionUser;
const can =
  (...keys: string[]) =>
  (permission: string) =>
    keys.includes(permission);

describe('taskAccess', () => {
  it('lets a planner edit and reassign any task they can see', () => {
    const access = taskAccess(user({ 'task.edit': 'PROJECT' }), can('task.edit', 'task.create'), {
      assigneeId: 'someone-else',
    });
    expect(access.canEdit).toBe(true);
    expect(access.canReassign).toBe(true);
    expect(access.canCreate).toBe(true);
  });

  it('lets an employee change their own task, but not hand it over', () => {
    const access = taskAccess(user({ 'task.edit': 'OWN' }), can('task.edit'), {
      assigneeId: 'emp-1',
    });
    expect(access.canEdit).toBe(true);
    expect(access.canReassign).toBe(false);
    expect(access.canCreate).toBe(false);
  });

  it('keeps an employee’s hands off a colleague’s task', () => {
    const access = taskAccess(user({ 'task.edit': 'OWN' }), can('task.edit'), {
      assigneeId: 'colleague',
    });
    expect(access.canEdit).toBe(false);
  });

  it('gives nothing to someone without task.edit', () => {
    const access = taskAccess(user({}), can('task.view'), { assigneeId: 'emp-1' });
    expect(access.canEdit).toBe(false);
    expect(access.canReassign).toBe(false);
  });

  it('treats a user with no employee record as owning nothing', () => {
    const access = taskAccess(user({ 'task.edit': 'OWN' }, null), can('task.edit'), {
      assigneeId: null,
    });
    expect(access.canEdit).toBe(false);
  });
});
