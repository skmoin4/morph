import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CalendarCheck2 } from 'lucide-react';
import { leaveRequestSchema, type LeavePreviewInput } from '@opsvera/shared';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { SelectField, TextAreaField, TextField } from '../../components/ui/Field';
import { ApiRequestError } from '../../lib/api';
import { formatDisplayDate } from '../../lib/format';
import { cn } from '../../lib/cn';
import {
  DAY_PART_LABEL,
  formatDays,
  useApplyLeave,
  useLeaveBalances,
  useLeavePreview,
  useLeaveTypes,
  type LeaveDayPart,
} from './useLeave';

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Apply for leave. The cost is asked of the server as the form fills in, so what
 * you see — working days, what is skipped, the balance after — is the same
 * arithmetic that will be used when it is submitted.
 */
export function ApplyLeaveDialog({ onClose }: { onClose: () => void }) {
  const apply = useApplyLeave();
  const { data: types } = useLeaveTypes();
  const { data: balances } = useLeaveBalances();

  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [fromDate, setFromDate] = useState(todayIso());
  const [toDate, setToDate] = useState(todayIso());
  const [dayPart, setDayPart] = useState<LeaveDayPart>('FULL_DAY');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const type = types?.find((t) => t.id === leaveTypeId);
  const single = fromDate === toDate;
  const halfAllowed = single && !!type?.allowHalfDay;
  const effectivePart: LeaveDayPart = halfAllowed ? dayPart : 'FULL_DAY';

  // Only ask once the form describes a sensible range.
  const query: LeavePreviewInput | null = useMemo(() => {
    if (!leaveTypeId || !fromDate || !toDate) return null;
    if (toDate < fromDate || fromDate.slice(0, 4) !== toDate.slice(0, 4)) return null;
    return { leaveTypeId, fromDate, toDate, dayPart: effectivePart };
  }, [leaveTypeId, fromDate, toDate, effectivePart]);
  const preview = useLeavePreview(query);
  const previewError = preview.error instanceof ApiRequestError ? preview.error : null;

  const balanceOf = (id: string) => balances?.balances.find((b) => b.leaveType.id === id);
  const blocked =
    !query ||
    preview.isFetching ||
    !!previewError ||
    !!preview.data?.overlap ||
    preview.data?.enoughBalance === false;

  async function submit() {
    const parsed = leaveRequestSchema.safeParse({
      leaveTypeId,
      fromDate,
      toDate,
      dayPart: effectivePart,
      reason,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    try {
      const created = await apply.mutateAsync(parsed.data);
      toast.success(
        `Sent for approval — ${formatDays(created.totalDays)} of ${created.leaveType.name}`,
      );
      onClose();
    } catch (error) {
      if (error instanceof ApiRequestError && Object.keys(error.fieldErrors).length > 0) {
        setErrors(error.fieldErrors);
      } else {
        setErrors({
          reason: error instanceof ApiRequestError ? error.message : 'Could not send the request.',
        });
      }
    }
  }

  const p = preview.data;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Apply for leave"
      description="Pick the type and dates. You will see what it costs before you send it."
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={apply.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={apply.isPending} disabled={blocked} onClick={submit}>
            Send for approval
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Leave type"
          required
          containerClassName="sm:col-span-2"
          error={errors.leaveTypeId}
          value={leaveTypeId}
          onChange={(event) => {
            setLeaveTypeId(event.target.value);
            setErrors({});
          }}
          options={[
            { value: '', label: 'Choose…' },
            ...(types ?? []).map((t) => {
              const b = balanceOf(t.id);
              return {
                value: t.id,
                label: t.isPaid && b ? `${t.name} — ${formatDays(b.available)} left` : t.name,
              };
            }),
          ]}
        />
        <TextField
          label="From"
          type="date"
          required
          error={errors.fromDate}
          value={fromDate}
          onChange={(event) => {
            const value = event.target.value;
            setFromDate(value);
            // Keep the range valid while the first date moves.
            if (toDate < value) setToDate(value);
            setErrors({});
          }}
        />
        <TextField
          label="To"
          type="date"
          required
          min={fromDate}
          error={errors.toDate}
          value={toDate}
          onChange={(event) => {
            setToDate(event.target.value);
            setErrors({});
          }}
        />
        {halfAllowed && (
          <SelectField
            label="Day"
            containerClassName="sm:col-span-2"
            error={errors.dayPart}
            value={dayPart}
            onChange={(event) => setDayPart(event.target.value as LeaveDayPart)}
            options={(Object.keys(DAY_PART_LABEL) as LeaveDayPart[]).map((k) => ({
              value: k,
              label: DAY_PART_LABEL[k],
            }))}
          />
        )}
        <TextAreaField
          label="Reason"
          required
          rows={3}
          containerClassName="sm:col-span-2"
          error={errors.reason}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setErrors((e) => ({ ...e, reason: '' }));
          }}
        />
      </div>

      <div
        aria-live="polite"
        className={cn(
          'mt-4 rounded-control border px-3.5 py-3 text-body',
          previewError || p?.overlap || p?.enoughBalance === false
            ? 'border-red/40 bg-pill-red-bg text-pill-red-fg'
            : 'border-line bg-surface-2 text-ink-2',
        )}
      >
        {!query && (
          <p className="text-muted">
            {toDate < fromDate
              ? 'The end date is before the start.'
              : fromDate.slice(0, 4) !== toDate.slice(0, 4)
                ? 'A request cannot run across two years. Apply for each year separately.'
                : 'Choose a leave type to see what it costs.'}
          </p>
        )}
        {query && preview.isFetching && !p && <p className="text-muted">Working it out…</p>}
        {previewError && (
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {previewError.message}
          </p>
        )}
        {p && !previewError && (
          <div className="space-y-1.5">
            <p className="flex items-center gap-2 font-heavy text-ink">
              <CalendarCheck2 className="size-4 text-blue" aria-hidden />
              {formatDays(p.totalDays)} of {p.leaveType.name}
            </p>
            {p.skipped.length > 0 && (
              <p className="text-sub text-muted">
                Not counted:{' '}
                {p.skipped
                  .map(
                    (s) =>
                      `${formatDisplayDate(s.date)} (${s.reason === 'HOLIDAY' ? (s.holiday ?? 'holiday') : 'weekly off'})`,
                  )
                  .join(', ')}
              </p>
            )}
            {p.balance.enforced ? (
              <p className="text-sub">
                Balance: {formatDays(p.balance.available)} now →{' '}
                <strong>{formatDays(Math.max(p.balance.afterRequest, 0))}</strong> after
                {p.enoughBalance
                  ? ''
                  : ` — ${formatDays(p.totalDays - p.balance.available)} short. Use an unpaid type for the rest.`}
              </p>
            ) : (
              <p className="text-sub text-muted">Unpaid leave: no balance is used.</p>
            )}
            {p.overlap && (
              <p className="text-sub">
                This overlaps your {p.overlap.status === 'APPROVED' ? 'approved' : 'pending'} leave
                from {formatDisplayDate(p.overlap.from)} to {formatDisplayDate(p.overlap.to)}.
              </p>
            )}
            {p.leaveType.approvalFlow === 'TEAM_LEAD_THEN_MANAGER' &&
              !p.overlap &&
              p.enoughBalance && (
                <p className="text-sub text-muted">
                  Needs two approvals: team lead, then manager or HR.
                </p>
              )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
