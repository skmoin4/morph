import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { Download, Mail, Plus, Search, Upload, Users } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { CellStack, DataTable } from '../components/ui/DataTable';
import { MetricCard, MetricRow } from '../components/ui/MetricCard';
import { Pill, StatusPill } from '../components/ui/Pill';
import { EmptyState } from '../components/ui/EmptyState';
import { SelectField, TextField } from '../components/ui/Field';
import { formatCurrency, formatDisplayDate } from '../lib/format';
import { useAuth } from '../providers/AuthProvider';
import { useDepartments, useOffices } from '../features/settings/useSettings';
import { useEmployees, type EmployeeListItem } from '../features/people/usePeople';
import {
  ATTENDANCE_METHOD_LABEL,
  buildPeopleCsv,
  downloadCsv,
  fetchAllForExport,
} from '../features/people/exportPeople';
import { EmployeeFormDrawer } from '../features/people/EmployeeFormDrawer';
import { ImportDrawer } from '../features/people/ImportDrawer';

export function PeoplePage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canCreate = can('employee.create');
  const canSeeCost = can('cost.view');
  const canSeeSalary = can('salary.view');

  const [q, setQ] = useState('');
  const [officeId, setOfficeId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const filters = useMemo(
    () => ({
      q: q || undefined,
      officeId: officeId || undefined,
      departmentId: departmentId || undefined,
      status: status || undefined,
      page,
    }),
    [q, officeId, departmentId, status, page],
  );

  const { data, isLoading, isFetching } = useEmployees(filters);
  const { data: offices } = useOffices();
  const { data: departments } = useDepartments();

  const rows = data?.data ?? [];

  async function handleExport() {
    setExporting(true);
    try {
      const everything = await fetchAllForExport(filters);
      downloadCsv(
        `opsvera-people-${new Date().toISOString().slice(0, 10)}.csv`,
        buildPeopleCsv(everything, { includeCost: canSeeCost, includeSalary: canSeeSalary }),
      );
      toast.success(`Exported ${everything.length} people`);
    } catch {
      toast.error('Could not build the export. Try again.');
    } finally {
      setExporting(false);
    }
  }

  const columns = useMemo<ColumnDef<EmployeeListItem, unknown>[]>(() => {
    const base: ColumnDef<EmployeeListItem, unknown>[] = [
      {
        header: 'Employee',
        accessorKey: 'fullName',
        meta: { className: 'w-[26%] max-w-0' },
        cell: ({ row }) => (
          <CellStack
            title={row.original.fullName}
            subtitle={`${row.original.employeeCode}${row.original.designation ? ` · ${row.original.designation.name}` : ''}`}
          />
        ),
      },
      {
        header: 'Office',
        accessorKey: 'office',
        cell: ({ row }) => (
          <CellStack
            title={row.original.office.shortCode}
            subtitle={row.original.department?.name ?? '—'}
          />
        ),
      },
      {
        header: 'Reports to',
        accessorKey: 'manager',
        cell: ({ row }) =>
          row.original.manager ? (
            <span className="whitespace-nowrap">
              {row.original.manager.firstName} {row.original.manager.lastName}
            </span>
          ) : (
            <span className="text-muted">—</span>
          ),
      },
      {
        header: 'Attendance',
        accessorKey: 'attendanceMethod',
        cell: ({ row }) => (
          <Pill tone="blue" dot={false}>
            {ATTENDANCE_METHOD_LABEL[row.original.attendanceMethod]}
          </Pill>
        ),
      },
      {
        header: 'Joined',
        accessorKey: 'joiningDate',
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{formatDisplayDate(row.original.joiningDate)}</span>
        ),
      },
    ];

    // Only rendered when the caller can see cost — the API strips the value
    // regardless, so showing an always-empty column would be noise.
    if (canSeeCost) {
      base.push({
        header: 'Cost rate',
        accessorKey: 'hourlyRate',
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {row.original.hourlyRate ? `${formatCurrency(row.original.hourlyRate, '₹', 2)}/h` : '—'}
          </span>
        ),
      });
    }

    base.push(
      {
        header: 'Login',
        accessorKey: 'user',
        cell: ({ row }) =>
          row.original.user ? (
            <Pill tone={row.original.user.status === 'ACTIVE' ? 'green' : 'amber'} dot={false}>
              {row.original.user.status === 'ACTIVE' ? 'Active' : 'Invited'}
            </Pill>
          ) : (
            <Pill tone="gray" dot={false} icon={<Mail />}>
              No login
            </Pill>
          ),
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => <StatusPill status={row.original.status} />,
      },
    );

    return base;
  }, [canSeeCost]);

  const counts = useMemo(() => {
    const byMethod = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.attendanceMethod] = (acc[row.attendanceMethod] ?? 0) + 1;
      return acc;
    }, {});
    return {
      total: data?.meta.total ?? 0,
      withoutLogin: rows.filter((r) => !r.user).length,
      mobile: (byMethod.MOBILE ?? 0) + (byMethod.BOTH ?? 0),
      offices: new Set(rows.map((r) => r.office.id)).size,
    };
  }, [rows, data?.meta.total]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="People & Work"
        title="People"
        subtitle="Employees, reporting lines, cost rates and logins."
        actions={
          canCreate && (
            <>
              <Button variant="ghost" leadingIcon={<Upload />} onClick={() => setImporting(true)}>
                Import
              </Button>
              <Button variant="primary" leadingIcon={<Plus />} onClick={() => setCreating(true)}>
                Add employee
              </Button>
            </>
          )
        }
      />

      <MetricRow>
        <MetricCard label="People in view" value={counts.total} foot="Within your data scope" />
        <MetricCard label="Offices" value={counts.offices} foot="On this page" />
        <MetricCard label="Mobile punching" value={counts.mobile} foot="GPS + selfie enabled" />
        <MetricCard
          label="No login yet"
          value={counts.withoutLogin}
          state={counts.withoutLogin > 0 ? 'warn' : 'good'}
          foot="Invitation not sent"
        />
      </MetricRow>

      <Panel flush>
        <div className="flex flex-wrap items-end gap-2.5 border-b border-line px-4 py-3">
          <TextField
            label="Search"
            srOnlyLabel
            containerClassName="min-w-[200px] flex-1"
            placeholder="Name, code or email…"
            leadingIcon={<Search />}
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
          <SelectField
            label="Office"
            srOnlyLabel
            placeholder="All offices"
            containerClassName="w-44"
            value={officeId}
            onChange={(event) => {
              setOfficeId(event.target.value);
              setPage(1);
            }}
            options={(offices?.data ?? []).map((o) => ({ value: o.id, label: o.name }))}
          />
          <SelectField
            label="Department"
            srOnlyLabel
            placeholder="All departments"
            containerClassName="w-48"
            value={departmentId}
            onChange={(event) => {
              setDepartmentId(event.target.value);
              setPage(1);
            }}
            options={(departments?.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
          />
          <SelectField
            label="Status"
            srOnlyLabel
            placeholder="Any status"
            containerClassName="w-40"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'NOTICE_PERIOD', label: 'Notice period' },
              { value: 'INACTIVE', label: 'Inactive' },
              { value: 'EXITED', label: 'Exited' },
            ]}
          />
          <Button
            variant="ghost"
            leadingIcon={<Download />}
            onClick={handleExport}
            loading={exporting}
            disabled={rows.length === 0 || exporting}
          >
            Export
          </Button>
        </div>

        <DataTable
          data={rows}
          columns={columns}
          loading={isLoading}
          minWidth={canSeeCost ? 1040 : 920}
          getRowId={(row) => row.id}
          onRowClick={(row) => navigate(`/people/${row.id}`)}
          empty={
            <EmptyState
              icon={<Users />}
              title="No people match these filters"
              description="Clear the filters, or add your first employee."
              action={
                canCreate && (
                  <Button
                    size="sm"
                    variant="primary"
                    leadingIcon={<Plus />}
                    onClick={() => setCreating(true)}
                  >
                    Add employee
                  </Button>
                )
              }
            />
          }
        />

        {data && data.meta.totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
            <p className="text-sub text-muted">
              Page {data.meta.page} of {data.meta.totalPages} · {data.meta.total} people
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

      {creating && <EmployeeFormDrawer employee={null} onClose={() => setCreating(false)} />}
      {importing && <ImportDrawer onClose={() => setImporting(false)} />}
    </div>
  );
}
