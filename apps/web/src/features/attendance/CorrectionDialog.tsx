import { useState } from 'react';
import { toast } from 'sonner';
import { regularisationSchema } from '@opsvera/shared';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { TextAreaField, TextField } from '../../components/ui/Field';
import { ApiRequestError } from '../../lib/api';
import { useCreateRegularisation } from './useAttendance';

/** Ask for a day's clock-in and/or clock-out to be corrected. */
export function CorrectionDialog({
  defaultDate,
  onClose,
}: {
  defaultDate: string;
  onClose: () => void;
}) {
  const create = useCreateRegularisation();
  const [date, setDate] = useState(defaultDate);
  const [inTime, setInTime] = useState('');
  const [outTime, setOutTime] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit() {
    const parsed = regularisationSchema.safeParse({
      attendanceDate: date,
      requestedInTime: inTime || null,
      requestedOutTime: outTime || null,
      reason,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    try {
      await create.mutateAsync(parsed.data);
      toast.success('Sent to your manager for approval');
      onClose();
    } catch (error) {
      if (error instanceof ApiRequestError && Object.keys(error.fieldErrors).length > 0) {
        setErrors(error.fieldErrors);
      } else {
        setErrors({
          reason: error instanceof ApiRequestError ? error.message : 'Could not send the request.',
        });
      }
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Request a correction"
      description="Tell us what the day should have shown. Your manager approves it; the original punches stay on record."
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={submit}>
            Send request
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          label="Day"
          type="date"
          required
          containerClassName="sm:col-span-3"
          error={errors.attendanceDate}
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <TextField
          label="Should have clocked in at"
          type="time"
          error={errors.requestedInTime}
          value={inTime}
          onChange={(event) => setInTime(event.target.value)}
        />
        <TextField
          label="Should have clocked out at"
          type="time"
          error={errors.requestedOutTime}
          value={outTime}
          onChange={(event) => setOutTime(event.target.value)}
        />
        <p className="self-end pb-2 text-micro tracking-normal text-muted">Fill in one or both.</p>
        <TextAreaField
          label="What happened"
          required
          rows={3}
          containerClassName="sm:col-span-3"
          error={errors.reason}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
    </Dialog>
  );
}
