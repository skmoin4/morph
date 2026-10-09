import { useEffect, useState } from 'react';
import { Building2, MapPin, Smartphone, PenLine, ImageOff } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Drawer } from '../../components/ui/Drawer';
import { Pill } from '../../components/ui/Pill';
import { Skeleton } from '../../components/ui/Skeleton';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatDisplayDate } from '../../lib/format';
import { useAuth } from '../../providers/AuthProvider';
import { AttendancePill, FlagPill } from './badges';
import { CorrectionDialog } from './CorrectionDialog';
import { formatMinutes, SOURCE_LABEL, timeIn, useDayDetail, type DayDetail } from './useAttendance';

/** A selfie is fetched with the bearer token, so it cannot be a plain <img src>. */
function Selfie({ punchId }: { punchId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    api
      .blob(`/attendance/punches/${punchId}/selfie`)
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => setFailed(true));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [punchId]);

  if (failed) {
    return (
      <span
        className="grid size-14 place-items-center rounded-card bg-surface-2 text-muted"
        title="Photo unavailable"
      >
        <ImageOff aria-hidden className="size-5" />
      </span>
    );
  }
  return url ? (
    <img
      src={url}
      alt="Selfie taken at this punch"
      className="size-14 rounded-card border border-line object-cover"
    />
  ) : (
    <Skeleton className="size-14 rounded-card" />
  );
}

/** One person's day in full: what was recorded, where from, and how it was judged. */
export function DayDrawer({
  employeeId,
  date,
  onClose,
}: {
  employeeId: string;
  date: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { data, isLoading } = useDayDetail(employeeId, date);
  const [correcting, setCorrecting] = useState(false);

  const mine = user?.employeeId === employeeId;
  const canRequest = mine && user !== null && user.permissions.includes('attendance.regularise');

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        width="lg"
        title={data ? data.employee.fullName : 'Attendance'}
        subtitle={
          data
            ? `${data.employee.employeeCode} · ${formatDisplayDate(date)}`
            : formatDisplayDate(date)
        }
        footer={
          canRequest ? (
            <Button leadingIcon={<PenLine />} onClick={() => setCorrecting(true)}>
              Request a correction
            </Button>
          ) : undefined
        }
      >
        {isLoading || !data ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <DayBody data={data} />
        )}
      </Drawer>
      {correcting && <CorrectionDialog defaultDate={date} onClose={() => setCorrecting(false)} />}
    </>
  );
}

function DayBody({ data }: { data: DayDetail }) {
  const tz = data.office.timezone;
  const { result } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <AttendancePill status={result.status} />
        {result.isLate && <Pill tone="amber">{result.lateMinutes} min late</Pill>}
        {result.isEarlyExit && <Pill tone="amber">Left {result.earlyExitMinutes} min early</Pill>}
        {result.overtimeMinutes > 0 && (
          <Pill tone="blue">{formatMinutes(result.overtimeMinutes)} overtime</Pill>
        )}
        {result.flagReason && <FlagPill reason={result.flagReason} />}
        {!result.final && <Pill tone="gray">Day still open</Pill>}
      </div>

      {data.dayType !== 'WORKING' && (
        <p className="rounded-card bg-surface-2 p-3 text-sub text-ink-2">
          {data.dayType === 'WEEKLY_OFF' && 'A weekly off at this office.'}
          {data.dayType === 'HOLIDAY' &&
            `A holiday${data.holidayName ? ` — ${data.holidayName}` : ''}.`}
          {data.dayType === 'LEAVE' && 'Approved leave.'}
        </p>
      )}

      {result.flagReason && (
        <p className="rounded-card border border-pill-amber-bg bg-pill-amber-bg/50 p-3 text-sub text-pill-amber-fg">
          {result.flagReason}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {[
          ['First in', timeIn(result.firstInAt, tz)],
          ['Last out', timeIn(result.lastOutAt, tz)],
          ['Paid hours', formatMinutes(result.workedMinutes)],
          ['At work', formatMinutes(result.presenceMinutes)],
          ['Break', formatMinutes(result.breakMinutes)],
          ['Day credit', String(result.dayValue)],
          ['Shift', data.shift ? `${data.shift.startTime}–${data.shift.endTime}` : 'None assigned'],
          ['Office', data.office.name],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-micro font-heavy uppercase text-muted">{label}</dt>
            <dd className="mt-0.5 text-body text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      <section>
        <h3 className="mb-2.5 text-title font-heavy text-ink">Punches</h3>
        {data.punches.length === 0 ? (
          <p className="text-sub text-muted">Nothing was recorded this day.</p>
        ) : (
          <ul className="space-y-2">
            {data.punches.map((punch) => (
              <li
                key={punch.id}
                className={cn(
                  'flex items-center gap-3 rounded-xl border border-line-soft bg-surface-2 p-3',
                  punch.superseded && 'opacity-60',
                )}
              >
                {punch.hasSelfie && <Selfie punchId={punch.id} />}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-body font-heavy text-ink">
                    {punch.type === 'IN' ? 'Clock in' : 'Clock out'} · {timeIn(punch.punchedAt, tz)}
                    {punch.superseded && <Pill tone="gray">Replaced by a correction</Pill>}
                    {punch.isFlagged && <FlagPill reason={punch.flagReason} />}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sub text-muted">
                    <span className="inline-flex items-center gap-1">
                      {punch.source === 'MOBILE_GPS' ? (
                        <Smartphone aria-hidden className="size-3.5" />
                      ) : punch.source === 'OFFICE_IP' ? (
                        <Building2 aria-hidden className="size-3.5" />
                      ) : (
                        <PenLine aria-hidden className="size-3.5" />
                      )}
                      {SOURCE_LABEL[punch.source]}
                    </span>
                    {punch.distanceM !== null && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin aria-hidden className="size-3.5" /> {punch.distanceM} m from the pin
                        {punch.accuracyM ? ` (±${punch.accuracyM} m)` : ''}
                      </span>
                    )}
                    {punch.ipAddress && <span>{punch.ipAddress}</span>}
                  </p>
                  {punch.note && <p className="mt-1 text-sub text-ink-2">{punch.note}</p>}
                  {punch.flagReason && (
                    <p className="mt-1 text-sub text-pill-amber-fg">{punch.flagReason}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.regularisations.length > 0 && (
        <section>
          <h3 className="mb-2.5 text-title font-heavy text-ink">Correction requests</h3>
          <ul className="space-y-2">
            {data.regularisations.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-line-soft bg-surface-2 p-3 text-sub"
              >
                <p className="font-heavy text-ink">
                  {r.requestedInTime ? `In ${r.requestedInTime}` : ''}
                  {r.requestedInTime && r.requestedOutTime ? ' · ' : ''}
                  {r.requestedOutTime ? `Out ${r.requestedOutTime}` : ''} —{' '}
                  <span className="capitalize">{r.status.toLowerCase()}</span>
                </p>
                <p className="mt-0.5 text-ink-2">{r.reason}</p>
                {r.decisionNote && <p className="mt-0.5 text-muted">Manager: {r.decisionNote}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-title font-heavy text-ink">How this day was judged</h3>
        <p className="text-sub text-muted">
          {data.policy.name}: on time until {data.policy.graceMinutes} min after the shift starts;
          half day from {data.policy.halfDayFromHours} h at work, full day from{' '}
          {data.policy.fullDayMinimumHours} h, overtime after {data.policy.overtimeAfterHours} h; an
          early exit is leaving more than {data.policy.earlyExitBeforeMinutes} min before the shift
          ends.
        </p>
      </section>
    </div>
  );
}
