import type { SessionUser } from '@opsvera/shared';

/**
 * What the current user may do to a task. Mirrors the API's rule (an `OWN`
 * scope on task.edit means "only tasks assigned to me") so the UI hides what
 * would be refused — the API still decides.
 */
export function taskAccess(
  user: SessionUser | null,
  can: (permission: string) => boolean,
  task: { assigneeId: string | null } | null,
) {
  const ownOnly = user?.scopes['task.edit'] === 'OWN';
  const isMine = Boolean(task && user?.employeeId && task.assigneeId === user.employeeId);

  return {
    canEdit: can('task.edit') && (!ownOnly || isMine),
    /** Changing who a task belongs to is planning, not updating your own work. */
    canReassign: can('task.edit') && !ownOnly,
    canCreate: can('task.create'),
    canDelete: can('task.delete'),
  };
}
