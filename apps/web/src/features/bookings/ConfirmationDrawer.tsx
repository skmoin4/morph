import { useState } from 'react';
import { toast } from 'sonner';
import { Mail, Phone } from 'lucide-react';
import { confirmBookingSchema, type ConfirmBookingInput } from '@opsvera/shared';
import { Drawer } from '../../components/ui/Drawer';
import { Button } from '../../components/ui/Button';
import { SelectField, TextAreaField, TextField } from '../../components/ui/Field';
import { ApiRequestError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatDisplayDate } from '../../lib/format';
import { ConfirmProjectDialog } from './ConfirmProjectDialog';
import { FileUpload } from './FileUpload';
import { useConfirmBooking, type BookingDetail, type UploadedFile } from './useBookings';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Collects the client's proof — an email or a verbal note — then hands over to
 * the confirm dialog. Nothing is confirmed until that dialog is accepted.
 */
export function ConfirmationDrawer({
  booking,
  onClose,
  onDone,
}: {
  booking: BookingDetail;
  onClose: () => void;
  /** Called with the refreshed booking once confirmation has gone through. */
  onDone: (booking: BookingDetail) => void;
}) {
  const confirm = useConfirmBooking();

  const [type, setType] = useState<'EMAIL' | 'VERBAL'>('EMAIL');
  const [email, setEmail] = useState<UploadedFile | null>(null);
  const [receivedAt, setReceivedAt] = useState(today());
  const [emailNotes, setEmailNotes] = useState('');
  const [verbal, setVerbal] = useState({
    confirmedByName: booking.clientContact?.name ?? '',
    confirmedOn: today(),
    mode: 'CALL',
    summary: '',
  });
  const [po, setPo] = useState<UploadedFile | null>(null);
  const [poNumber, setPoNumber] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<ConfirmBookingInput | null>(null);

  function review() {
    const candidate = {
      confirmation:
        type === 'EMAIL'
          ? { type, emailDocumentId: email?.id ?? '', receivedAt, notes: emailNotes || null }
          : { type, ...verbal },
      poDocumentId: po?.id ?? null,
      poNumber: poNumber || null,
    };

    const parsed = confirmBookingSchema.safeParse(candidate);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[issue.path.length - 1]);
        // An empty document id is "no file chosen" in the user's terms.
        next[key === 'emailDocumentId' ? 'file' : key] =
          key === 'emailDocumentId' ? 'Attach the client’s confirmation email.' : issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setPending(parsed.data);
  }

  async function submit() {
    if (!pending) return;
    try {
      const saved = await confirm.mutateAsync({ id: booking.id, input: pending });
      setPending(null);
      toast.success(
        saved.project
          ? `Project ${saved.project.projectCode} created`
          : 'Booking confirmed — waiting for approval',
      );
      onDone(saved);
      onClose();
    } catch (error) {
      setPending(null);
      toast.error(
        error instanceof ApiRequestError ? error.message : 'Could not confirm the booking.',
      );
    }
  }

  const proofSummary =
    type === 'EMAIL'
      ? `Email · ${email?.fileName ?? ''}, received ${formatDisplayDate(receivedAt)}`
      : `Verbal · ${verbal.confirmedByName} (${verbal.mode === 'CALL' ? 'call' : 'meeting'}) on ${formatDisplayDate(verbal.confirmedOn)} — email to follow`;

  const options = [
    {
      value: 'EMAIL',
      label: 'Confirmation email',
      hint: 'Attach the client’s email',
      icon: <Mail />,
    },
    {
      value: 'VERBAL',
      label: 'Verbal confirmation',
      hint: 'Record who agreed, and what',
      icon: <Phone />,
    },
  ] as const;

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        width="md"
        title="Client confirmation"
        subtitle={`${booking.bookingNumber} · ${booking.client.name}`}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={review}>
              Review and confirm
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          <p className="text-sub text-muted">
            A booking cannot be confirmed without proof that the client agreed. Attach their email,
            or — if there is no email yet — record the verbal confirmation. A verbal booking shows
            “Email pending” until the email is attached.
          </p>

          <div
            role="radiogroup"
            aria-label="How did the client confirm?"
            className="grid gap-2 sm:grid-cols-2"
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={type === option.value}
                onClick={() => {
                  setType(option.value);
                  setErrors({});
                }}
                className={cn(
                  'flex items-start gap-2.5 rounded-card border p-3 text-left transition-colors',
                  type === option.value
                    ? 'border-blue bg-pill-blue-bg/60'
                    : 'border-line bg-surface hover:bg-surface-2',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'mt-0.5 [&>svg]:size-4',
                    type === option.value ? 'text-blue' : 'text-muted',
                  )}
                >
                  {option.icon}
                </span>
                <span>
                  <span className="block text-body font-heavy text-ink">{option.label}</span>
                  <span className="block text-sub text-muted">{option.hint}</span>
                </span>
              </button>
            ))}
          </div>

          {type === 'EMAIL' ? (
            <section className="space-y-3">
              <FileUpload
                label="Confirmation email"
                category="Client confirmation"
                value={email}
                onChange={setEmail}
                error={errors.file}
              />
              <TextField
                label="Email received on"
                type="date"
                required
                error={errors.receivedAt}
                value={receivedAt}
                onChange={(event) => setReceivedAt(event.target.value)}
              />
              <TextAreaField
                label="Notes"
                rows={2}
                value={emailNotes}
                onChange={(event) => setEmailNotes(event.target.value)}
              />
            </section>
          ) : (
            <section className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Confirmed by"
                required
                hint="The client's person who gave the go-ahead"
                error={errors.confirmedByName}
                value={verbal.confirmedByName}
                onChange={(event) => setVerbal({ ...verbal, confirmedByName: event.target.value })}
              />
              <TextField
                label="Date"
                type="date"
                required
                error={errors.confirmedOn}
                value={verbal.confirmedOn}
                onChange={(event) => setVerbal({ ...verbal, confirmedOn: event.target.value })}
              />
              <SelectField
                label="Mode"
                required
                error={errors.mode}
                value={verbal.mode}
                onChange={(event) => setVerbal({ ...verbal, mode: event.target.value })}
                options={[
                  { value: 'CALL', label: 'Phone call' },
                  { value: 'MEETING', label: 'Meeting' },
                ]}
              />
              <TextAreaField
                label="What was agreed"
                required
                rows={4}
                containerClassName="sm:col-span-2"
                hint={`${verbal.summary.trim().length}/20 characters minimum`}
                error={errors.summary}
                value={verbal.summary}
                onChange={(event) => setVerbal({ ...verbal, summary: event.target.value })}
              />
            </section>
          )}

          <section className="space-y-3 border-t border-line pt-5">
            <h3 className="text-title font-heavy text-ink">
              Purchase order <span className="text-sub font-normal text-muted">(optional)</span>
            </h3>
            <TextField
              label="PO / work order number"
              value={poNumber}
              onChange={(event) => setPoNumber(event.target.value)}
              error={errors.poNumber}
            />
            <FileUpload label="PO document" category="Purchase order" value={po} onChange={setPo} />
          </section>
        </div>
      </Drawer>

      {pending && (
        <ConfirmProjectDialog
          booking={booking}
          mode="confirm"
          proofSummary={proofSummary}
          loading={confirm.isPending}
          onCancel={() => setPending(null)}
          onConfirm={submit}
        />
      )}
    </>
  );
}
