import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Search, Users } from 'lucide-react';
import { CellStack, DataTable } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField, TextField } from '../../components/ui/Field';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useAttendanceLookups } from '../attendance/useAttendance';
import { useTeamBalances, type TeamBalancesResponse } from './useLeave';

type Row = TeamBalancesResponse['data'][number];

/** Everyone's balances, one row each — for HR and approvers. */
export function BalancesTab() {
  const thisYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(thisYear);
  const [officeId, setOfficeId] = useState('');
  const [q, setQ] = useState('');
  const { data: lookups } = useAttendanceLookups();
  const { data, isLoading } = useTeamBalances({
    year,
    officeId: officeId || undefined,
    q: q || undefined,
  });

  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        header: 'Employee',
        id: 'employee',
        enableSorting: false,
        meta: { className: 'w-[26%] max-w-0' },
        cell: ({ row }) => (
          <CellStack
            title={row.original.employee.fullName}
            subtitle={`${row.original.employee.employeeCode} · ${row.original.employee.office}`}
          />
        ),
      },
      ...(data?.types ?? []).map((type): ColumnDef<Row, unknown> => ({
        header: type.shortCode,
        id: type.id,
        enableSorting: false,
        cell: ({ row }) => {
          const b = row.original.balances.find((x) => x.leaveType.id === type.id);
          if (!b) return '—';
          if (!type.isPaid) {
            return <span className="tabular-nums text-muted">{b.used} taken</span>;
          }
          return (
            <div>
              <p
                className={cn(
                  'font-heavy tabular-nums',
                  b.available <= 0 ? 'text-red' : 'text-ink',
                )}
              >
                {b.available}
              </p>
              <p className="text-micro text-muted">
                {b.used} used{b.pending ? ` · ${b.pending} waiting` : ''}
              </p>
            </div>
          );
        },
      })),
    ],
    [data?.types],
  );

  return (
    <Panel
      flush
      title="Leave balances"
      subtitle="Days left per type: unspent from last year carries over only where the type allows it."
      bodyClassName="mt-1"
    >
      <div className="flex flex-wrap items-end gap-2.5 border-y border-line px-4 py-3">
        <TextField
          label="Search"
          srOnlyLabel
          containerClassName="w-60"
          placeholder="Name or code…"
          leadingIcon={<Search />}
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        {lookups && lookups.offices.length > 1 && (
          <SelectField
            label="Office"
            srOnlyLabel
            containerClassName="w-44"
            value={officeId}
            onChange={(event) => setOfficeId(event.target.value)}
            options={[
              { value: '', label: 'All offices' },
              ...lookups.offices.map((o) => ({ value: o.id, label: o.name })),
            ]}
          />
        )}
        <SelectField
          label="Year"
          srOnlyLabel
          containerClassName="w-28"
          value={String(year)}
          onChange={(event) => setYear(Number(event.target.value))}
          options={[thisYear - 1, thisYear, thisYear + 1].map((y) => ({
            value: String(y),
            label: String(y),
          }))}
        />
      </div>
      <DataTable
        data={data?.data ?? []}
        columns={columns}
        loading={isLoading}
        minWidth={720}
        getRowId={(row) => row.employee.id}
        empty={
          <EmptyState
            icon={<Users />}
            title="No one to show"
            description="Try another office or search."
          />
        }
      />
    </Panel>
  );
}
