import { useState } from 'react';
import { toast } from 'sonner';
import { PROJECT_STATUS_TRANSITIONS } from '@opsvera/shared';
import { Dialog } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';
import { SelectField, TextAreaField } from '../../components/ui/Field';
import { ApiRequestError } from '../../lib/api';
import {
  STATUS_LABEL,
  useChangeProjectStatus,
  type ProjectDetail,
  type ProjectStatus,
} from './useProjects';

const VERB: Record<ProjectStatus, string> = {
  ACTIVE: 'Reopen',
  ON_HOLD: 'Put on hold',
  COMPLETED: 'Mark completed',
  CANCELLED: 'Cancel project',
};

/**
 * The one place a project changes status. Cancelling asks for a reason and
 * says what it does and does not do: the code stays reserved and the
 * booking record is left as it was.
 */
export function ProjectStatusDialog({
  project,
  onClose,
}: {
  project: ProjectDetail;
  onClose: () => void;
}) {
  const change = useChangeProjectStatus();
  const choices = PROJECT_STATUS_TRANSITIONS[project.status];
  const [target, setTarget] = useState<ProjectStatus>(choices[0] as ProjectStatus);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cancelling = target === 'CANCELLED';

  async function save() {
    if (cancelling && reason.trim().length < 5) {
      setError('Say why, in at least a few words.');
      return;
    }
    try {
      await change.mutateAsync({
        id: project.id,
        input: { status: target, reason: reason || null },
      });
      toast.success(`${project.projectCode} is now ${STATUS_LABEL[target].toLowerCase()}`);
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not change the status.');
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Change project status"
      description={`${project.projectCode} is ${STATUS_LABEL[project.status].toLowerCase()}.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={change.isPending}>
            Back
          </Button>
          <Button
            variant={cancelling ? 'danger' : 'primary'}
            loading={change.isPending}
            onClick={save}
          >
            {VERB[target]}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <SelectField
          label="New status"
          value={target}
          onChange={(event) => {
            setTarget(event.target.value as ProjectStatus);
            setError(null);
          }}
          options={choices.map((status) => ({ value: status, label: STATUS_LABEL[status] }))}
        />
        {cancelling && (
          <>
            <p className="rounded-card bg-surface-2 p-3 text-sub text-ink-2">
              The project code stays reserved and is never reused, and time and cost already
              recorded keep resolving. Tasks can no longer be changed unless the project is
              reopened.
            </p>
            <TextAreaField
              label="Reason"
              required
              rows={3}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setError(null);
              }}
              error={error ?? undefined}
            />
          </>
        )}
        {!cancelling && error && (
          <p role="alert" className="text-sub text-red">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
