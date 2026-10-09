import { useState } from 'react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Clock3, Pencil, Plus, Send, Trash2, Undo2 } from 'lucide-react';
import { Button, IconButton } from '../../components/ui/Button';
import { CellStack, DataTable } from '../../components/ui/DataTable';
import { ConfirmDialog } from '../../components/ui/Dialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { MetricCard, MetricRow } from '../../components/ui/MetricCard';
import { Panel } from '../../components/ui/Panel';
import { Pill, StatusPill } from '../../components/ui/Pill';
import { Skeleton } from '../../components/ui/Skeleton';
import { ApiRequestError } from '../../lib/api';
import { formatDisplayDate } from '../../lib/format';
import { EntryDialog } from './EntryDialog';
import { WeekGrid } from './WeekGrid';
import {
  addDaysIso,
  formatCell,
  formatHoursMinutes,
  useDeleteEntry,
  useRecallWeek,
  useSubmitWeek,
  useWeek,
  weekLabel,
  type TimeEntryRow,
  type WeekData,
} from './useTime';

/** What the status means for the person looking at their own week. */
export function StatusNote({ week }: { week: WeekData }) {
  const sheet = week.timesheet;
  const last = sheet?.approvals.at(-1);
  switch (week.status) {
    case 'SUBMITTED':
      return <>Waiting for approval. You can withdraw it to make changes.</>;
    case 'APPROVED':
      return (
        <>
          Approved{last?.approver ? ` by ${last.approver}` : ''} and locked. If something is wrong,
          ask for it to be reopened.
        </>
      );
    case 'REJECTED':
      return (
        <>
          Sent back{last?.approver ? ` by ${last.approver}` : ''}
          {last?.comment ? `: “${last.comment}”` : ''}. Fix it and submit again.
        </>
      );
    case 'REOPENED':
      return (
        <>
          Reopened{sheet?.reopenReason ? `: “${sheet.reopenReason}”` : ''}. Make the correction and
          submit again.
        </>
      );
    default:
      return <>Not submitted yet. Log your time, then submit the week for approval.</>;
  }
}

