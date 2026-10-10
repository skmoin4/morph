import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useState } from 'react';
import { BarChart3, Download } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { SelectField, TextField } from '../components/ui/Field';
import { Panel } from '../components/ui/Panel';
import { humanizeStatus, StatusPill } from '../components/ui/Pill';
import { Skeleton } from '../components/ui/Skeleton';
import { ApiRequestError } from '../lib/api';
import { cn } from '../lib/cn';
import { formatDisplayDate, formatIndianNumber } from '../lib/format';
import { useAuth } from '../providers/AuthProvider';
import { useEmployees } from '../features/people/usePeople';
import { useProjects } from '../features/projects/useProjects';
import {
  downloadReport,
  useReport,
  useReportCatalog,
  type ColumnType,
  type ReportFilters,
  type ReportKey,
  type ReportResult,
} from '../features/reports/useReports';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Quick periods, in the browser's local calendar. */
function presets(
  now = new Date(),
): Array<{ key: string; label: string; from: string; to: string }> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const ago = (days: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  return [
    { key: 'month', label: 'This month', from: ymd(monthStart), to: ymd(now) },
    { key: 'last-month', label: 'Last month', from: ymd(lastStart), to: ymd(lastEnd) },
    { key: '7', label: 'Last 7 days', from: ymd(ago(6)), to: ymd(now) },
    { key: '30', label: 'Last 30 days', from: ymd(ago(29)), to: ymd(now) },
  ];
}

function Cell({ type, value }: { type: ColumnType; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-2">—</span>;
  }
  switch (type) {
    case 'money':
      return <>{formatIndianNumber(value, 2)}</>;
    case 'hours':
      return <>{formatIndianNumber(value, 2)}</>;
    case 'percent':
      return <>{value}%</>;
    case 'number':
      return <>{formatIndianNumber(value, Number.isInteger(Number(value)) ? 0 : 2)}</>;
    case 'date':
      return <>{formatDisplayDate(String(value))}</>;
    case 'status':
      return <StatusPill status={String(value)} label={humanizeStatus(String(value))} />;
    default:
      return <>{String(value)}</>;
  }
}

const NUMERIC: ColumnType[] = ['money', 'hours', 'percent', 'number'];

