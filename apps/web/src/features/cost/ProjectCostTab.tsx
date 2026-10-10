import { useState } from 'react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, Download, Plus, RotateCcw } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { CellStack, DataTable } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField, TextAreaField, TextField } from '../../components/ui/Field';
import { MetricCard, MetricRow } from '../../components/ui/MetricCard';
import { Panel } from '../../components/ui/Panel';
import { Pill } from '../../components/ui/Pill';
import { Progress } from '../../components/ui/Progress';
import { Skeleton } from '../../components/ui/Skeleton';
import { api, ApiRequestError } from '../../lib/api';
import { formatDisplayDate } from '../../lib/format';
import { cn } from '../../lib/cn';
import { useAuth } from '../../providers/AuthProvider';
import { BurnChart } from './BurnChart';
import {
  describeRate,
  formatHoursPlain,
  formatSigned,
  levelTone,
  useAddAdjustment,
  useCostSummary,
  useLedger,
  useReverseEntry,
  type LedgerRow,
} from './useCost';

const SOURCE_FILTER = [
  { value: '', label: 'All postings' },
  { value: 'TIMESHEET', label: 'Timesheets' },
  { value: 'EXPENSE', label: 'Expenses' },
  { value: 'ADJUSTMENT', label: 'Adjustments' },
];

