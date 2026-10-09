import { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField } from '../../components/ui/Field';
import { Panel } from '../../components/ui/Panel';
import { LeaveTable } from './LeaveTable';
import { Pager } from './MyLeaveTab';
import { useLeaveRequests, useLeaveTypes } from './useLeave';

/** Requests from the people you approve for — by default, the ones waiting on you. */
export function ApprovalsTab() {
  const [view, setView] = useState('toDecide');
  const [typeId, setTypeId] = useState('');
  const [page, setPage] = useState(1);
  const { data: types } = useLeaveTypes();

  const { data, isLoading } = useLeaveRequests({
    toDecide: view === 'toDecide',
    status: view === 'toDecide' || view === 'ALL' ? undefined : view,
    leaveTypeId: typeId || undefined,
    page,
  });

  return (
    <Panel
      flush
      title="Leave approvals"
      subtitle="Approve or reject. Two-level leave needs the team lead first, then a manager or HR."
      bodyClassName="mt-1"
    >
      <div className="flex flex-wrap items-end gap-2.5 border-y border-line px-4 py-3">
        <SelectField
          label="Show"
          srOnlyLabel
          containerClassName="w-52"
          value={view}
          onChange={(event) => {
            setView(event.target.value);
            setPage(1);
          }}
          options={[
            { value: 'toDecide', label: 'Waiting on me' },
            { value: 'PENDING', label: 'All waiting' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'REJECTED', label: 'Rejected' },
            { value: 'CANCELLED', label: 'Cancelled' },
            { value: 'ALL', label: 'Everything' },
          ]}
        />
        <SelectField
          label="Leave type"
          srOnlyLabel
          containerClassName="w-44"
          value={typeId}
          onChange={(event) => {
            setTypeId(event.target.value);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All types' },
            ...(types ?? []).map((t) => ({ value: t.id, label: t.name })),
          ]}
        />
      </div>

      <LeaveTable
        rows={data?.data ?? []}
        loading={isLoading}
        showEmployee
        empty={
          <EmptyState
            icon={<ClipboardCheck />}
            title={view === 'toDecide' ? 'Nothing is waiting on you' : 'No requests here'}
            description="When someone in your team applies for leave, it appears here."
          />
        }
      />
      <Pager meta={data?.meta} onPage={setPage} />
    </Panel>
  );
}
