import { AlertTriangle, Clock, Mail, Phone } from 'lucide-react';
import { Pill } from '../../components/ui/Pill';
import type { BookingListItem } from './useBookings';

/**
 * How the client confirmed, plus the two reminders a verbal booking can carry.
 *
 * "Email pending" is amber (waiting); once the grace period has passed it turns
 * red and says how late it is. Neither blocks anything — they only nudge.
 */
export function ConfirmationBadges({
  booking,
}: {
  booking: Pick<BookingListItem, 'confirmation' | 'emailPending' | 'emailOverdueDays'>;
}) {
  const { confirmation } = booking;
  if (!confirmation) return <span className="text-muted">Not confirmed</span>;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Pill
        tone={confirmation.type === 'EMAIL' ? 'blue' : 'violet'}
        icon={confirmation.type === 'EMAIL' ? <Mail /> : <Phone />}
      >
        {confirmation.type === 'EMAIL' ? 'Email' : 'Verbal'}
      </Pill>
      {booking.emailPending && booking.emailOverdueDays === null && (
        <Pill tone="amber" icon={<Clock />}>
          Email pending
        </Pill>
      )}
      {booking.emailPending && booking.emailOverdueDays !== null && (
        <Pill tone="red" icon={<AlertTriangle />}>
          Email overdue · {booking.emailOverdueDays}d
        </Pill>
      )}
    </div>
  );
}

export const BILLING_LABEL = {
  FIXED: 'Fixed price',
  HOURLY: 'Hourly',
  MILESTONE: 'Milestone',
} as const;
