import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Mail, Pencil, Plus, TrendingUp } from 'lucide-react';
import {
  costRateSchema,
  salarySchema,
  type CostRateInput,
  type SalaryInput,
} from '@opsvera/shared';
import { PageHeader } from '../components/layout/PageHeader';
import { Panel, Card } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { MetricCard, MetricRow } from '../components/ui/MetricCard';
import { Pill, StatusPill } from '../components/ui/Pill';
import { Tabs, TabPanel } from '../components/ui/Tabs';
import { Avatar } from '../components/ui/Avatar';
import { Dialog } from '../components/ui/Dialog';
import { EmptyState } from '../components/ui/EmptyState';
import { SkeletonText } from '../components/ui/Skeleton';
import { TextField } from '../components/ui/Field';
import { formatCurrency, formatDisplayDate, formatHours } from '../lib/format';
import { formatExclusiveEndInclusive } from '@opsvera/shared';
import { api, ApiRequestError } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';
import { EmployeeFormDrawer } from '../features/people/EmployeeFormDrawer';
import {
  peopleKeys,
  useCostRates,
  useEmployee,
  useSalaries,
  type EmployeeDetail,
} from '../features/people/usePeople';

export function EmployeeDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  // The tab lives in the URL so a person's cost history can be linked to
  // directly, the same way Settings works.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') ?? 'overview';
  const setTab = (key: string) =>
    setSearchParams(key === 'overview' ? {} : { tab: key }, { replace: true });
  const [editing, setEditing] = useState(false);
  const [addingRate, setAddingRate] = useState(false);
  const [addingSalary, setAddingSalary] = useState(false);

  const { data: employee, isLoading, error } = useEmployee(id);
  const canSeeCost = can('cost.view');
  const canSeeSalary = can('salary.view');
  const { data: costRates } = useCostRates(id, canSeeCost);
  const { data: salaries } = useSalaries(id, canSeeSalary);

  if (isLoading) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="People & Work" title="Loading…" />
        <Panel>
          <SkeletonText lines={6} />
        </Panel>
      </div>
    );
  }

  if (error || !employee) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="People & Work" title="Employee not found" />
        <Panel>
          <EmptyState
            title="That employee is not available"
            description="It may have been removed, or it sits outside what your role can see."
            action={
              <Button variant="primary" size="sm" onClick={() => navigate('/people')}>
                Back to People
              </Button>
            }
          />
        </Panel>
      </div>
    );
  }

  async function sendInvite() {
    try {
      await api.post(`/employees/${id}/invite`);
      await queryClient.invalidateQueries({ queryKey: peopleKeys.detail(id) });
      toast.success('Invitation sent');
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'Could not send the invitation.');
    }
  }

  const present = employee.attendanceSummary.PRESENT ?? 0;
  const late = employee.attendanceSummary.LATE ?? 0;
  const absent = employee.attendanceSummary.ABSENT ?? 0;

  return (
    <div className="space-y-5">
      <Link
        to="/people"
        className="inline-flex items-center gap-1.5 rounded text-sub font-heavy text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        Back to People
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3.5">
          <Avatar name={employee.fullName} size="lg" />
          <div>
            <p className="text-micro font-heavy uppercase text-blue">
              {employee.designation?.name ?? 'People & Work'}
            </p>
            <h1 className="mt-1 text-display font-black text-ink">{employee.fullName}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Pill tone="gray" dot={false}>
                {employee.employeeCode}
              </Pill>
              <StatusPill status={employee.status} />
              <Pill tone="blue" dot={false}>
                {employee.office.name}
              </Pill>
              <span className="text-sub text-muted">{employee.office.timezone}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {can('employee.edit') && !employee.user && employee.workEmail && (
            <Button variant="ghost" leadingIcon={<Mail />} onClick={sendInvite}>
              Send invite
            </Button>
          )}
          {can('employee.edit') && (
            <Button variant="primary" leadingIcon={<Pencil />} onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>
      </div>

      <MetricRow>
        <MetricCard label="Present (30d)" value={present} state="good" foot={`${late} late`} />
        <MetricCard
          label="Absent (30d)"
          value={absent}
          state={absent > 0 ? 'warn' : 'good'}
          foot="Excludes leave"
        />
        <MetricCard
          label="Hours logged"
          value={formatHours(employee.hoursSummary.totalHours)}
          foot={`${formatHours(employee.hoursSummary.billableHours)} billable`}
        />
        <MetricCard
          label="Active projects"
          value={employee.projects.length}
          foot="Current member"
        />
        <MetricCard
          label="Direct reports"
          value={employee.directReports.length}
          foot="Reporting line"
        />
        {canSeeCost && (
          <MetricCard
            label="Cost rate"
            value={employee.hourlyRate ? formatCurrency(employee.hourlyRate, '₹', 2) : '—'}
            foot="Per hour, current"
          />
        )}
      </MetricRow>

      <Tabs
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'projects', label: 'Projects', count: employee.projects.length },
          { key: 'leave', label: 'Leave balance', count: employee.leaveBalances.length },
          ...(canSeeCost ? [{ key: 'cost', label: 'Cost rate history' }] : []),
          ...(canSeeSalary ? [{ key: 'salary', label: 'Salary history' }] : []),
          { key: 'team', label: 'Reporting', count: employee.directReports.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      <TabPanel>
        {tab === 'overview' && <OverviewTab employee={employee} />}

        {tab === 'projects' && (
          <Panel title="Current projects" subtitle="Active projects this person is a member of.">
            {employee.projects.length === 0 ? (
              <EmptyState
                title="Not on any active project"
                description="They have not been added to a project team yet."
              />
            ) : (
              <div className="grid gap-2">
                {employee.projects.map((project) => (
                  <Link
                    key={project.id}
                    to={`/projects/${project.id}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line-soft bg-surface-2 p-3 transition-colors hover:border-blue-2/40 hover:bg-pill-blue-bg/30"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-body font-heavy text-ink">{project.name}</p>
                      <p className="mt-0.5 truncate text-sub text-muted">
                        {project.projectCode}
                        {project.roleOnProject ? ` · ${project.roleOnProject}` : ''}
                      </p>
                    </div>
                    <StatusPill status={project.health} />
                  </Link>
                ))}
              </div>
            )}
          </Panel>
        )}

        {tab === 'leave' && (
          <Panel title="Leave balance" subtitle={`For ${new Date().getFullYear()}.`}>
            {employee.leaveBalances.length === 0 ? (
              <EmptyState
                title="No leave balances"
                description="No leave types have been allocated for this year."
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {employee.leaveBalances.map((balance) => (
                  <Card key={balance.leaveType.id}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sub font-heavy text-ink">{balance.leaveType.name}</p>
                      <Pill tone="gray" dot={false}>
                        {balance.leaveType.shortCode}
                      </Pill>
                    </div>
                    <p className="mt-2 text-metric font-black">{Number(balance.available)}</p>
                    <p className="mt-1 text-sub text-muted">
                      days available · {Number(balance.used)} used
                      {Number(balance.pending) > 0 && ` · ${Number(balance.pending)} pending`}
                    </p>
                  </Card>
                ))}
              </div>
            )}
          </Panel>
        )}

        {tab === 'cost' && canSeeCost && (
          <HistoryPanel
            title="Cost rate history"
            subtitle="Costing always uses the rate effective on the work date, so rates are added — never edited."
            rows={(costRates ?? []).map((rate) => ({
              id: rate.id,
              amount: `${formatCurrency(rate.hourlyRate, '₹', 2)} / hour`,
              from: rate.effectiveFrom,
              to: rate.effectiveTo,
              note: rate.note,
            }))}
            canEdit={can('cost.edit')}
            onAdd={() => setAddingRate(true)}
            addLabel="Add rate"
          />
        )}

        {tab === 'salary' && canSeeSalary && (
          <HistoryPanel
            title="Salary history"
            subtitle="Monthly salary with effective dates."
            rows={(salaries ?? []).map((salary) => ({
              id: salary.id,
              amount: `${formatCurrency(salary.monthlyAmount, '₹', 2)} / month`,
              from: salary.effectiveFrom,
              to: salary.effectiveTo,
              note: salary.note,
            }))}
            canEdit={can('salary.edit')}
            onAdd={() => setAddingSalary(true)}
            addLabel="Add salary"
          />
        )}

        {tab === 'team' && (
          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="Reports to">
              {employee.manager ? (
                <Link
                  to={`/people/${employee.manager.id}`}
                  className="flex items-center gap-3 rounded-xl border border-line-soft bg-surface-2 p-3 transition-colors hover:border-blue-2/40"
                >
                  <Avatar
                    name={`${employee.manager.firstName} ${employee.manager.lastName}`}
                    size="sm"
                  />
                  <div>
                    <p className="text-body font-heavy text-ink">
                      {employee.manager.firstName} {employee.manager.lastName}
                    </p>
                    <p className="text-sub text-muted">{employee.manager.employeeCode}</p>
                  </div>
                </Link>
              ) : (
                <EmptyState
                  title="No manager set"
                  description="This person sits at the top of their reporting line."
                />
              )}
            </Panel>

            <Panel title="Direct reports" subtitle="Drives TEAM data scope and approvals.">
              {employee.directReports.length === 0 ? (
                <EmptyState title="No direct reports" />
              ) : (
                <div className="grid gap-2">
                  {employee.directReports.map((report) => (
                    <Link
                      key={report.id}
                      to={`/people/${report.id}`}
                      className="flex items-center gap-3 rounded-xl border border-line-soft bg-surface-2 p-2.5 transition-colors hover:border-blue-2/40"
                    >
                      <Avatar name={`${report.firstName} ${report.lastName}`} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-body font-heavy text-ink">
                          {report.firstName} {report.lastName}
                        </p>
                        <p className="text-sub text-muted">{report.employeeCode}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        )}
      </TabPanel>

      {editing && <EmployeeFormDrawer employee={employee} onClose={() => setEditing(false)} />}

      {addingRate && (
        <AddRateDialog employeeId={id} kind="cost" onClose={() => setAddingRate(false)} />
      )}
      {addingSalary && (
        <AddRateDialog employeeId={id} kind="salary" onClose={() => setAddingSalary(false)} />
      )}
    </div>
  );
}

function OverviewTab({ employee }: { employee: EmployeeDetail }) {
  const rows: Array<[string, string]> = [
    ['Employee code', employee.employeeCode],
    ['Work email', employee.workEmail ?? '—'],
    ['Phone', employee.phone ?? '—'],
    ['Office', `${employee.office.name} (${employee.office.timezone})`],
    ['Department', employee.department?.name ?? '—'],
    ['Designation', employee.designation?.name ?? '—'],
    ['Joining date', formatDisplayDate(employee.joiningDate)],
    ['Exit date', employee.exitDate ? formatDisplayDate(employee.exitDate) : '—'],
    [
      'Attendance method',
      { MOBILE: 'Mobile only', OFFICE: 'Office only', BOTH: 'Mobile + Office' }[
        employee.attendanceMethod
      ],
    ],
    [
      'Emergency contact',
      employee.emergencyName ? `${employee.emergencyName} · ${employee.emergencyPhone ?? ''}` : '—',
    ],
  ];

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.6fr)]">
      <Panel title="Profile">
        <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-micro font-heavy uppercase text-muted">{label}</dt>
              <dd className="mt-0.5 truncate text-body text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel title="Login">
        {employee.user ? (
          <div className="space-y-2.5">
            <div>
              <p className="text-micro font-heavy uppercase text-muted">Email</p>
              <p className="mt-0.5 truncate text-body text-ink">{employee.user.email}</p>
            </div>
            <div>
              <p className="text-micro font-heavy uppercase text-muted">Status</p>
              <p className="mt-1">
                <StatusPill status={employee.user.status} />
              </p>
            </div>
            <div>
              <p className="text-micro font-heavy uppercase text-muted">Last signed in</p>
              <p className="mt-0.5 text-body text-ink">
                {employee.user.lastLoginAt ? formatDisplayDate(employee.user.lastLoginAt) : 'Never'}
              </p>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<Mail />}
            title="No login yet"
            description={
              employee.workEmail
                ? 'Send an invitation so they can sign in.'
                : 'Add a work email first, then send an invitation.'
            }
          />
        )}
      </Panel>
    </div>
  );
}

function HistoryPanel({
  title,
  subtitle,
  rows,
  canEdit,
  onAdd,
  addLabel,
}: {
  title: string;
  subtitle: string;
  rows: Array<{ id: string; amount: string; from: string; to: string | null; note: string | null }>;
  canEdit: boolean;
  onAdd: () => void;
  addLabel: string;
}) {
  return (
    <Panel
      title={title}
      subtitle={subtitle}
      action={
        canEdit && (
          <Button size="sm" variant="primary" leadingIcon={<Plus />} onClick={onAdd}>
            {addLabel}
          </Button>
        )
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<TrendingUp />}
          title="No history yet"
          description="Nothing has been recorded for this person."
          action={
            canEdit && (
              <Button size="sm" variant="primary" leadingIcon={<Plus />} onClick={onAdd}>
                {addLabel}
              </Button>
            )
          }
        />
      ) : (
        <ol className="relative space-y-2 border-l border-line pl-5">
          {rows.map((row, index) => (
            <li key={row.id} className="relative">
              <span
                aria-hidden
                className={`absolute -left-[26px] top-3 size-2.5 rounded-full border-2 border-surface ${
                  index === 0 ? 'bg-green' : 'bg-line'
                }`}
              />
              <div className="rounded-xl border border-line-soft bg-surface-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-body font-heavy tabular-nums text-ink">{row.amount}</p>
                  {index === 0 && !row.to && (
                    <Pill tone="green" dot={false}>
                      Current
                    </Pill>
                  )}
                </div>
                <p className="mt-1 text-sub text-muted">
                  {/*
                    `effectiveTo` is stored exclusively — it is the day the next
                    row starts. Displaying it as-is would read as though this
                    rate still applied on that date, so it is shown as the last
                    day it actually covered.
                  */}
                  From {formatDisplayDate(row.from)}
                  {row.to ? ` to ${formatExclusiveEndInclusive(row.to)}` : ' — ongoing'}
                  {row.note ? ` · ${row.note}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function AddRateDialog({
  employeeId,
  kind,
  onClose,
}: {
  employeeId: string;
  kind: 'cost' | 'salary';
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isCost = kind === 'cost';

  const form = useForm<CostRateInput & SalaryInput>({
    resolver: zodResolver((isCost ? costRateSchema : salarySchema) as never),
    defaultValues: {
      effectiveFrom: new Date().toISOString().slice(0, 10),
      note: '',
    } as never,
  });

  async function submit(values: CostRateInput & SalaryInput) {
    try {
      const response = await api.post<{ warning?: string | null }>(
        `/employees/${employeeId}/${isCost ? 'cost-rates' : 'salaries'}`,
        isCost
          ? {
              hourlyRate: values.hourlyRate,
              effectiveFrom: values.effectiveFrom,
              note: values.note,
            }
          : {
              monthlyAmount: values.monthlyAmount,
              effectiveFrom: values.effectiveFrom,
              note: values.note,
            },
      );

      await queryClient.invalidateQueries({ queryKey: ['people'] });
      toast.success(isCost ? 'Cost rate added' : 'Salary added');

      // A backdated rate does not restate cost already posted — say so.
      if (response?.warning) toast.warning(response.warning, { duration: 10_000 });
      onClose();
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not save.');
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={isCost ? 'Add cost rate' : 'Add salary'}
      description={
        isCost
          ? 'The previous rate is closed off at this date. Cost already posted keeps the rate used at the time.'
          : 'The previous salary is closed off at this date.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={form.formState.isSubmitting}
            onClick={form.handleSubmit(submit)}
          >
            Add
          </Button>
        </>
      }
    >
      <form className="space-y-3" noValidate onSubmit={form.handleSubmit(submit)}>
        <TextField
          label={isCost ? 'Hourly cost rate' : 'Monthly salary'}
          required
          placeholder={isCost ? '700.00' : '78000.00'}
          error={
            isCost
              ? form.formState.errors.hourlyRate?.message
              : form.formState.errors.monthlyAmount?.message
          }
          {...form.register(isCost ? 'hourlyRate' : 'monthlyAmount')}
        />
        <TextField
          label="Effective from"
          type="date"
          required
          hint="Time logged on or after this date is costed at the new figure."
          error={form.formState.errors.effectiveFrom?.message}
          {...form.register('effectiveFrom')}
        />
        <TextField label="Note" placeholder="Annual revision" {...form.register('note')} />
      </form>
    </Dialog>
  );
}
