import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Play, Square, X } from 'lucide-react';
import { Button, IconButton } from '../../components/ui/Button';
import { cn } from '../../lib/cn';
import { ApiRequestError } from '../../lib/api';
import { formatDuration } from '../../lib/format';
import { formatHoursMinutes, useDiscardTimer, useStopTimer, useTimer } from './useTime';

/**
 * The global timer in the top bar. It reads the server's state, so it is the
 * same after a reload or on another device; the seconds tick locally against
 * the server's clock.
 */
export function TimerControl({ onRequestStart }: { onRequestStart: () => void }) {
  const { data } = useTimer();
  const stop = useStopTimer();
  const discard = useDiscardTimer();
  const running = data?.running ?? null;
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  async function onStop() {
    try {
      const result = await stop.mutateAsync({});
      if (result.discarded) {
        toast.info(
          result.adjusted
            ? 'That day is already full (24 h), so the timer was not saved.'
            : 'Under a minute — the timer was not saved.',
        );
      } else if (result.entry) {
        toast.success(
          `Saved ${formatHoursMinutes(result.entry.hours)} to ${result.entry.project.projectCode}` +
            (result.capped ? ' (capped at 12 h — the timer ran very long)' : ''),
        );
      }
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not stop the timer.');
    }
  }

  async function onDiscard() {
    try {
      await discard.mutateAsync();
      toast.info('Timer discarded');
    } catch (error) {
      toast.error(
        error instanceof ApiRequestError ? error.message : 'Could not discard the timer.',
      );
    }
  }

  if (!running) {
    return (
      <Button
        variant="secondary"
        leadingIcon={<Play />}
        onClick={onRequestStart}
        aria-label="Start timer"
      >
        <span className="hidden sm:inline">Start timer</span>
      </Button>
    );
  }

  const seconds = Math.max(
    0,
    Math.floor(
      (Date.now() + (data?.offsetMs ?? 0) - new Date(running.startedAt!).getTime()) / 1000,
    ),
  );

  // A timer left running overnight is almost always a forgotten one.
  const overlong = seconds > 12 * 3600;

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-control border py-1 pl-2.5 pr-1',
        overlong ? 'border-amber/50 bg-pill-amber-bg' : 'border-line bg-surface-2',
      )}
      title={
        overlong
          ? 'This timer has run over 12 hours. Stopping it saves at most 12 hours; discard it if it was forgotten.'
          : undefined
      }
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 animate-pulse rounded-full',
          overlong ? 'bg-amber' : 'bg-green',
        )}
      />
      <Link to="/timesheets" className="min-w-0 leading-tight" title="Open my timesheet">
        <p className="text-micro font-heavy tabular-nums text-ink">{formatDuration(seconds)}</p>
        <p className="hidden max-w-[150px] truncate text-[10px] text-muted sm:block">
          {running.project.projectCode} · {running.task?.title ?? 'No task'}
        </p>
      </Link>
      <IconButton
        label="Stop timer"
        onClick={onStop}
        size="sm"
        variant="ghost"
        disabled={stop.isPending}
      >
        <Square />
      </IconButton>
      <IconButton
        label="Discard timer"
        onClick={onDiscard}
        size="sm"
        variant="ghost"
        disabled={discard.isPending}
      >
        <X />
      </IconButton>
    </div>
  );
}
