import { useState } from 'react';
import { toast } from 'sonner';
import { TriangleAlert } from 'lucide-react';
import { Dialog } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';
import { TextAreaField, TextField } from '../../components/ui/Field';
import { ApiRequestError } from '../../lib/api';
import { FileUpload } from './FileUpload';
import {
  useAttachEmail,
  useCancelBooking,
  useDecideApproval,
  type BookingDetail,
  type UploadedFile,
} from './useBookings';

const today = () => new Date().toISOString().slice(0, 10);

/** Clears "Email pending" on a verbal booking. */
export function AttachEmailDialog({
  booking,
  onClose,
}: {
  booking: BookingDetail;
  onClose: () => void;
}) {
  const attach = useAttachEmail();
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [receivedAt, setReceivedAt] = useState(today());
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!file) {
      setError('Attach the client’s confirmation email.');
      return;
    }
    try {
      await attach.mutateAsync({
        id: booking.id,
        input: { emailDocumentId: file.id, receivedAt, notes: null },
      });
      toast.success('Email attached — the booking is no longer pending');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'Could not attach the email.');
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Attach the confirmation email"
      description={`${booking.bookingNumber} was confirmed verbally. Attaching the email clears “Email pending”.`}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={attach.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={attach.isPending} onClick={save}>
            Attach email
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FileUpload
          label="Confirmation email"
          category="Client confirmation"
          value={file}
          onChange={(next) => {
            setFile(next);
            setError(null);
          }}
          error={error ?? undefined}
        />
        <TextField
          label="Email received on"
          type="date"
          value={receivedAt}
          onChange={(event) => setReceivedAt(event.target.value)}
        />
      </div>
    </Dialog>
  );
}

/**
 * Cancels a booking that has no project yet. Once a project exists the API
 * refuses and names it, so the user is told to cancel the project instead.
 */
export function CancelBookingDialog({
  booking,
  onClose,
}: {
  booking: BookingDetail;
  onClose: () => void;
}) {
  const cancel = useCancelBooking();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (reason.trim().length < 5) {
      setError('Say why, in at least a few words.');
      return;
    }
    try {
      await cancel.mutateAsync({ id: booking.id, input: { reason } });
      toast.success(`${booking.bookingNumber} cancelled`);
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not cancel the booking.');
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Cancel this booking?"
      description={`${booking.bookingNumber} · ${booking.projectName}. The booking number stays on record; any project code is never reused.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={cancel.isPending}>
            Keep booking
          </Button>
          <Button variant="danger" loading={cancel.isPending} onClick={save}>
            Cancel booking
          </Button>
        </>
      }
    >
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
    </Dialog>
  );
}

/** Reject a held booking with a note; it goes back to draft. */
export function RejectBookingDialog({
  booking,
  onClose,
}: {
  booking: BookingDetail;
  onClose: () => void;
}) {
  const decide = useDecideApproval();
  const [note, setNote] = useState('');

  async function save() {
    try {
      await decide.mutateAsync({
        id: booking.id,
        input: { decision: 'REJECTED', note: note || null },
      });
      toast.success('Booking sent back to draft');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'Could not reject the booking.');
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Send this booking back?"
      description="It returns to draft so it can be corrected and confirmed again. No project code is used."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={decide.isPending}>
            Cancel
          </Button>
          <Button variant="danger" loading={decide.isPending} onClick={save}>
            Reject
          </Button>
        </>
      }
    >
      <TextAreaField
        label="Reason for the requester"
        rows={3}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
    </Dialog>
  );
}

/** Shown in place of the cancel button when a project already exists. */
export function CancelBlockedNote({ reason, code }: { reason?: string; code?: string | null }) {
  return (
    <p className="flex items-start gap-2 text-sub text-muted">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-amber" />
      <span>
        {reason ?? 'This booking cannot be cancelled.'}
        {code && (
          <>
            {' '}
            Cancel project <strong className="font-heavy text-ink">{code}</strong> instead.
          </>
        )}
      </span>
    </p>
  );
}
