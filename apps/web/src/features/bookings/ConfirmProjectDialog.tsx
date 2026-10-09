import { Info, ShieldCheck } from 'lucide-react';
import { Dialog } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { formatCurrency, formatDisplayDate } from '../../lib/format';
import { ConfirmationBadges, BILLING_LABEL } from './BookingBadges';
import { useCodePreview, type BookingListItem } from './useBookings';

/**
 * The last look before a project code is spent.
 *
 * Shows the code this booking would get and what carries over into the
 * project, because confirming is not reversible — a code is never reused.
 */
export function ConfirmProjectDialog({
  booking,
  proofSummary,
  mode,
  loading,
  onCancel,
  onConfirm,
}: {
  booking: BookingListItem;
  /** One line describing the proof being attached, e.g. "Email · award.eml". */
  proofSummary?: string;
  /** `confirm` from a draft; `approve` when an approver releases a held booking. */
  mode: 'confirm' | 'approve';
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { data: preview, isLoading } = useCodePreview(booking.id);
  const held = mode === 'confirm' && preview?.requiresApproval;

  return (
    <Dialog
      open
      onClose={loading ? () => undefined : onCancel}
      title={
        mode === 'approve' ? 'Approve and create project?' : 'Confirm booking and create project?'
      }
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            Back
          </Button>
          <Button variant="primary" loading={loading} disabled={isLoading} onClick={onConfirm}>
            {held
              ? 'Confirm and send for approval'
              : mode === 'approve'
                ? 'Approve'
                : 'Confirm and create project'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-card border border-line bg-surface-2 p-4 text-center">
          <p className="text-micro font-heavy uppercase text-muted">
            {held
              ? 'Project code'
              : preview?.issued
                ? 'Project code'
                : 'Project code (next in sequence)'}
          </p>
          {isLoading ? (
            <Skeleton className="mx-auto mt-2 h-8 w-56" />
          ) : held ? (
            <p className="mt-1 text-title font-heavy text-ink">
              Issued when this booking is approved
            </p>
          ) : (
            <p className="mt-1 font-mono text-[26px] font-black tracking-tight text-blue">
              {preview?.code}
            </p>
          )}
          {!isLoading && !held && !preview?.issued && (
            <p className="mt-1.5 text-micro tracking-normal text-muted">
              The number is reserved at the moment you confirm. If someone else confirms first, you
              get the next one. Numbers are never reused.
            </p>
          )}
        </div>

        {held && (
          <div className="flex items-start gap-2.5 rounded-card border border-pill-amber-bg bg-pill-amber-bg/60 p-3">
            <ShieldCheck aria-hidden className="mt-px size-4 shrink-0 text-pill-amber-fg" />
            <p className="text-sub text-pill-amber-fg">
              This company requires approval. The booking will be marked confirmed and wait for an
              approver; no code is used until then.
            </p>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sub">
          {[
            ['Booking', `${booking.bookingNumber} · ${booking.projectName}`],
            ['Client', booking.client.name],
            ['Type / office', `${booking.projectType.name} · ${booking.office.name}`],
            [
              'Value',
              booking.projectValue ? formatCurrency(booking.projectValue) : 'Hidden for your role',
            ],
            [
              'Budget',
              `${Number(booking.budgetHours).toLocaleString('en-IN')} hours · ${BILLING_LABEL[booking.billingType]}`,
            ],
            [
              'Dates',
              `${formatDisplayDate(booking.expectedStartDate)} → ${formatDisplayDate(booking.expectedEndDate)}`,
            ],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-micro font-heavy uppercase text-muted">{label}</dt>
              <dd className="mt-0.5 break-words text-body text-ink">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex items-start gap-2.5 rounded-card bg-surface-2 p-3">
          <Info aria-hidden className="mt-px size-4 shrink-0 text-muted" />
          <div className="min-w-0 text-sub text-ink-2">
            <p className="font-heavy">Client confirmation</p>
            {proofSummary ? (
              <p className="mt-0.5 break-words">{proofSummary}</p>
            ) : (
              <div className="mt-1">
                <ConfirmationBadges booking={booking} />
              </div>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
