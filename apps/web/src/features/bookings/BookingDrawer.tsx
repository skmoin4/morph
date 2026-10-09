import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Download, FileCheck2, Mail, Pencil, ShieldCheck, XCircle } from 'lucide-react';
import { Drawer } from '../../components/ui/Drawer';
import { Button } from '../../components/ui/Button';
import { Pill, StatusPill } from '../../components/ui/Pill';
import { Skeleton } from '../../components/ui/Skeleton';
import { BOOKING_LIFECYCLE, Stepper } from '../../components/ui/Stepper';
import { api, ApiRequestError } from '../../lib/api';
import { formatCurrency, formatDisplayDate } from '../../lib/format';
import { useAuth } from '../../providers/AuthProvider';
import { BILLING_LABEL, ConfirmationBadges } from './BookingBadges';
import {
  AttachEmailDialog,
  CancelBlockedNote,
  CancelBookingDialog,
  RejectBookingDialog,
} from './BookingDialogs';
import { BookingFormDrawer } from './BookingFormDrawer';
import { ConfirmationDrawer } from './ConfirmationDrawer';
import { ConfirmProjectDialog } from './ConfirmProjectDialog';
import { fileDownloadPath, useBooking, useDecideApproval } from './useBookings';

type Overlay = 'edit' | 'confirm' | 'attach' | 'cancel' | 'approve' | 'reject' | null;

/**
 * The booking in full: lifecycle, what was agreed, the client's proof, and the
 * actions that move it forward. Every action is a separate overlay so the
 * drawer itself stays a calm read-only record.
 */