/** Your week: the grid, what is in it, and sending it for approval. */
export function MyWeekTab({
  weekStart,
  onWeekChange,
}: {
  weekStart: string | undefined;
  onWeekChange: (weekStart: string | undefined) => void;
}) {
  const { data: week, isLoading } = useWeek(weekStart);
  const submit = useSubmitWeek();
  const recall = useRecallWeek();
  const remove = useDeleteEntry();
  const [logging, setLogging] = useState(false);
  const [editing, setEditing] = useState<TimeEntryRow | null>(null);
  const [deleting, setDeleting] = useState<TimeEntryRow | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);

  if (isLoading || !week) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const thisWeek = addDaysIso(
    week.today,
    -((new Date(`${week.today}T00:00:00Z`).getUTCDay() + 6) % 7),
  );
  const isCurrent = week.weekStart === thisWeek;
  const nextDisabled = week.weekStart >= thisWeek;

  async function doSubmit() {
    try {
      await submit.mutateAsync(week!.weekStart);
      toast.success('Timesheet submitted for approval');
      setConfirmSubmit(false);
    } catch (error) {
      setConfirmSubmit(false);
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not submit.');
    }
  }

  async function doRecall() {
    try {
      await recall.mutateAsync(week!.timesheet!.id);
      toast.success('Withdrawn — you can edit the week again');
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not withdraw.');
    }
  }

  async function doDelete() {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      toast.success('Entry deleted');
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not delete.');
    } finally {
      setDeleting(null);
    }
  }

  const columns: ColumnDef<TimeEntryRow, unknown>[] = [
    {
      header: 'Day',
      id: 'day',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="whitespace-nowrap">{formatDisplayDate(row.original.workDate)}</span>
      ),
    },
    {
      header: 'Project · task',
      id: 'project',
      enableSorting: false,
      meta: { className: 'w-[30%] max-w-0' },
      cell: ({ row }) => (
        <CellStack
          title={row.original.project.projectCode}
          subtitle={row.original.task?.title ?? 'No task'}
        />
      ),
    },
    {
      header: 'Hours',
      id: 'hours',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatHoursMinutes(row.original.hours)}
        </span>
      ),
    },
    {
      header: 'Type',
      id: 'type',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.source === 'TIMER' && (
            <Pill tone="blue" icon={<Clock3 />}>
              Timer
            </Pill>
          )}
          {!row.original.isBillable && <Pill tone="gray">Non-billable</Pill>}
        </div>
      ),
    },
    {
      header: 'Note',
      id: 'note',
      enableSorting: false,
      meta: { className: 'w-[26%] max-w-0' },
      cell: ({ row }) => <CellStack title={row.original.description ?? '—'} />,
    },
    {
      header: '',
      id: 'actions',
      enableSorting: false,
      cell: ({ row }) =>
        week.canEdit && !row.original.isLocked ? (
          <div className="flex justify-end gap-1">
            <IconButton
              label="Change entry"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(row.original)}
            >
              <Pencil />
            </IconButton>
            <IconButton
              label="Delete entry"
              size="sm"
              variant="ghost"
              onClick={() => setDeleting(row.original)}
            >
              <Trash2 />
            </IconButton>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      <MetricRow>
        <MetricCard
          label="This week"
          value={formatCell(week.totals.total) || '0'}
          foot={formatHoursMinutes(week.totals.total)}
        />
        <MetricCard
          label="Billable"
          value={formatCell(week.totals.billable) || '0'}
          foot={`${formatCell(week.totals.nonBillable) || '0'} non-billable`}
        />
        <MetricCard
          label="Status"
          value={<StatusPill status={week.status} />}
          foot={
            week.timesheet?.submittedAt
              ? `Submitted ${formatDisplayDate(week.timesheet.submittedAt)}`
              : 'Not submitted'
          }
        />
        <MetricCard
          label="Timer"
          value={week.running ? 'Running' : 'Idle'}
          state={week.running ? 'good' : 'neutral'}
          foot={
            week.running
              ? `${week.running.project.projectCode} · ${week.running.task?.title ?? 'No task'}`
              : 'Start one from the top bar'
          }
        />
      </MetricRow>

      <Panel
        flush
        title={weekLabel(week.weekStart, week.weekEnd)}
        subtitle={<StatusNote week={week} />}
        bodyClassName="mt-1"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <IconButton
              label="Previous week"
              onClick={() => onWeekChange(addDaysIso(week.weekStart, -7))}
            >
              <ChevronLeft />
            </IconButton>
            <Button
              size="sm"
              variant="ghost"
              disabled={isCurrent}
              onClick={() => onWeekChange(undefined)}
            >
              This week
            </Button>
            <IconButton
              label="Next week"
              disabled={nextDisabled}
              onClick={() => onWeekChange(addDaysIso(week.weekStart, 7))}
            >
              <ChevronRight />
            </IconButton>
            {week.canRecall && (
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<Undo2 />}
                loading={recall.isPending}
                onClick={doRecall}
              >
                Withdraw
              </Button>
            )}
            {week.canEdit && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={<Plus />}
                  onClick={() => setLogging(true)}
                >
                  Log time
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  leadingIcon={<Send />}
                  disabled={!week.canSubmit}
                  onClick={() => setConfirmSubmit(true)}
                >
                  Submit week
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="border-t border-line">
          <WeekGrid week={week} />
        </div>
      </Panel>

      <Panel
        flush
        title="Entries this week"
        subtitle="Each piece of time behind the grid, including timer entries."
        bodyClassName="mt-1"
      >
        <DataTable
          data={week.entries}
          columns={columns}
          minWidth={760}
          getRowId={(row) => row.id}
          empty={
            <EmptyState
              icon={<Clock3 />}
              title="No time yet"
              description="Run the timer or log time by hand, and it appears here."
            />
          }
        />
      </Panel>

      {(logging || editing) && (
        <EntryDialog
          entry={editing ?? undefined}
          defaultDate={
            week.today >= week.weekStart && week.today <= week.weekEnd ? week.today : week.weekEnd
          }
          today={week.today}
          onClose={() => {
            setLogging(false);
            setEditing(null);
          }}
        />
      )}
      <ConfirmDialog
        open={confirmSubmit}
        title="Submit this week?"
        description={`${formatHoursMinutes(week.totals.total)} for ${weekLabel(week.weekStart, week.weekEnd)} goes to your approver. You can withdraw it until it is decided.`}
        confirmLabel="Submit"
        loading={submit.isPending}
        onConfirm={doSubmit}
        onClose={() => setConfirmSubmit(false)}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete this entry?"
        description={
          deleting
            ? `${formatHoursMinutes(deleting.hours)} on ${deleting.project.projectCode}, ${formatDisplayDate(deleting.workDate)}.`
            : ''
        }
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={doDelete}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
