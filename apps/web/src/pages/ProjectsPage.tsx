import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { ClipboardList, FileText, Search } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { CellStack, DataTable } from '../components/ui/DataTable';
import { MetricCard, MetricRow } from '../components/ui/MetricCard';
import { Progress } from '../components/ui/Progress';
import { EmptyState } from '../components/ui/EmptyState';
import { SelectField, TextField } from '../components/ui/Field';
import { formatCurrencyShort, formatDisplayDate } from '../lib/format';
import { useAuth } from '../providers/AuthProvider';
import { useClients } from '../features/clients/useClients';
import { useBookingLookups } from '../features/bookings/useBookings';
import { HealthPill, ProjectStatusPill } from '../features/projects/badges';
import {
  personName,
  useProjects,
  useProjectSummary,
  type ProjectListItem,
} from '../features/projects/useProjects';

export function ProjectsPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canSeeCost = can('cost.view');
  const canSeeMargin = can('margin.view');

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [health, setHealth] = useState('');
  const [clientId, setClientId] = useState('');
  const [officeId, setOfficeId] = useState('');
  const [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'createdAt', desc: true }]);

  const filters = {
    q: q || undefined,
    status: status || undefined,
    health: health || undefined,
    clientId: clientId || undefined,
    officeId: officeId || undefined,
    page,
    sort: sorting[0] ? `${sorting[0].id}:${sorting[0].desc ? 'desc' : 'asc'}` : undefined,
  };

  const { data, isLoading, isFetching } = useProjects(filters);
  const { data: summary, isLoading: summaryLoading } = useProjectSummary();
  const canSeeClients = can('client.view');
  const { data: clients } = useClients({ isActive: true, pageSize: 200 }, canSeeClients);
  const { data: lookups } = useBookingLookups(can('booking.view'));

  const rows = data?.data ?? [];
  const reset =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
    };

  const columns = useMemo<ColumnDef<ProjectListItem, unknown>[]>(() => {
    const base: ColumnDef<ProjectListItem, unknown>[] = [
      {
        header: 'Project',
        accessorKey: 'name',
        meta: { className: 'w-[28%] max-w-0' },
        cell: ({ row }) => (
          <CellStack
            title={row.original.name}
            subtitle={`${row.original.projectCode} • ${row.original.client.name}`}
          />
        ),
      },
      {
        header: 'Manager',
        id: 'manager',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{personName(row.original.projectManager)}</span>
        ),
      },
      {
        header: 'Task progress',
        id: 'progress',
        enableSorting: false,
        cell: ({ row }) => {
          const { total, DONE } = row.original.tasks;
          const percent = total === 0 ? 0 : Math.round((DONE / total) * 100);
          return (
            <div className="min-w-[110px]">
              <Progress value={percent} label={`${percent}% of tasks done`} />
              <p className="mt-1 text-micro tracking-normal text-muted">
                {total === 0 ? 'No tasks yet' : `${DONE}/${total} done`}
              </p>
            </div>
          );
        },
      },
      {
        header: 'Hours burn',
        id: 'burn',
        enableSorting: false,
        cell: ({ row }) => {
          const burn = row.original.hoursBurnPercent;
          return (
            <div className="min-w-[110px]">
              <Progress
                value={burn ?? 0}
                risk={(burn ?? 0) >= 80}
                label={`${burn ?? 0}% of hours`}
              />
              <p className="mt-1 text-micro tracking-normal text-muted">
                {burn === null ? 'No budget set' : `${burn}% consumed`}
              </p>
            </div>
          );
        },
      },
    ];

    if (canSeeCost) {
      base.push({
        header: 'Actual cost',
        id: 'cost',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-heavy tabular-nums">
            {row.original.actualTotalCost !== undefined && Number(row.original.actualTotalCost) > 0
              ? formatCurrencyShort(row.original.actualTotalCost)
              : '—'}
          </span>
        ),
      });
    }
    if (canSeeMargin) {
      base.push({
        header: 'Margin',
        id: 'margin',
        enableSorting: false,
        cell: ({ row }) => {
          const value = row.original.marginPercent;
          // No cost posted yet: a margin would only read "100%".
          if (
            value === undefined ||
            value === null ||
            Number(row.original.actualTotalCost ?? 0) <= 0
          ) {
            return <span className="text-muted">—</span>;
          }
          return (
            <span
              className={`whitespace-nowrap font-heavy tabular-nums ${value < 0 ? 'text-red' : 'text-green'}`}
            >
              {value}%
            </span>
          );
        },
      });
    }

    base.push(
      {
        header: 'Ends',
        accessorKey: 'endDate',
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {row.original.endDate ? formatDisplayDate(row.original.endDate) : '—'}
          </span>
        ),
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1.5">
            <ProjectStatusPill status={row.original.status} />
            <HealthPill health={row.original.health} status={row.original.status} />
          </div>
        ),
      },
    );
    return base;
  }, [canSeeCost, canSeeMargin]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Delivery"
        title="Projects"
        subtitle="Schedule, team, tasks and burn for every booked project."
        actions={
          can('booking.view') && (
            <Button
              variant="ghost"
              leadingIcon={<FileText />}
              onClick={() => navigate('/bookings')}
            >
              Projects start as bookings
            </Button>
          )
        }
      />

      <MetricRow>
        <MetricCard
          label="Active"
          loading={summaryLoading}
          value={summary?.active ?? 0}
          state="good"
          foot="Delivering now"
          onClick={() => reset(setStatus)('ACTIVE')}
        />
        <MetricCard
          label="At risk"
          loading={summaryLoading}
          value={summary?.atRisk ?? 0}
          state={summary?.atRisk ? 'bad' : 'neutral'}
          foot="Active, flagged"
          onClick={() => {
            setStatus('ACTIVE');
            reset(setHealth)('AT_RISK');
          }}
        />
        <MetricCard
          label="Over hours budget"
          loading={summaryLoading}
          value={summary?.overBudgetHours ?? 0}
          state={summary?.overBudgetHours ? 'warn' : 'neutral'}
          foot="Active projects"
        />
        <MetricCard
          label="On hold"
          loading={summaryLoading}
          value={summary?.onHold ?? 0}
          foot="Paused"
          onClick={() => reset(setStatus)('ON_HOLD')}
        />
        <MetricCard
          label="Completed"
          loading={summaryLoading}
          value={summary?.completed ?? 0}
          foot="Delivered"
          onClick={() => reset(setStatus)('COMPLETED')}
        />
        <MetricCard
          label="Cancelled"
          loading={summaryLoading}
          value={summary?.cancelled ?? 0}
          foot="Code kept, never reused"
          onClick={() => reset(setStatus)('CANCELLED')}
        />
      </MetricRow>

      <Panel
        flush
        title="Project register"
        subtitle="Open a project for its team, schedule, tasks and booking."
        bodyClassName="mt-1"
      >
        <div className="flex flex-wrap items-end gap-2.5 border-y border-line px-4 py-3">
          <TextField
            label="Search"
            srOnlyLabel
            containerClassName="min-w-[200px] flex-1"
            placeholder="Project, code or client…"
            leadingIcon={<Search />}
            value={q}
            onChange={(event) => reset(setQ)(event.target.value)}
          />
          <SelectField
            label="Status"
            srOnlyLabel
            placeholder="Any status"
            containerClassName="w-40"
            value={status}
            onChange={(event) => reset(setStatus)(event.target.value)}
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'ON_HOLD', label: 'On hold' },
              { value: 'COMPLETED', label: 'Completed' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
          />
          <SelectField
            label="Health"
            srOnlyLabel
            placeholder="Any health"
            containerClassName="w-40"
            value={health}
            onChange={(event) => reset(setHealth)(event.target.value)}
            options={[
              { value: 'HEALTHY', label: 'On track' },
              { value: 'AT_RISK', label: 'At risk' },
              { value: 'CRITICAL', label: 'Critical' },
            ]}
          />
          {canSeeClients && (
            <SelectField
              label="Client"
              srOnlyLabel
              placeholder="All clients"
              containerClassName="w-44"
              value={clientId}
              onChange={(event) => reset(setClientId)(event.target.value)}
              options={(clients?.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
          )}
          {lookups && (
            <SelectField
              label="Office"
              srOnlyLabel
              placeholder="All offices"
              containerClassName="w-40"
              value={officeId}
              onChange={(event) => reset(setOfficeId)(event.target.value)}
              options={lookups.offices.map((o) => ({ value: o.id, label: o.name }))}
            />
          )}
        </div>

        <DataTable
          data={rows}
          columns={columns}
          loading={isLoading}
          minWidth={980}
          getRowId={(row) => row.id}
          sorting={sorting}
          onSortingChange={(updater) => {
            setSorting(updater);
            setPage(1);
          }}
          onRowClick={(row) => navigate(`/projects/${row.id}`)}
          empty={
            <EmptyState
              icon={<ClipboardList />}
              title="No projects match these filters"
              description="A project appears here once its booking is confirmed. Clear a filter, or confirm a booking."
              action={
                can('booking.view') ? (
                  <Button size="sm" variant="primary" onClick={() => navigate('/bookings')}>
                    Go to bookings
                  </Button>
                ) : undefined
              }
            />
          }
        />

        {data && data.meta.totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
            <p className="text-sub text-muted">
              Page {data.meta.page} of {data.meta.totalPages} · {data.meta.total} projects
              {isFetching && ' · updating…'}
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