/** Project 360 → Cost ledger: budget vs actual, the burn curve, and every posting. */
export function ProjectCostTab({ projectId }: { projectId: string }) {
  const { can } = useAuth();
  const { data: summary, isLoading } = useCostSummary(projectId);
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);
  const { data: ledger, isLoading: loadingLedger } = useLedger(projectId, {
    sourceType: source || undefined,
    page,
  });
  const [adjusting, setAdjusting] = useState(false);
  const [reversing, setReversing] = useState<LedgerRow | null>(null);

  if (isLoading || !summary) return <Skeleton className="h-64 w-full" />;
  const today = new Date().toISOString().slice(0, 10);
  const tone = levelTone(summary.alertLevel);

  async function exportSheet() {
    try {
      await api.download(
        `/cost/projects/${projectId}/export`,
        `cost-ledger-${summary!.project.projectCode}.xlsx`,
      );
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not export.');
    }
  }

  const columns: ColumnDef<LedgerRow, unknown>[] = [
    {
      header: 'Posted',
      id: 'date',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="whitespace-nowrap">{formatDisplayDate(row.original.postingDate)}</span>
      ),
    },
    {
      header: 'Source',
      id: 'source',
      enableSorting: false,
      meta: { className: 'w-[28%] max-w-0' },
      cell: ({ row }) => (
        <CellStack
          title={row.original.sourceLabel}
          subtitle={
            [row.original.employee?.fullName, row.original.description]
              .filter(Boolean)
              .join(' · ') || undefined
          }
        />
      ),
    },
    {
      header: 'Hours',
      id: 'hours',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="whitespace-nowrap tabular-nums">
          {row.original.hours === null ? '—' : formatHoursPlain(row.original.hours)}
        </span>
      ),
    },
    {
      header: 'Rate',
      id: 'rate',
      enableSorting: false,
      cell: ({ row }) => {
        const why = describeRate(row.original);
        return (
          <span className="whitespace-nowrap tabular-nums" title={why ?? undefined}>
            {row.original.rateApplied !== null
              ? `₹ ${row.original.rateApplied.toLocaleString('en-IN')}/h`
              : row.original.rateBreakdown
                ? 'Mixed'
                : '—'}
          </span>
        );
      },
    },
    {
      header: 'Amount',
      id: 'amount',
      enableSorting: false,
      cell: ({ row }) => (
        <span
          className={cn(
            'whitespace-nowrap font-heavy tabular-nums',
            Number(row.original.amount) < 0 ? 'text-red' : 'text-ink',
          )}
        >
          {formatSigned(row.original.amount)}
        </span>
      ),
    },
    {
      header: 'Note',
      id: 'flags',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.postingVersion > 1 && (
            <Pill tone="blue">v{row.original.postingVersion}</Pill>
          )}
          {row.original.isReversal && <Pill tone="red">Reversal</Pill>}
          {row.original.reversed && <Pill tone="gray">Reversed</Pill>}
        </div>
      ),
    },
    {
      header: '',
      id: 'actions',
      enableSorting: false,
      cell: ({ row }) =>
        row.original.canReverse ? (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<RotateCcw />}
              onClick={() => setReversing(row.original)}
            >
              Reverse
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      {!summary.reconciled && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-card border border-red/40 bg-pill-red-bg p-3.5 text-sub text-pill-red-fg"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-heavy">The project’s totals do not match the ledger</p>
            {summary.drift.map((line) => (
              <p key={line}>{line}</p>
            ))}
            <p className="mt-1">
              The ledger is the record. Tell your administrator so the totals can be corrected.
            </p>
          </div>
        </div>
      )}

      <MetricRow>
        <MetricCard
          label="Hours burn"
          value={summary.burnPercent === null ? '—' : `${summary.burnPercent}%`}
          state={tone === 'bad' ? 'bad' : tone === 'warn' ? 'warn' : 'neutral'}
          foot={`${formatHoursPlain(summary.actualHours)} of ${formatHoursPlain(summary.budgetHours)}${summary.hoursRemaining < 0 ? ` · ${formatHoursPlain(-summary.hoursRemaining)} over` : ''}`}
        />
        <MetricCard
          label="Labour cost"
          value={formatSigned(summary.actualLabourCost)}
          foot={
            summary.costPerHour
              ? `₹ ${Number(summary.costPerHour).toLocaleString('en-IN')} per hour on average`
              : 'No labour posted'
          }
        />
        <MetricCard
          label="Expenses"
          value={formatSigned(summary.actualExpenseCost)}
          foot="Approved claims and adjustments"
        />
        <MetricCard
          label="Total cost"
          value={formatSigned(summary.actualTotalCost)}
          foot="Everything posted to date"
        />
        {summary.marginPercent !== undefined &&
          summary.marginPercent !== null &&
          Number(summary.actualTotalCost) > 0 && (
            <MetricCard
              label="Margin"
              value={`${summary.marginPercent}%`}
              state={summary.marginPercent < 0 ? 'bad' : 'good'}
              foot={
                summary.marginAmount !== undefined
                  ? `${formatSigned(summary.marginAmount)} of ${formatSigned(summary.projectValue ?? '0')}`
                  : undefined
              }
            />
          )}
      </MetricRow>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel
          title="Burn against budget"
          subtitle="Approved hours only; the same hours that have posted to the ledger."
          className="lg:col-span-2"
        >
          <BurnChart series={summary.series} budgetHours={summary.budgetHours} today={today} />
        </Panel>
        <Panel title="Who the hours came from" subtitle="Approved timesheets, by cost.">
          {summary.byEmployee.length === 0 ? (
            <p className="text-body text-muted">
              No timesheet has been approved on this project yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {summary.byEmployee.map((p) => (
                <li key={p.employee.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-body font-heavy text-ink">
                      {p.employee.fullName}
                    </span>
                    <span className="shrink-0 text-sub tabular-nums text-muted">
                      {formatHoursPlain(p.hours)} · {formatSigned(p.amount)}
                    </span>
                  </div>
                  <Progress
                    value={
                      (Number(p.amount) / Math.max(1, Number(summary.byEmployee[0].amount))) * 100
                    }
                    label={`${p.employee.fullName} cost`}
                    className="mt-1.5"
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        flush
        title="Cost ledger"
        subtitle="Append-only: a correction is a new row that reverses the old one, never an edit."
        action={
          <div className="flex items-center gap-2">
            {can('cost.export') && (
              <Button size="sm" variant="ghost" leadingIcon={<Download />} onClick={exportSheet}>
                Export
              </Button>
            )}
            {can('cost.edit') && (
              <Button
                size="sm"
                variant="primary"
                leadingIcon={<Plus />}
                onClick={() => setAdjusting(true)}
              >
                Adjustment
              </Button>
            )}
          </div>
        }
        bodyClassName="mt-1"
      >
        <div className="flex flex-wrap items-end gap-2.5 border-y border-line px-4 py-3">
          <SelectField
            label="Source"
            srOnlyLabel
            containerClassName="w-48"
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setPage(1);
            }}
            options={SOURCE_FILTER}
          />
          {ledger && (
            <p className="text-sub text-muted">
              {ledger.meta.total} posting{ledger.meta.total === 1 ? '' : 's'} · net{' '}
              {formatSigned(ledger.meta.netAmount)}
              {ledger.data.some((r) => r.hours !== null) &&
                ` · ${formatHoursPlain(ledger.meta.netHours)}`}
            </p>
          )}
        </div>
        <DataTable
          data={ledger?.data ?? []}
          columns={columns}
          loading={loadingLedger}
          minWidth={820}
          getRowId={(row) => row.id}
          empty={
            <EmptyState
              title="Nothing has been posted"
              description="Approved timesheets, approved expenses and adjustments appear here."
            />
          }
        />
        {ledger && ledger.meta.totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
            <p className="text-sub text-muted">
              Page {ledger.meta.page} of {ledger.meta.totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={page >= ledger.meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Panel>

      {adjusting && (
        <AdjustmentDialog projectId={projectId} today={today} onClose={() => setAdjusting(false)} />
      )}
      {reversing && <ReverseDialog row={reversing} onClose={() => setReversing(null)} />}
    </div>
  );
}

function AdjustmentDialog({
  projectId,
  today,
  onClose,
}: {
  projectId: string;
  today: string;
  onClose: () => void;
}) {
  const add = useAddAdjustment(projectId);
  const [kind, setKind] = useState<'LABOUR' | 'EXPENSE'>('LABOUR');
  const [amount, setAmount] = useState('');
  const [hours, setHours] = useState('');
  const [postingDate, setPostingDate] = useState(today);
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit() {
    const cleaned = amount.replace(/[₹,\s]/g, '');
    const next: Record<string, string> = {};
    if (!/^-?\d{1,13}(\.\d{1,2})?$/.test(cleaned) || Number(cleaned) === 0)
      next.amount = 'Enter a non-zero amount, like 12500 or -3000';
    if (kind === 'LABOUR' && hours.trim() !== '' && !Number.isFinite(Number(hours)))
      next.hours = 'Enter hours as a number';
    if (description.trim().length < 5) next.description = 'Say what this corrects';
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    try {
      await add.mutateAsync({
        kind,
        amount: cleaned,
        hours: kind === 'LABOUR' && hours.trim() !== '' ? Number(hours) : null,
        postingDate,
        description,
      });
      toast.success('Adjustment posted to the ledger');
      onClose();
    } catch (error) {
      if (error instanceof ApiRequestError && Object.keys(error.fieldErrors).length > 0)
        setErrors(error.fieldErrors);
      else
        setErrors({
          amount:
            error instanceof ApiRequestError ? error.message : 'Could not post the adjustment.',
        });
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Post a cost adjustment"
      description="For opening balances, missed cost and write-offs. It becomes a ledger row you can see and reverse, never an edit."
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={add.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={add.isPending} onClick={submit}>
            Post
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Kind"
          containerClassName="sm:col-span-2"
          value={kind}
          onChange={(event) => setKind(event.target.value as 'LABOUR' | 'EXPENSE')}
          options={[
            { value: 'LABOUR', label: 'Labour (moves hours and labour cost)' },
            { value: 'EXPENSE', label: 'Expense (moves expense cost only)' },
          ]}
        />
        <TextField
          label="Amount (₹)"
          required
          inputMode="decimal"
          placeholder="12500 or -3000"
          error={errors.amount}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          hint="Negative takes cost off."
        />
        <TextField
          label="Hours"
          inputMode="decimal"
          disabled={kind !== 'LABOUR'}
          placeholder={kind === 'LABOUR' ? 'optional, signed' : 'labour only'}
          error={errors.hours}
          value={hours}
          onChange={(e) => setHours(e.target.value)}
        />
        <TextField
          label="Posting date"
          type="date"
          required
          max={today}
          error={errors.postingDate}
          value={postingDate}
          onChange={(e) => setPostingDate(e.target.value)}
        />
        <TextAreaField
          label="What does this correct?"
          required
          rows={2}
          containerClassName="sm:col-span-2"
          error={errors.description}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
    </Dialog>
  );
}

function ReverseDialog({ row, onClose }: { row: LedgerRow; onClose: () => void }) {
  const reverse = useReverseEntry();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (reason.trim().length < 5) {
      setError('Say why, in a few words.');
      return;
    }
    try {
      await reverse.mutateAsync({ id: row.id, input: { reason } });
      toast.success('Reversed — a mirror row was posted');
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not reverse.');
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Reverse this adjustment?"
      description={`${formatSigned(row.amount)} posted ${formatDisplayDate(row.postingDate)}. A matching negative row is added; the original stays on the ledger.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={reverse.isPending}>
            Back
          </Button>
          <Button variant="danger" loading={reverse.isPending} onClick={submit}>
            Reverse
          </Button>
        </>
      }
    >
      <TextAreaField
        label="Reason (kept in the audit log)"
        required
        rows={3}
        value={reason}
        error={error ?? undefined}
        onChange={(e) => {
          setReason(e.target.value);
          setError(null);
        }}
      />
    </Dialog>
  );
}
