import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Clock3, Lock, Plus } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { SelectField } from '../../components/ui/Field';
import { cn } from '../../lib/cn';
import { ApiRequestError } from '../../lib/api';
import {
  formatCell,
  formatHoursMinutes,
  parseHoursInput,
  useSetCell,
  useTimeProjects,
  useTimeTasks,
  type GridRow,
  type WeekData,
} from './useTime';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface PendingRow {
  key: string;
  project: GridRow['project'];
  task: GridRow['task'];
  isBillable: boolean;
}

const rowKey = (projectId: string, taskId: string | null, billable: boolean) =>
  `${projectId}|${taskId ?? ''}|${billable ? 'B' : 'N'}`;

/**
 * The weekly grid: days across, project/task rows down. Type a number, press
 * Enter or leave the cell, and it saves. "7.5", "1:30" and "90m" all work.
 */
export function WeekGrid({ week, readOnly = false }: { week: WeekData; readOnly?: boolean }) {
  const setCell = useSetCell();
  const editable = week.canEdit && !readOnly;
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [adding, setAdding] = useState(false);

  // New rows belong to one week; start clean when the week changes.
  useEffect(() => {
    setPending([]);
    setAdding(false);
  }, [week.weekStart, week.employee.id]);

  const rows = useMemo(() => {
    const known = new Set(week.rows.map((r) => r.key));
    const extra = pending
      .filter((p) => !known.has(p.key))
      .map<GridRow>((p) => ({ ...p, cells: {}, total: 0 }));
    return [...week.rows, ...extra];
  }, [week.rows, pending]);

  async function commit(row: GridRow, date: string, raw: string, previous: number) {
    const hours = parseHoursInput(raw);
    if (hours === null || hours < 0 || hours > 24) {
      toast.error('Enter hours like 7.5, 1:30 or 90m (up to 24).');
      return false;
    }
    const rounded = Math.round(hours * 100) / 100;
    if (rounded === previous) return true;
    try {
      await setCell.mutateAsync({
        projectId: row.project.id,
        taskId: row.task?.id ?? null,
        workDate: date,
        isBillable: row.isBillable,
        hours: rounded,
      });
      return true;
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not save that.');
      return false;
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-body">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-left">
            <th className="sticky left-0 z-10 w-[26%] bg-surface-2 px-4 py-2.5 text-micro font-heavy uppercase text-muted">
              Project · task
            </th>
            {week.days.map((day, i) => (
              <th
                key={day.date}
                className={cn(
                  'px-1.5 py-2 text-center text-micro font-heavy uppercase',
                  day.date === week.today ? 'text-blue' : 'text-muted',
                )}
                title={day.label ?? undefined}
              >
                <span className="block">{DAY_NAMES[i]}</span>
                <span className="block text-ink-2 normal-case tabular-nums">
                  {Number(day.date.slice(8))}
                </span>
                {day.dayType !== 'WORKING' && (
                  <span className="mt-0.5 block text-[9px] font-heavy normal-case text-muted-2">
                    {day.dayType === 'WEEKLY_OFF'
                      ? 'Off'
                      : day.dayType === 'HOLIDAY'
                        ? 'Holiday'
                        : 'Leave'}
                  </span>
                )}
              </th>
            ))}
            <th className="px-3 py-2.5 text-right text-micro font-heavy uppercase text-muted">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-8 text-center text-body text-muted">
                {editable
                  ? 'Nothing logged this week. Add a row, or start the timer.'
                  : 'Nothing was logged this week.'}
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-line last:border-0">
              <td className="sticky left-0 z-10 max-w-0 bg-surface px-4 py-2">
                <p className="truncate font-heavy text-ink">{row.project.projectCode}</p>
                <p className="truncate text-sub text-muted">
                  {row.task?.title ?? 'No task'}
                  {!row.isBillable && ' · non-billable'}
                </p>
              </td>
              {week.days.map((day) => {
                const cell = row.cells[day.date];
                const locked = !!cell?.locked;
                const blocked = !editable || day.isFuture || cell?.hasTimer || locked;
                return (
                  <td
                    key={day.date}
                    className={cn(
                      'px-1 py-1.5 text-center',
                      day.dayType !== 'WORKING' && 'bg-surface-2/70',
                    )}
                  >
                    <CellInput
                      value={cell?.hours ?? 0}
                      disabled={blocked}
                      title={
                        cell?.hasTimer
                          ? 'This came from the timer. Change it in the entries list below.'
                          : locked
                            ? 'Approved and locked'
                            : day.isFuture
                              ? 'That day has not happened yet'
                              : undefined
                      }
                      icon={cell?.hasTimer ? <Clock3 /> : locked ? <Lock /> : null}
                      label={`${row.project.projectCode} ${row.task?.title ?? ''} on ${day.date}`}
                      onCommit={(raw) => commit(row, day.date, raw, cell?.hours ?? 0)}
                    />
                  </td>
                );
              })}
              <td className="px-3 py-2 text-right font-heavy tabular-nums text-ink">
                {formatCell(row.total) || '—'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line bg-surface-2">
            <td className="sticky left-0 bg-surface-2 px-4 py-2.5 text-micro font-heavy uppercase text-muted">
              Day total
            </td>
            {week.days.map((day) => (
              <td
                key={day.date}
                className={cn(
                  'px-1 py-2.5 text-center text-sub font-heavy tabular-nums',
                  day.total > 12 ? 'text-amber' : 'text-ink-2',
                )}
              >
                {formatCell(day.total) || '·'}
              </td>
            ))}
            <td className="px-3 py-2.5 text-right font-black tabular-nums text-ink">
              {formatCell(week.totals.total) || '0'}
              <span className="ml-1 text-micro font-heavy text-muted">
                ({formatHoursMinutes(week.totals.total)})
              </span>
            </td>
          </tr>
        </tfoot>
      </table>

      {editable && (
        <div className="border-t border-line px-4 py-3">
          {!adding ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<Plus />}
                onClick={() => setAdding(true)}
              >
                Add a row
              </Button>
              {week.rows.length === 0 && week.suggestions.length > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setPending(
                      week.suggestions.map((s) => ({
                        key: rowKey(s.project.id, s.task?.id ?? null, s.isBillable),
                        project: s.project,
                        task: s.task,
                        isBillable: s.isBillable,
                      })),
                    )
                  }
                >
                  Copy last week’s rows
                </Button>
              )}
            </div>
          ) : (
            <AddRow
              onAdd={(row) => {
                setPending((p) => [...p, row]);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function CellInput({
  value,
  disabled,
  title,
  icon,
  label,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  title?: string;
  icon: React.ReactNode;
  label: string;
  onCommit: (raw: string) => Promise<boolean>;
}) {
  const [text, setText] = useState(formatCell(value));
  const [saving, setSaving] = useState(false);

  // Follow the server whenever it changes (after a save, a timer stop, a refetch).
  useEffect(() => setText(formatCell(value)), [value]);

  async function done() {
    if (text.trim() === formatCell(value)) return;
    setSaving(true);
    const ok = await onCommit(text);
    setSaving(false);
    if (!ok) setText(formatCell(value));
  }

  return (
    <div className="relative mx-auto w-14" title={title}>
      <input
        aria-label={label}
        inputMode="decimal"
        value={text}
        disabled={disabled || saving}
        placeholder="·"
        onChange={(event) => setText(event.target.value)}
        onBlur={done}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          if (event.key === 'Escape') {
            setText(formatCell(value));
            (event.target as HTMLInputElement).blur();
          }
        }}
        className={cn(
          'h-9 w-full rounded-control border bg-surface px-1 text-center text-body tabular-nums text-ink transition-colors',
          'placeholder:text-muted-2 focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/20',
          disabled
            ? 'cursor-not-allowed border-transparent bg-transparent'
            : 'border-line hover:border-blue-2/50',
          saving && 'opacity-60',
        )}
      />
      {icon && (
        <span
          aria-hidden
          className="pointer-events-none absolute -right-0.5 -top-1 text-muted [&>svg]:size-3"
        >
          {icon}
        </span>
      )}
    </div>
  );
}

function AddRow({ onAdd, onCancel }: { onAdd: (row: PendingRow) => void; onCancel: () => void }) {
  const { data: projects } = useTimeProjects();
  const [projectId, setProjectId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [billable, setBillable] = useState(true);
  const { data: tasks } = useTimeTasks(projectId || undefined);

  function add() {
    const project = projects?.find((p) => p.id === projectId);
    if (!project) return;
    const task = tasks?.find((t) => t.id === taskId);
    onAdd({
      key: rowKey(project.id, task?.id ?? null, billable),
      project,
      task: task ? { id: task.id, title: task.title } : null,
      isBillable: billable,
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2.5">
      <SelectField
        label="Project"
        srOnlyLabel
        containerClassName="w-60"
        value={projectId}
        onChange={(event) => {
          setProjectId(event.target.value);
          setTaskId('');
        }}
        options={[
          { value: '', label: 'Project…' },
          ...(projects ?? []).map((p) => ({ value: p.id, label: `${p.projectCode} · ${p.name}` })),
        ]}
      />
      <SelectField
        label="Task"
        srOnlyLabel
        containerClassName="w-60"
        value={taskId}
        disabled={!projectId}
        onChange={(event) => setTaskId(event.target.value)}
        options={[
          { value: '', label: 'No task' },
          ...(tasks ?? []).map((t) => ({
            value: t.id,
            label: `${t.assignedToMe ? '★ ' : ''}${t.title}`,
          })),
        ]}
      />
      <label className="flex h-10 items-center gap-2 text-body text-ink-2">
        <input
          type="checkbox"
          className="size-4 accent-blue"
          checked={billable}
          onChange={(event) => setBillable(event.target.checked)}
        />
        Billable
      </label>
      <Button size="sm" variant="primary" disabled={!projectId} onClick={add}>
        Add
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