export function BookingDrawer({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data: booking, isLoading } = useBooking(bookingId);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const decide = useDecideApproval();

  const close = () => setOverlay(null);

  async function approve() {
    try {
      const saved = await decide.mutateAsync({
        id: bookingId,
        input: { decision: 'APPROVED', note: null },
      });
      toast.success(saved.project ? `Project ${saved.project.projectCode} created` : 'Approved');
      close();
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not approve.');
      close();
    }
  }

  async function download(id: string, name: string) {
    try {
      await api.download(fileDownloadPath(id), name);
    } catch {
      toast.error('Could not download that file.');
    }
  }

  const awaitingApproval = booking?.status === 'CONFIRMED' && booking.approvalStatus === 'PENDING';
  const canEditNow =
    booking &&
    (booking.status === 'DRAFT' || booking.status === 'CONFIRMED') &&
    can('booking.edit');

  const footer = booking && (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-2">
        {canEditNow && (
          <Button leadingIcon={<Pencil />} onClick={() => setOverlay('edit')}>
            Edit
          </Button>
        )}
        {booking.status !== 'CANCELLED' &&
          booking.status !== 'PROJECT_CREATED' &&
          can('booking.edit') && (
            <Button variant="danger" leadingIcon={<XCircle />} onClick={() => setOverlay('cancel')}>
              Cancel booking
            </Button>
          )}
      </div>
      <div className="flex flex-wrap gap-2">
        {booking.emailPending && can('booking.edit') && (
          <Button leadingIcon={<Mail />} onClick={() => setOverlay('attach')}>
            Attach email
          </Button>
        )}
        {awaitingApproval && can('booking.approve') && (
          <>
            <Button variant="danger" onClick={() => setOverlay('reject')}>
              Reject
            </Button>
            <Button
              variant="primary"
              leadingIcon={<ShieldCheck />}
              onClick={() => setOverlay('approve')}
            >
              Approve
            </Button>
          </>
        )}
        {booking.status === 'DRAFT' && can('booking.confirm') && (
          <Button
            variant="primary"
            leadingIcon={<FileCheck2 />}
            onClick={() => setOverlay('confirm')}
          >
            Confirm booking
          </Button>
        )}
      </div>
    </div>
  );

  const confirmation = booking?.confirmation;

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        width="lg"
        title={booking ? booking.bookingNumber : 'Booking'}
        subtitle={booking?.projectName}
        footer={footer || undefined}
      >
        {isLoading || !booking ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <div className="space-y-6">
            <Stepper
              steps={BOOKING_LIFECYCLE}
              currentIndex={booking.lifecycleStage}
              cancelled={booking.status === 'CANCELLED'}
              compact
            />

            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={booking.status} />
              {awaitingApproval && <Pill tone="amber">Awaiting approval</Pill>}
              <ConfirmationBadges booking={booking} />
              {booking.generatedProjectCode && (
                <Pill tone="green" className="font-mono">
                  {booking.generatedProjectCode}
                </Pill>
              )}
            </div>

            {booking.status === 'CANCELLED' && (
              <Notice tone="gray" title="Cancelled">
                {booking.cancelReason ?? 'No reason recorded.'}
              </Notice>
            )}
            {booking.approvalStatus === 'REJECTED' && booking.status === 'DRAFT' && (
              <Notice tone="red" title="Sent back by an approver">
                {booking.approvalNote ?? 'No reason given.'} Correct it and confirm again.
              </Notice>
            )}
            {awaitingApproval && (
              <Notice tone="amber" title="Waiting for approval">
                The client’s proof is on file. The project code is issued once an approver accepts.
              </Notice>
            )}
            {booking.emailPending && (
              <Notice
                tone={booking.emailOverdueDays !== null ? 'red' : 'amber'}
                title="Email pending"
              >
                Confirmed verbally on{' '}
                {confirmation?.confirmedOn ? formatDisplayDate(confirmation.confirmedOn) : '—'}.
                {booking.emailOverdueDays !== null
                  ? ` The email is ${booking.emailOverdueDays} day${booking.emailOverdueDays === 1 ? '' : 's'} past the ${booking.policy.verbalEmailGraceDays}-day window — a reminder only; nothing is blocked.`
                  : ' Attach the client’s email when it arrives.'}
              </Notice>
            )}

            <Section title="Commercial terms">
              <Facts
                items={[
                  ['Client', booking.client.name],
                  ['Contact', booking.clientContact?.name ?? '—'],
                  [
                    'Project type',
                    `${booking.projectType.name} (${booking.projectType.shortCode})`,
                  ],
                  ['Office', booking.office.name],
                  [
                    'Value',
                    booking.projectValue
                      ? formatCurrency(booking.projectValue)
                      : 'Hidden for your role',
                  ],
                  ['Budget hours', Number(booking.budgetHours).toLocaleString('en-IN')],
                  ['Billing', BILLING_LABEL[booking.billingType]],
                  ['Booked on', formatDisplayDate(booking.bookingDate)],
                  ['Expected start', formatDisplayDate(booking.expectedStartDate)],
                  ['Expected end', formatDisplayDate(booking.expectedEndDate)],
                ]}
              />
              {booking.scopeDescription && (
                <p className="mt-3 whitespace-pre-line rounded-card bg-surface-2 p-3 text-sub text-ink-2">
                  {booking.scopeDescription}
                </p>
              )}
            </Section>

            <Section title="Client confirmation">
              {!confirmation ? (
                <p className="text-sub text-muted">
                  Nothing attached yet.
                  {booking.status === 'DRAFT' &&
                    can('booking.confirm') &&
                    ' Confirm the booking to attach the client’s email or a verbal note.'}
                </p>
              ) : confirmation.type === 'EMAIL' ? (
                <div className="space-y-3">
                  <Facts
                    items={[
                      [
                        'Received',
                        confirmation.emailReceivedAt
                          ? formatDisplayDate(confirmation.emailReceivedAt)
                          : '—',
                      ],
                      ['PO number', confirmation.poNumber ?? '—'],
                    ]}
                  />
                  <FileRow doc={confirmation.emailDocument} onDownload={download} />
                  {confirmation.notes && (
                    <p className="text-sub text-ink-2">{confirmation.notes}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <Facts
                    items={[
                      ['Confirmed by', confirmation.confirmedByName ?? '—'],
                      [
                        'Date',
                        confirmation.confirmedOn
                          ? formatDisplayDate(confirmation.confirmedOn)
                          : '—',
                      ],
                      ['Mode', confirmation.verbalMode === 'MEETING' ? 'Meeting' : 'Phone call'],
                      ['PO number', confirmation.poNumber ?? '—'],
                    ]}
                  />
                  <p className="whitespace-pre-line rounded-card bg-surface-2 p-3 text-sub text-ink-2">
                    {confirmation.verbalSummary}
                  </p>
                  {confirmation.emailDocument && (
                    <>
                      <p className="text-micro font-heavy uppercase text-muted">
                        Email attached later
                      </p>
                      <FileRow doc={confirmation.emailDocument} onDownload={download} />
                    </>
                  )}
                </div>
              )}
              {confirmation?.poDocument && (
                <div className="mt-3">
                  <p className="mb-1.5 text-micro font-heavy uppercase text-muted">
                    Purchase order
                  </p>
                  <FileRow doc={confirmation.poDocument} onDownload={download} />
                </div>
              )}
            </Section>

            {booking.project && (
              <Section title="Project">
                <Facts
                  items={[
                    ['Project code', booking.project.projectCode],
                    ['Status', booking.project.status],
                  ]}
                />
                <p className="mt-2 text-sub text-muted">
                  The project carries these terms from the booking. Scheduling, team and tasks are
                  planned on the project itself.
                </p>
                {can('project.view') && (
                  <Button
                    className="mt-3"
                    variant="primary"
                    onClick={() => navigate(`/projects/${booking.project!.id}`)}
                  >
                    Open project
                  </Button>
                )}
              </Section>
            )}

            {booking.status === 'PROJECT_CREATED' && can('booking.edit') && (
              <CancelBlockedNote
                reason={booking.canCancel.reason}
                code={booking.project?.projectCode}
              />
            )}
          </div>
        )}
      </Drawer>

      {booking && overlay === 'edit' && (
        <BookingFormDrawer booking={booking} onClose={close} onSaved={() => undefined} />
      )}
      {booking && overlay === 'confirm' && (
        <ConfirmationDrawer booking={booking} onClose={close} onDone={() => undefined} />
      )}
      {booking && overlay === 'attach' && <AttachEmailDialog booking={booking} onClose={close} />}
      {booking && overlay === 'cancel' && <CancelBookingDialog booking={booking} onClose={close} />}
      {booking && overlay === 'reject' && <RejectBookingDialog booking={booking} onClose={close} />}
      {booking && overlay === 'approve' && (
        <ConfirmProjectDialog
          booking={booking}
          mode="approve"
          loading={decide.isPending}
          onCancel={close}
          onConfirm={approve}
        />
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 text-title font-heavy text-ink">{title}</h3>
      {children}
    </section>
  );
}

function Facts({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-micro font-heavy uppercase text-muted">{label}</dt>
          <dd className="mt-0.5 break-words text-body text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const NOTICE_TONES = {
  amber: 'border-pill-amber-bg bg-pill-amber-bg/60 text-pill-amber-fg',
  red: 'border-pill-red-bg bg-pill-red-bg/60 text-pill-red-fg',
  gray: 'border-line bg-surface-2 text-ink-2',
} as const;

function Notice({
  tone,
  title,
  children,
}: {
  tone: keyof typeof NOTICE_TONES;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" className={`rounded-card border p-3 text-sub ${NOTICE_TONES[tone]}`}>
      <p className="font-heavy">{title}</p>
      <p className="mt-0.5">{children}</p>
    </div>
  );
}

function FileRow({
  doc,
  onDownload,
}: {
  doc?: { id: string; fileName: string; sizeBytes: number } | null;
  onDownload: (id: string, name: string) => void;
}) {
  if (!doc) return <p className="text-sub text-muted">No file.</p>;
  return (
    <div className="flex items-center justify-between gap-2 rounded-card border border-line bg-surface-2 p-2.5">
      <span className="min-w-0 truncate text-body font-heavy text-ink">{doc.fileName}</span>
      <Button
        size="sm"
        variant="ghost"
        leadingIcon={<Download />}
        onClick={() => onDownload(doc.id, doc.fileName)}
      >
        Download
      </Button>
    </div>
  );
}