function ResultTable({ result }: { result: ReportResult }) {
  if (result.rows.length === 0) {
    return (
      <EmptyState
        icon={<BarChart3 />}
        title="Nothing in this period"
        description="Try a wider period or fewer filters."
      />
    );
  }
  return (
    <div className="scroll-slim max-h-[620px] overflow-auto rounded-card border border-line">
      <table className="w-full text-body">
        <thead className="sticky top-0 z-10 bg-surface-2 text-left text-micro uppercase text-muted">
          <tr>
            {result.columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  'whitespace-nowrap px-3 py-2 font-heavy',
                  NUMERIC.includes(c.type) && 'text-right',
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i} className="border-t border-line hover:bg-surface-2">
              {result.columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    'max-w-[280px] truncate px-3 py-2',
                    NUMERIC.includes(c.type) && 'text-right tabular-nums',
                  )}
                  title={typeof row[c.key] === 'string' ? String(row[c.key]) : undefined}
                >
                  <Cell type={c.type} value={row[c.key]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {result.totals && (
          <tfoot className="sticky bottom-0 bg-surface-2 font-heavy">
            <tr className="border-t-2 border-line">
              {result.columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    'whitespace-nowrap px-3 py-2',
                    NUMERIC.includes(c.type) && 'text-right tabular-nums',
                  )}
                >
                  <Cell type={c.type} value={result.totals?.[c.key] ?? null} />
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export function ReportsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [exporting, setExporting] = useState(false);
  const catalog = useReportCatalog();

  const reports = catalog.data?.reports ?? [];
  const selected = reports.find((r) => r.key === params.get('report')) ?? reports[0];
  const key = selected?.key as ReportKey | undefined;

  const quick = useMemo(() => presets(), []);
  const filters: ReportFilters = {
    from: params.get('from') ?? quick[0].from,
    to: params.get('to') ?? quick[0].to,
    officeId: params.get('officeId') || undefined,
    projectId: params.get('projectId') || undefined,
    employeeId: params.get('employeeId') || undefined,
    status: params.get('status') || undefined,
  };
  // Only send the filters the chosen report understands.
  const uses = (f: string) => !!selected?.filters.includes(f as never);
  const effective: ReportFilters = {
    from: filters.from,
    to: filters.to,
    officeId: uses('office') ? filters.officeId : undefined,
    projectId: uses('project') ? filters.projectId : undefined,
    employeeId: uses('employee') ? filters.employeeId : undefined,
    status: uses('status') ? filters.status : undefined,
  };
  const invalid = !!effective.from && !!effective.to && effective.from > effective.to;

  const report = useReport(invalid ? undefined : key, effective);
  const projects = useProjects({ pageSize: 100 });
  const employees = useEmployees({ pageSize: 100 }, { enabled: can('employee.view') });

  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const pick = (next: ReportKey) => {
    // Filters carry across reports, except status, whose values differ per report.
    const keep = new URLSearchParams(params);
    keep.set('report', next);
    keep.delete('status');
    setParams(keep, { replace: true });
  };

  const activePreset = quick.find((p) => p.from === filters.from && p.to === filters.to)?.key;

  const doExport = async () => {
    if (!key) return;
    setExporting(true);
    try {
      await downloadReport(key, effective);
    } catch (error) {
      toast.error(
        error instanceof ApiRequestError && error.status === 403
          ? 'You do not have permission to export reports.'
          : 'The export failed. Please try again.',
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Insights"
        title="Reports"
        subtitle="Choose a report and a period. The Excel file is exactly what you see here."
        actions={
          can('report.export') && (
            <Button
              variant="primary"
              leadingIcon={<Download />}
              loading={exporting}
              disabled={!key || invalid || !report.data}
              onClick={() => void doExport()}
            >
              Export to Excel
            </Button>
          )
        }
      />

      {catalog.isLoading ? (
        <Skeleton className="h-64 rounded-card" />
      ) : catalog.isError || reports.length === 0 ? (
        <EmptyState
          icon={<BarChart3 />}
          title="No reports for your role"
          description="Reports follow the modules you can open. Ask an administrator for access."
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
          <nav aria-label="Reports" className="scroll-slim flex gap-2 overflow-x-auto lg:flex-col">
            {reports.map((r) => (
              <button
                key={r.key}
                type="button"
                aria-current={r.key === key ? 'true' : undefined}
                onClick={() => pick(r.key)}
                className={cn(
                  'min-w-[170px] rounded-card border p-3 text-left transition-colors lg:min-w-0',
                  r.key === key
                    ? 'border-blue bg-pill-blue-bg/60'
                    : 'border-line bg-surface hover:bg-surface-2',
                )}
              >
                <span className="block text-body font-heavy text-ink">{r.title}</span>
                <span className="mt-0.5 hidden text-sub text-muted lg:block">{r.description}</span>
              </button>
            ))}
          </nav>

          <div className="min-w-0 space-y-4">
            <Panel title={selected?.title} subtitle={selected?.description}>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick periods">
                {quick.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    aria-pressed={activePreset === p.key}
                    onClick={() => set({ from: p.from, to: p.to })}
                    className={cn(
                      'rounded-full border px-3 py-1 text-sub font-heavy transition-colors',
                      activePreset === p.key
                        ? 'border-blue bg-pill-blue-bg text-pill-blue-fg'
                        : 'border-line bg-surface text-ink-2 hover:bg-surface-2',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <TextField
                  label="From"
                  type="date"
                  value={filters.from ?? ''}
                  onChange={(e) => set({ from: e.target.value || undefined })}
                />
                <TextField
                  label="To"
                  type="date"
                  value={filters.to ?? ''}
                  error={invalid ? 'Must be on or after the start date' : undefined}
                  onChange={(e) => set({ to: e.target.value || undefined })}
                />
                {uses('office') && (catalog.data?.offices.length ?? 0) > 1 && (
                  <SelectField
                    label="Office"
                    value={filters.officeId ?? ''}
                    onChange={(e) => set({ officeId: e.target.value || undefined })}
                    options={[
                      { value: '', label: 'All offices' },
                      ...(catalog.data?.offices ?? []).map((o) => ({
                        value: o.id,
                        label: o.name,
                      })),
                    ]}
                  />
                )}
                {uses('status') && selected?.statuses && (
                  <SelectField
                    label="Status"
                    value={filters.status ?? ''}
                    onChange={(e) => set({ status: e.target.value || undefined })}
                    options={[
                      { value: '', label: 'Any status' },
                      ...selected.statuses.map((s) => ({ value: s, label: humanizeStatus(s) })),
                    ]}
                  />
                )}
                {uses('project') && (projects.data?.data.length ?? 0) > 0 && (
                  <SelectField
                    label="Project"
                    value={filters.projectId ?? ''}
                    onChange={(e) => set({ projectId: e.target.value || undefined })}
                    options={[
                      { value: '', label: 'All projects' },
                      ...(projects.data?.data ?? []).map((p) => ({
                        value: p.id,
                        label: `${p.projectCode} · ${p.name}`,
                      })),
                    ]}
                  />
                )}
                {uses('employee') && (employees.data?.data.length ?? 0) > 0 && (
                  <SelectField
                    label="Person"
                    value={filters.employeeId ?? ''}
                    onChange={(e) => set({ employeeId: e.target.value || undefined })}
                    options={[
                      { value: '', label: 'Everyone' },
                      ...(employees.data?.data ?? []).map((p) => ({
                        value: p.id,
                        label: p.fullName,
                      })),
                    ]}
                  />
                )}
              </div>
            </Panel>

            <Panel
              flush
              bodyClassName="p-4"
              title={
                report.data ? (
                  <>
                    {report.data.rows.length} row{report.data.rows.length === 1 ? '' : 's'}
                    <span className="ml-2 text-sub font-normal text-muted">
                      {formatDisplayDate(report.data.from)} – {formatDisplayDate(report.data.to)}
                    </span>
                  </>
                ) : (
                  'Result'
                )
              }
            >
              {invalid ? (
                <p className="text-sub text-muted">Fix the period to see the report.</p>
              ) : report.isError ? (
                <EmptyState
                  icon={<BarChart3 />}
                  title={
                    report.error instanceof ApiRequestError && report.error.status === 400
                      ? report.error.message
                      : 'The report could not be loaded'
                  }
                  description="Check the period and filters, then try again."
                  action={
                    <Button variant="secondary" onClick={() => void report.refetch()}>
                      Try again
                    </Button>
                  }
                />
              ) : report.data ? (
                <div className={cn(report.isFetching && 'opacity-60 transition-opacity')}>
                  {report.data.truncated && (
                    <p className="mb-3 rounded-control bg-pill-amber-bg px-3 py-2 text-sub text-pill-amber-fg">
                      This report is long, so only the first rows are shown and exported. Narrow the
                      period or the filters to see the rest.
                    </p>
                  )}
                  <ResultTable result={report.data} />
                </div>
              ) : (
                <Skeleton className="h-48 rounded-card" />
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
