import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { Coins, Download, Search } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { CellStack, DataTable } from '../components/ui/DataTable';
import { EmptyState } from '../components/ui/EmptyState';
import { SelectField, TextField } from '../components/ui/Field';
import { MetricCard, MetricRow } from '../components/ui/MetricCard';
import { Panel } from '../components/ui/Panel';
import { StatusPill } from '../components/ui/Pill';
import { Progress } from '../components/ui/Progress';
import { api, ApiRequestError } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';
import {
  formatHoursPlain,
  formatSigned,
  useCostOverview,
  type OverviewRow,
} from '../features/cost/useCost';

/** Budget vs actual for every project you can see, closest to its budget first. */
export function ProjectCostPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [alert, setAlert] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useCostOverview({
    alert: alert || undefined,
    status: status || undefined,
    q: q || undefined,
    page,
  });

  async function exportSheet() {
    try {
      const params = new URLSearchParams();
      if (alert) params.set('alert', alert);
      if (status) params.set('status', status);
      if (q) params.set('q', q);
      await api.download(`/cost/export?${params.toString()}`, 'project-cost.xlsx');
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not export.');
    }
  }

  const showValue = data?.data.some((r) => r.projectValue !== undefined);
  const showMargin = data?.data.some((r) => r.marginPercent !== undefined);

  const columns: ColumnDef<OverviewRow, unknown>[] = [
    {
      header: 'Project',
      id: 'project',
      enableSorting: false,
      meta: { className: 'w-[26%] max-w-0' },
      cell: ({ row }) => (
        <CellStack
          title={row.original.projectCode}
          subtitle={`${row.original.name} · ${row.original.client}`}
        />
      ),
    },
    {
      header: 'Status',
      id: 'status',
      enableSorting: false,
      cell: ({ row }) => <StatusPill status={row.original.status} />,
    },
    {
      header: 'Hours vs budget',
      id: 'burn',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="min-w-[150px]">
          <div className="flex items-baseline justify-between gap-2 text-sub tabular-nums">
            <span className="font-heavy text-ink">
              {row.original.burnPercent === null ? '—' : `${row.original.burnPercent}%`}
            </span>
            <span className="text-muted">
              {formatHoursPlain(row.original.actualHours)} /{' '}
              {formatHoursPlain(row.original.budgetHours)}
            </span>
          </div>
          <Progress
            value={row.original.burnPercent ?? 0}
            risk={row.original.alertLevel > 0}
            label={`${row.original.projectCode} hours burn`}
            className="mt-1"
          />
        </div>
      ),
    },
    {
      header: 'Labour',
      id: 'labour',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatSigned(row.original.actualLabourCost)}
        </span>
      ),
    },
    {
      header: 'Expenses',
      id: 'expense',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatSigned(row.original.actualExpenseCost)}
        </span>
      ),
    },
    {
      header: 'Total cost',
      id: 'total',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="whitespace-nowrap font-heavy tabular-nums">
          {formatSigned(row.original.actualTotalCost)}
        </span>
      ),
    },
    ...(showValue
      ? [
          {
            header: 'Contract value',
            id: 'value',
            enableSorting: false,
            cell: ({ row }) => (
              <span className="whitespace-nowrap tabular-nums">
                {row.original.projectValue ? formatSigned(row.original.projectValue) : '—'}
              </span>
            ),
          } satisfies ColumnDef<OverviewRow, unknown>,
        ]
      : []),
    ...(showMargin
      ? [
          {
            header: 'Margin',
            id: 'margin',
            enableSorting: false,
            cell: ({ row }) =>
              row.original.marginPercent === undefined ||
              row.original.marginPercent === null ||
              Number(row.original.actualTotalCost) === 0 ? (
                '—'
              ) : (
                <span
                  className={
                    row.original.marginPercent < 0 ? 'font-heavy text-red' : 'tabular-nums'
                  }
                >
                  {row.original.marginPercent}%
                </span>
              ),
          } satisfies ColumnDef<OverviewRow, unknown>,
        ]
      : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Money"
        title="Project Cost"
        subtitle="Budget against actual for every project you can see. Open a project for its full ledger."
        actions={
          can('cost.export') && (
            <Button variant="secondary" leadingIcon={<Download />} onClick={exportSheet}>
              Export
            </Button>
          )
        }
      />

      <MetricRow>
        <MetricCard
          label="Total cost posted"
          value={data ? formatSigned(data.meta.totalCost) : ''}
          foot={data ? `${data.meta.total} project${data.meta.total === 1 ? '' : 's'}` : ' '}
          loading={!data}
        />
        <MetricCard
          label="Hours posted"
          value={data ? formatHoursPlain(data.meta.totalHours) : ''}
          foot="Approved timesheets and adjustments"
          loading={!data}
        />
        <MetricCard
          label="Over budget"
          value={data?.meta.overBudget ?? 0}
          state={data && data.meta.overBudget > 0 ? 'bad' : 'neutral'}
          foot="Used 100% or more of their hours"
          onClick={() => setAlert(alert === '100' ? '' : '100')}
          loading={!data}
        />
        <MetricCard
          label="Nearing budget"
          value={data?.meta.nearBudget ?? 0}
          state={data && data.meta.nearBudget > 0 ? 'warn' : 'neutral'}
          foot="Between 80% and 100%"
          onClick={() => setAlert(alert === '80' ? '' : '80')}
          loading={!data}
        />
      </MetricRow>

      <Panel flush title="Projects" bodyClassName="mt-1">
        <div className="flex flex-wrap items-end gap-2.5 border-y border-line px-4 py-3">
          <TextField
            label="Search"
            srOnlyLabel
            containerClassName="w-60"
            placeholder="Code or name…"
            leadingIcon={<Search />}
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
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
              { value: '', label: 'Any status' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'ON_HOLD', label: 'On hold' },
              { value: 'COMPLETED', label: 'Completed' },
            ]}
          />
          <SelectField
            label="Budget"
            srOnlyLabel
            containerClassName="w-48"
            value={alert}
            onChange={(event) => {
              setAlert(event.target.value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'Any burn' },
              { value: '80', label: '80% or more' },
              { value: '100', label: 'Over budget' },
            ]}
          />
        </div>
        <DataTable
          data={data?.data ?? []}
          columns={columns}
          loading={isLoading}
          minWidth={900}
          getRowId={(row) => row.id}
          onRowClick={(row) => navigate(`/projects/${row.id}?tab=cost`)}
          empty={
            <EmptyState
              icon={<Coins />}
              title="No projects to show"
              description="Projects whose cost you can see appear here."
            />
          }
        />
        {data && data.meta.totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
            <p className="text-sub text-muted">
              Page {data.meta.page} of {data.meta.totalPages}
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
                disabled={page >= data.meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
