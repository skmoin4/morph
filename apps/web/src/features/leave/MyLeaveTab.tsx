import { useState } from 'react';
import { CalendarX2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField } from '../../components/ui/Field';
import { MetricCard, MetricRow } from '../../components/ui/MetricCard';
import { Panel } from '../../components/ui/Panel';
import { ApplyLeaveDialog } from './ApplyLeaveDialog';
import { LeaveTable } from './LeaveTable';
import { formatDays, useLeaveBalances, useLeaveRequests } from './useLeave';

export function BalanceCards({ employeeId }: { employeeId?: string }) {
  const { data, isLoading } = useLeaveBalances({ employeeId });
  if (isLoading || !data) {
    return (
      <MetricRow>
        {[0, 1, 2, 3].map((i) => (
          <MetricCard key={i} label="…" value="" loading />
        ))}
      </MetricRow>
    );
  }
  return (
    <MetricRow>
      {data.balances.map((b) => (
        <MetricCard
          key={b.leaveType.id}
          label={b.leaveType.name}
          value={b.leaveType.isPaid ? formatDays(b.available).replace(/ days?$/, '') : b.used}
          state={b.leaveType.isPaid && b.available <= 0 ? 'bad' : 'neutral'}
          foot={
            b.leaveType.isPaid
              ? `${b.used} used${b.pending ? ` · ${b.pending} waiting` : ''} · of ${b.opening + b.accrued + b.carriedForward}${b.carriedForward ? ` (incl. ${b.carriedForward} carried)` : ''}`
              : `taken this year · unpaid${b.pending ? ` · ${b.pending} waiting` : ''}`
          }
        />
      ))}
    </MetricRow>
  );
}

/** Your balances, and your own requests. */
export function MyLeaveTab() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [applying, setApplying] = useState(false);
  const { data, isLoading } = useLeaveRequests({ mine: true, status: status || undefined, page });

  return (
    <div className="space-y-5">
      <BalanceCards />

      <Panel
        flush
        title="My requests"
        subtitle="Leave you have applied for, and where each stands."
        bodyClassName="mt-1"
      >
        <div className="flex flex-wrap items-end gap-2.5 border-y border-line px-4 py-3">
          <SelectField
            label="Status"
            srOnlyLabel
            containerClassName="w-44"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All' },
              { value: 'PENDING', label: 'Waiting' },
              { value: 'APPROVED', label: 'Approved' },
              { value: 'REJECTED', label: 'Rejected' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
          />
        </div>

        <LeaveTable
          rows={data?.data ?? []}
          loading={isLoading}
          showEmployee={false}
          empty={
            <EmptyState
              icon={<CalendarX2 />}
              title="No leave yet"
              description="When you apply for leave it shows up here, with its status."
              action={
                <Button size="sm" variant="primary" onClick={() => setApplying(true)}>
                  Apply for leave
                </Button>
              }
            />
          }
        />
        <Pager meta={data?.meta} onPage={setPage} />
      </Panel>

      {applying && <ApplyLeaveDialog onClose={() => setApplying(false)} />}
    </div>
  );
}

export function Pager({
  meta,
  onPage,
}: {
  meta?: { page: number; totalPages: number };
  onPage: (updater: (page: number) => number) => void;
}) {
  if (!meta || meta.totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
      <p className="text-sub text-muted">
        Page {meta.page} of {meta.totalPages}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={meta.page <= 1}
          onClick={() => onPage((p) => p - 1)}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
