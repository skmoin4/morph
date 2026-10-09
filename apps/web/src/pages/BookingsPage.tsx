import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { FileCheck2, FileText, Plus, Search } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { CellNumber, CellStack, DataTable } from '../components/ui/DataTable';
import { MetricCard, MetricRow } from '../components/ui/MetricCard';
import { StatusPill } from '../components/ui/Pill';
import { EmptyState } from '../components/ui/EmptyState';
import { SelectField, TextField } from '../components/ui/Field';
import { formatCurrency, formatCurrencyShort, formatDisplayDate } from '../lib/format';
import { useAuth } from '../providers/AuthProvider';
import { useClients } from '../features/clients/useClients';
import { ConfirmationBadges } from '../features/bookings/BookingBadges';
import { BookingDrawer } from '../features/bookings/BookingDrawer';
import { BookingFormDrawer } from '../features/bookings/BookingFormDrawer';
import {
  useBookingLookups,
  useBookings,
  useBookingSummary,
  type BookingListItem,
  type ConfirmationType,
} from '../features/bookings/useBookings';

/** The confirmation filter is one control that covers three API parameters. */
type ConfirmationFilter = '' | 'EMAIL' | 'VERBAL' | 'EMAIL_PENDING';

export function BookingsPage() {
  const { can } = useAuth();
  const canCreate = can('booking.create');
  const [params, setParams] = useSearchParams();

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [clientId, setClientId] = useState(params.get('clientId') ?? '');
  const [officeId, setOfficeId] = useState('');
  const [projectTypeId, setProjectTypeId] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationFilter>(
    params.get('filter') === 'email-pending' ? 'EMAIL_PENDING' : '',
  );
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'bookingDate', desc: true }]);

  const [creating, setCreating] = useState(params.get('new') === '1');
  const [openId, setOpenId] = useState<string | null>(params.get('open'));

  // `?new=1` comes from the Quick Action menu; it has done its job once the
  // form is open, and leaving it would reopen the form on every refresh.
  useEffect(() => {
    if (params.has('new') || params.has('open')) {
      const next = new URLSearchParams(params);
      next.delete('new');
      next.delete('open');
      setParams(next, { replace: true });
    }
    // Only on first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filters = useMemo(
    () => ({
      q: q || undefined,
      status: status || undefined,
      clientId: clientId || undefined,
      officeId: officeId || undefined,
      projectTypeId: projectTypeId || undefined,
      confirmationType:
        confirmation === 'EMAIL' || confirmation === 'VERBAL'
          ? (confirmation as ConfirmationType)
          : undefined,
      emailPending: confirmation === 'EMAIL_PENDING',
      from: from || undefined,
      to: to || undefined,
      page,
      sort: sorting[0] ? `${sorting[0].id}:${sorting[0].desc ? 'desc' : 'asc'}` : undefined,
    }),
    [q, status, clientId, officeId, projectTypeId, confirmation, from, to, page, sorting],
  );

  const { data, isLoading, isFetching } = useBookings(filters);
  const { data: summary, isLoading: summaryLoading } = useBookingSummary();
  const { data: clients } = useClients({ pageSize: 200 });
  const { data: lookups } = useBookingLookups();

  const rows = data?.data ?? [];
  const filtered = Object.entries(filters).some(
    ([key, value]) => key !== 'page' && key !== 'sort' && value !== undefined && value !== false,
  );
  const showValue = rows.some((row) => row.projectValue !== undefined);

  const resetPage =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
    };

  const columns = useMemo<ColumnDef<BookingListItem, unknown>[]>(() => {
    const base: ColumnDef<BookingListItem, unknown>[] = [
      {
        header: 'Booking',
        accessorKey: 'bookingNumber',
        meta: { className: 'w-[24%] max-w-0' },
        cell: ({ row }) => (
          <CellStack title={row.original.bookingNumber} subtitle={row.original.projectName} />
        ),
      },
      {
        header: 'Client',
        accessorKey: 'client',
        enableSorting: false,
        meta: { className: 'w-[20%] max-w-0' },
        cell: ({ row }) => (
          <CellStack
            title={row.original.client.name}
            subtitle={`${row.original.projectType.shortCode} · ${row.original.office.shortCode}`}
          />
        ),
      },
      {
        header: 'Booked',
        accessorKey: 'bookingDate',
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{formatDisplayDate(row.original.bookingDate)}</span>
        ),
      },
    ];

    // Hidden for roles without project.value.view; the API strips it anyway.
    if (showValue) {
      base.push({
        header: 'Value',
        accessorKey: 'projectValue',
        cell: ({ row }) =>
          row.original.projectValue ? (
            <CellNumber>
              <span title={formatCurrency(row.original.projectValue)}>
                {formatCurrencyShort(row.original.projectValue)}
              </span>
            </CellNumber>
          ) : (
            <span className="text-muted">—</span>
          ),
      });
    }

    base.push(
      {
        header: 'Confirmation',
        accessorKey: 'confirmation',
        enableSorting: false,
        cell: ({ row }) => <ConfirmationBadges booking={row.original} />,
      },
      {
        header: 'Project code',
        accessorKey: 'generatedProjectCode',
        cell: ({ row }) =>
          row.original.generatedProjectCode ? (
            <span className="whitespace-nowrap font-mono text-sub font-heavy text-ink">
              {row.original.generatedProjectCode}
            </span>
          ) : (
            <span className="whitespace-nowrap text-sub font-heavy text-blue">Not generated</span>
          ),
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => (
          <StatusPill
            status={row.original.status}
            label={
              row.original.status === 'CONFIRMED' && row.original.approvalStatus === 'PENDING'
                ? 'Awaiting approval'
                : undefined
            }
          />
        ),
      },
    );
    return base;
  }, [showValue]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Commercial Handover"
        title="Bookings"
        subtitle="A confirmed booking is the gateway to a project code."
        actions={
          canCreate && (
            <Button variant="primary" leadingIcon={<Plus />} onClick={() => setCreating(true)}>
              New booking
            </Button>
          )
        }
      />

      <MetricRow>
        <MetricCard
          label="Booked this month"
          loading={summaryLoading}
          value={summary?.bookedThisMonth.count ?? 0}
          foot={
            summary?.bookedThisMonth.projectValue !== undefined
              ? formatCurrencyShort(summary.bookedThisMonth.projectValue)
              : 'bookings'
          }
          state="good"
        />
        <MetricCard
          label="Drafts"
          loading={summaryLoading}
          value={summary?.draft ?? 0}
          foot="Not yet confirmed"
          onClick={() => resetPage(setStatus)('DRAFT')}
        />
        <MetricCard
          label="Awaiting approval"
          loading={summaryLoading}
          value={summary?.awaitingApproval ?? 0}
          state={summary?.awaitingApproval ? 'warn' : 'neutral'}
          foot={summary?.requiresApproval ? 'Confirmed, code on hold' : 'Approval is off'}
          onClick={() => resetPage(setStatus)('CONFIRMED')}
        />
        <MetricCard
          label="Email pending"
          loading={summaryLoading}
          value={summary?.emailPending ?? 0}
          state={summary?.emailPending ? 'warn' : 'neutral'}
          foot="Confirmed verbally"
          onClick={() => resetPage(setConfirmation)('EMAIL_PENDING')}
        />
        <MetricCard
          label="Email overdue"
          loading={summaryLoading}
          value={summary?.emailOverdue ?? 0}
          state={summary?.emailOverdue ? 'bad' : 'good'}
          foot="Past the reminder window"
          onClick={() => resetPage(setConfirmation)('EMAIL_PENDING')}
        />
        <MetricCard
          label="Active from booking"
          loading={summaryLoading}
          value={summary?.activeProjects ?? 0}
          foot={`${summary?.projectCreated ?? 0} projects created`}
          onClick={() => resetPage(setStatus)('PROJECT_CREATED')}
        />
      </MetricRow>

      <Panel
        flush
        title="Booking register"
        subtitle="Confirm with the client’s email or a verbal note; the project code follows."
        bodyClassName="mt-1"
      >
        <div className="flex flex-wrap items-end gap-2.5 border-y border-line px-4 py-3">
          <TextField
            label="Search"
            srOnlyLabel
            containerClassName="min-w-[200px] flex-1"
            placeholder="Booking no., project, client or code…"
            leadingIcon={<Search />}
            value={q}
            onChange={(event) => resetPage(setQ)(event.target.value)}
          />
          <SelectField
            label="Status"
            srOnlyLabel
            placeholder="Any status"
            containerClassName="w-40"
            value={status}
            onChange={(event) => resetPage(setStatus)(event.target.value)}
            options={[
              { value: 'DRAFT', label: 'Draft' },
              { value: 'CONFIRMED', label: 'Confirmed' },
              { value: 'PROJECT_CREATED', label: 'Project created' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
          />
          <SelectField
            label="Client"
            srOnlyLabel
            placeholder="All clients"
            containerClassName="w-44"
            value={clientId}
            onChange={(event) => resetPage(setClientId)(event.target.value)}
            options={(clients?.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
          <SelectField
            label="Office"
            srOnlyLabel
            placeholder="All offices"
            containerClassName="w-40"
            value={officeId}
            onChange={(event) => resetPage(setOfficeId)(event.target.value)}
            options={(lookups?.offices ?? []).map((o) => ({ value: o.id, label: o.name }))}
          />
          <SelectField
            label="Project type"
            srOnlyLabel
            placeholder="All types"
            containerClassName="w-40"
            value={projectTypeId}
            onChange={(event) => resetPage(setProjectTypeId)(event.target.value)}
            options={(lookups?.projectTypes ?? []).map((t) => ({
              value: t.id,
              label: `${t.name} (${t.shortCode})`,
            }))}
          />
          <SelectField
            label="Confirmation"
            srOnlyLabel
            placeholder="Any confirmation"
            containerClassName="w-44"
            value={confirmation}
            onChange={(event) =>
              resetPage(setConfirmation)(event.target.value as ConfirmationFilter)
            }
            options={[
              { value: 'EMAIL', label: 'Email' },
              { value: 'VERBAL', label: 'Verbal' },
              { value: 'EMAIL_PENDING', label: 'Email pending' },
            ]}
          />
          <TextField
            label="Booked from"
            type="date"
            containerClassName="w-40"
            value={from}
            onChange={(event) => resetPage(setFrom)(event.target.value)}
          />
          <TextField
            label="Booked to"
            type="date"
            containerClassName="w-40"
            value={to}
            onChange={(event) => resetPage(setTo)(event.target.value)}
          />
          {filtered && (
            <Button
              variant="subtle"
              onClick={() => {
                setQ('');
                setStatus('');
                setClientId('');
                setOfficeId('');
                setProjectTypeId('');
                setConfirmation('');
                setFrom('');
                setTo('');
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        <DataTable
          data={rows}
          columns={columns}
          loading={isLoading}
          minWidth={980}
          sorting={sorting}
          onSortingChange={(updater) => {
            setSorting(updater);
            setPage(1);
          }}
          getRowId={(row) => row.id}
          onRowClick={(row) => setOpenId(row.id)}
          empty={
            filtered ? (
              <EmptyState
                icon={<FileText />}
                title="No bookings match these filters"
                description="Clear a filter or two to widen the register."
              />
            ) : (
              <EmptyState
                icon={<FileCheck2 />}
                title="No bookings yet"
                description="Create a booking, attach the client’s confirmation and a project code follows."
                action={
                  canCreate ? (
                    <Button
                      size="sm"
                      variant="primary"
                      leadingIcon={<Plus />}
                      onClick={() => setCreating(true)}
                    >
                      New booking
                    </Button>
                  ) : undefined
                }
              />
            )
          }
        />

        {data && data.meta.totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
            <p className="text-sub text-muted">
              Page {data.meta.page} of {data.meta.totalPages} · {data.meta.total} bookings
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

      {creating && (
        <BookingFormDrawer
          booking={null}
          defaultClientId={clientId || undefined}
          onClose={() => setCreating(false)}
          onSaved={(saved) => setOpenId(saved.id)}
        />
      )}
      {openId && <BookingDrawer bookingId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
