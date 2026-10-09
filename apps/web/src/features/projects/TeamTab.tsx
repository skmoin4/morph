import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, UserMinus, Users } from 'lucide-react';
import { Avatar } from '../../components/ui/Avatar';
import { Button, IconButton } from '../../components/ui/Button';
import { ConfirmDialog, Dialog } from '../../components/ui/Dialog';
import { SelectField, TextField } from '../../components/ui/Field';
import { EmptyState } from '../../components/ui/EmptyState';
import { Panel } from '../../components/ui/Panel';
import { Pill } from '../../components/ui/Pill';
import { ApiRequestError } from '../../lib/api';
import { formatDisplayDate } from '../../lib/format';
import {
  personName,
  useAddMember,
  useRemoveMember,
  useTeamLookup,
  type ProjectDetail,
  type ProjectMember,
} from './useProjects';

export function TeamTab({ project, canEdit }: { project: ProjectDetail; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ProjectMember | null>(null);
  const remove = useRemoveMember();

  const active = project.members.filter((m) => m.isActive);
  const past = project.members.filter((m) => !m.isActive);
  const closed = project.status === 'CANCELLED';

  async function confirmRemove() {
    if (!removing) return;
    try {
      await remove.mutateAsync({ id: project.id, memberId: removing.id });
      toast.success(`${removing.fullName} left the team`);
      setRemoving(null);
    } catch (error) {
      // The API explains, e.g. "They still have 2 open tasks…".
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not remove them.');
      setRemoving(null);
    }
  }

  return (
    <div className="space-y-5">
      <Panel title="Project manager" subtitle="Owns the plan and approves the team’s time.">
        <p className="text-body font-heavy text-ink">{personName(project.projectManager)}</p>
        {project.projectManager && (
          <p className="text-sub text-muted">{project.projectManager.employeeCode}</p>
        )}
        {!project.projectManager && (
          <p className="text-sub text-muted">No manager assigned. Edit the project to set one.</p>
        )}
      </Panel>

      <Panel
        title="Team"
        subtitle={`${active.length} on the project`}
        action={
          canEdit &&
          !closed && (
            <Button
              size="sm"
              variant="primary"
              leadingIcon={<Plus />}
              onClick={() => setAdding(true)}
            >
              Add member
            </Button>
          )
        }
      >
        {active.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title="Nobody on the team yet"
            description="Add the people who will work on this project; tasks and timesheets can then be assigned to them."
            action={
              canEdit && !closed ? (
                <Button
                  size="sm"
                  variant="primary"
                  leadingIcon={<Plus />}
                  onClick={() => setAdding(true)}
                >
                  Add member
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {active.map((member) => (
              <li
                key={member.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line-soft bg-surface-2 p-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={member.fullName} />
                  <div className="min-w-0">
                    <p className="truncate text-body font-heavy text-ink">{member.fullName}</p>
                    <p className="truncate text-sub text-muted">
                      {member.roleOnProject ?? member.employee.designation?.name ?? 'Team member'}
                      {` · ${member.allocationPercent}%`}
                      {member.joinedOn && ` · since ${formatDisplayDate(member.joinedOn)}`}
                    </p>
                  </div>
                </div>
                {canEdit && !closed && (
                  <IconButton
                    label={`Remove ${member.fullName}`}
                    size="sm"
                    onClick={() => setRemoving(member)}
                  >
                    <UserMinus />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        )}

        {past.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-micro font-heavy uppercase text-muted">Left the project</p>
            <div className="flex flex-wrap gap-2">
              {past.map((member) => (
                <Pill key={member.id} tone="gray">
                  {member.fullName}
                  {member.leftOn && ` · ${formatDisplayDate(member.leftOn)}`}
                </Pill>
              ))}
            </div>
          </div>
        )}
      </Panel>

      {adding && <AddMemberDialog project={project} onClose={() => setAdding(false)} />}

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={confirmRemove}
        loading={remove.isPending}
        destructive
        title="Take them off the project?"
        description={
          removing
            ? `${removing.fullName} stays on record — time and cost already logged keep resolving — but can no longer be assigned new tasks.`
            : ''
        }
        confirmLabel="Remove from team"
      />
    </div>
  );
}

function AddMemberDialog({ project, onClose }: { project: ProjectDetail; onClose: () => void }) {
  const { data: lookups, isLoading } = useTeamLookup(true);
  const add = useAddMember();

  const [employeeId, setEmployeeId] = useState('');
  const [role, setRole] = useState('');
  const [allocation, setAllocation] = useState('100');
  const [error, setError] = useState<string | null>(null);

  const available = useMemo(() => {
    const onTeam = new Set(project.members.filter((m) => m.isActive).map((m) => m.employeeId));
    return (lookups?.employees ?? []).filter((e) => !onTeam.has(e.id));
  }, [lookups, project.members]);

  async function save() {
    const percent = Number(allocation);
    if (!employeeId) {
      setError('Choose who to add.');
      return;
    }
    if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
      setError('Allocation is a whole number from 1 to 100.');
      return;
    }
    try {
      await add.mutateAsync({
        id: project.id,
        input: { employeeId, roleOnProject: role || null, allocationPercent: percent },
      });
      toast.success('Added to the team');
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not add them.');
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a team member"
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={add.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={add.isPending} onClick={save}>
            Add to team
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <SelectField
          label="Employee"
          required
          placeholder={isLoading ? 'Loading…' : 'Choose a person'}
          value={employeeId}
          onChange={(event) => {
            setEmployeeId(event.target.value);
            setError(null);
          }}
          options={available.map((e) => ({
            value: e.id,
            label: `${e.fullName} · ${e.designation ?? e.employeeCode} · ${e.office}`,
          }))}
        />
        <TextField
          label="Role on this project"
          hint="e.g. BIM Coordinator, MEP Engineer"
          value={role}
          onChange={(event) => setRole(event.target.value)}
        />
        <TextField
          label="Allocation (%)"
          inputMode="numeric"
          value={allocation}
          onChange={(event) => setAllocation(event.target.value)}
        />
        {error && (
          <p role="alert" className="text-sub text-red">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
