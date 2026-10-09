import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Building2,
  CalendarOff,
  Clock,
  LogIn,
  LogOut,
  Smartphone,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { ApiRequestError } from '../../lib/api';
import { formatDisplayDate } from '../../lib/format';
import { AttendancePill, FlagPill } from './badges';
import { PunchDialog } from './PunchDialog';
import {
  formatMinutes,
  SOURCE_LABEL,
  timeIn,
  useMyToday,
  usePunchOffice,
  type MyToday,
} from './useAttendance';

/** Re-renders on an interval, so "2h 14m so far" keeps moving without a refetch. */
function useTick(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

/**
 * The clock-in card: where today stands and the one thing to do next.
 *
 * It offers only the ways this person is allowed to punch, says why when a
 * way is unavailable (not on the office network), and explains a day off
 * instead of leaving a button that cannot work.
 */
export function ClockCard() {
  const { data: today, isLoading, error, refetch } = useMyToday();
  const [phoneOpen, setPhoneOpen] = useState(false);
  const officePunch = usePunchOffice();
  const now = useTick();

  if (isLoading) return <Skeleton className="h-44 w-full rounded-panel" />;

  if (error || !today) {
    // A login with no employee record has nothing to clock.
    const hidden = error instanceof ApiRequestError && error.status === 403;
    if (hidden) return null;
    return (
      <div className="rounded-panel border border-line bg-surface p-4 text-sub text-muted shadow-card">
        Could not load today’s attendance.{' '}
        <button type="button" className="font-heavy text-blue" onClick={() => void refetch()}>
          Try again
        </button>
      </div>
    );
  }

  const tz = today.office.timezone;
  const liveMinutes = today.clockedInSince
    ? today.workedMinutes +
      Math.max(0, Math.round((now - Date.parse(today.clockedInSince)) / 60_000))
    : today.workedMinutes;

  async function punchOffice() {
    try {
      const result = await officePunch.mutateAsync();
      const at = timeIn(result.punch.punchedAt, tz);
      toast.success(result.punch.type === 'IN' ? `Clocked in at ${at}` : `Clocked out at ${at}`);
    } catch (error) {
      toast.error(
        error instanceof ApiRequestError ? error.message : 'Could not record the punch. Try again.',
      );
    }
  }

  const acting = today.nextAction === 'IN' ? 'Clock in' : 'Clock out';
  const ActIcon = today.nextAction === 'IN' ? LogIn : LogOut;
  const dayOff = today.dayType !== 'WORKING';

  return (
    <section
      aria-label="Today’s attendance"
      className="overflow-hidden rounded-panel bg-timer-gradient p-5 text-white shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-micro font-heavy uppercase text-white/60">
            {formatDisplayDate(today.date)} · {today.office.shortCode}
          </p>
          <h2 className="mt-1 text-[26px] font-black leading-tight">
            {today.clockedIn
              ? `Clocked in since ${timeIn(today.clockedInSince, tz)}`
              : today.firstInAt
                ? `Done for the day · ${formatMinutes(today.workedMinutes)}`
                : dayOff
                  ? 'No work scheduled today'
                  : 'Not clocked in yet'}
          </h2>
          <p className="mt-1.5 text-sub text-white/70">
            {today.clockedIn && <>{formatMinutes(liveMinutes)} so far · </>}
            {today.shift
              ? `Shift ${today.shift.startTime}–${today.shift.endTime}${today.shift.crossesMidnight ? ' (overnight)' : ''}`
              : 'No shift assigned'}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <AttendancePill status={today.status} />
            {today.isLate && (
              <span className="rounded-full bg-white/15 px-2 py-1 text-pill font-heavy">
                {today.lateMinutes} min late
              </span>
            )}
            {today.punches.some((p) => p.isFlagged) && (
              <FlagPill reason={today.punches.find((p) => p.isFlagged)?.flagReason} />
            )}
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          {today.methods.mobile && (
            <Button
              variant="primary"
              size="lg"
              leadingIcon={<Smartphone />}
              className="bg-white text-ink hover:bg-white/90"
              onClick={() => setPhoneOpen(true)}
            >
              {acting} from phone
            </Button>
          )}
          {today.methods.office && (
            <Button
              variant={today.methods.mobile ? 'ghost' : 'primary'}
              size="lg"
              leadingIcon={<ActIcon />}
              loading={officePunch.isPending}
              disabled={!today.network.allowed}
              onClick={punchOffice}
              className={
                today.methods.mobile
                  ? 'border-white/25 bg-white/10 text-white hover:bg-white/20'
                  : 'bg-white text-ink hover:bg-white/90'
              }
            >
              {acting} at the office
            </Button>
          )}
          {today.methods.office && (
            <p className="flex items-center gap-1.5 text-micro tracking-normal text-white/70 sm:justify-end">
              {today.network.allowed ? (
                <>
                  <Wifi aria-hidden className="size-3.5" /> On the {today.office.shortCode} office
                  network
                </>
              ) : (
                <>
                  <WifiOff aria-hidden className="size-3.5" /> Not on the office network
                  {today.network.ip ? ` (${today.network.ip})` : ''}
                </>
              )}
            </p>
          )}
          {!today.methods.mobile && !today.methods.office && (
            <p className="max-w-[16rem] text-sub text-white/70">
              {today.office.requiresGps
                ? `${today.office.name} needs a GPS punch from a phone, which your profile does not allow. Ask HR.`
                : 'Your profile has no way to punch. Ask HR.'}
            </p>
          )}
        </div>
      </div>

      {dayOff && (
        <p className="mt-4 flex items-center gap-2 rounded-card bg-white/10 px-3 py-2 text-sub">
          <CalendarOff aria-hidden className="size-4 shrink-0" />
          {today.dayType === 'WEEKLY_OFF' && 'Today is your weekly off.'}
          {today.dayType === 'HOLIDAY' &&
            `Today is a holiday${today.holidayName ? ` — ${today.holidayName}` : ''}.`}
          {today.dayType === 'LEAVE' && 'You are on approved leave today.'} Punching in is still
          possible if you are working.
        </p>
      )}

      {today.punches.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {today.punches.map((p) => (
            <li
              key={p.id}
              title={p.flagReason ?? SOURCE_LABEL[p.source]}
              className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-pill font-heavy"
            >
              {p.type === 'IN' ? (
                <LogIn aria-hidden className="size-3" />
              ) : (
                <LogOut aria-hidden className="size-3" />
              )}
              {timeIn(p.punchedAt, tz)}
              <span className="font-normal text-white/60">
                {p.source === 'OFFICE_IP' ? (
                  <Building2 aria-hidden className="inline size-3" />
                ) : p.source === 'MOBILE_GPS' ? (
                  <Smartphone aria-hidden className="inline size-3" />
                ) : (
                  <Clock aria-hidden className="inline size-3" />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {phoneOpen && <PunchDialog today={today as MyToday} onClose={() => setPhoneOpen(false)} />}
    </section>
  );
}
