import { useNavigate } from 'react-router-dom';
import { ExternalLink, Mail, Phone } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Panel } from '../../components/ui/Panel';
import { Pill } from '../../components/ui/Pill';
import { BOOKING_LIFECYCLE, Stepper } from '../../components/ui/Stepper';
import { formatDisplayDate } from '../../lib/format';
import { useAuth } from '../../providers/AuthProvider';
import type { ProjectDetail } from './useProjects';

/** Where the project came from, and what the client said when they agreed. */
export function BookingTab({ project }: { project: ProjectDetail }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { booking } = project;
  const confirmation = booking.confirmation;

  return (
    <div className="space-y-5">
      <Panel
        title="Lifecycle"
        subtitle="Booking → Confirmation → Project Code → Project Created → Scheduled"
      >
        <Stepper steps={BOOKING_LIFECYCLE} currentIndex={project.scheduled ? 5 : 4} />
      </Panel>

      <Panel
        title="Booking"
        action={
          can('booking.view') && (
            <Button
              size="sm"
              variant="ghost"
              trailingIcon={<ExternalLink />}
              onClick={() => navigate(`/bookings?open=${booking.id}`)}
            >
              Open booking
            </Button>
          )
        }
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {[
            ['Booking number', booking.bookingNumber],
            ['Booked on', formatDisplayDate(booking.bookingDate)],
            ['Confirmed', booking.confirmedAt ? formatDisplayDate(booking.confirmedAt) : '—'],
            ['Project code', project.projectCode],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-micro font-heavy uppercase text-muted">{label}</dt>
              <dd className="mt-0.5 text-body text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        {booking.scopeDescription && (
          <p className="mt-4 whitespace-pre-line rounded-card bg-surface-2 p-3 text-sub text-ink-2">
            {booking.scopeDescription}
          </p>
        )}
      </Panel>

      <Panel title="Client confirmation">
        {!confirmation ? (
          <p className="text-sub text-muted">No confirmation on record.</p>
        ) : confirmation.type === 'EMAIL' ? (
          <div className="space-y-2">
            <Pill tone="blue" icon={<Mail />}>
              Email
            </Pill>
            <p className="text-body text-ink">
              Received{' '}
              {confirmation.emailReceivedAt ? formatDisplayDate(confirmation.emailReceivedAt) : '—'}
              {confirmation.poNumber ? ` · PO ${confirmation.poNumber}` : ''}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Pill tone="violet" icon={<Phone />}>
                Verbal
              </Pill>
              {!confirmation.emailDocumentId && <Pill tone="amber">Email pending</Pill>}
            </div>
            <p className="text-body text-ink">
              {confirmation.confirmedByName} ·{' '}
              {confirmation.confirmedOn ? formatDisplayDate(confirmation.confirmedOn) : '—'} ·{' '}
              {confirmation.verbalMode === 'MEETING' ? 'meeting' : 'phone call'}
            </p>
            <p className="whitespace-pre-line rounded-card bg-surface-2 p-3 text-sub text-ink-2">
              {confirmation.verbalSummary}
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}
