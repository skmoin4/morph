import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export type ReportKey =
  'bookings' | 'attendance' | 'leave' | 'timesheets' | 'project-cost' | 'expenses' | 'utilization';

export type ReportFilter = 'range' | 'office' | 'project' | 'employee' | 'status';
export type ColumnType = 'text' | 'number' | 'money' | 'hours' | 'percent' | 'date' | 'status';

export interface ReportCatalog {
  reports: Array<{
    key: ReportKey;
    title: string;
    description: string;
    filters: ReportFilter[];
    statuses: string[] | null;
  }>;
  offices: Array<{ id: string; name: string; shortCode: string }>;
}

export interface ReportFilters {
  from?: string;
  to?: string;
  officeId?: string;
  projectId?: string;
  employeeId?: string;
  status?: string;
}

export interface ReportResult {
  key: ReportKey;
  title: string;
  description: string;
  from: string;
  to: string;
  generatedAt: string;
  columns: Array<{ key: string; label: string; type: ColumnType }>;
  rows: Array<Record<string, string | number | null>>;
  totals: Record<string, string | number | null> | null;
  truncated: boolean;
}

export const reportKeys = {
  catalog: ['reports', 'catalog'] as const,
  run: (key: string, filters: ReportFilters) => ['reports', 'run', key, filters] as const,
};

export function useReportCatalog() {
  return useQuery({
    queryKey: reportKeys.catalog,
    queryFn: () => api.get<ReportCatalog>('/reports'),
    staleTime: 5 * 60_000,
  });
}

export function useReport(key: ReportKey | undefined, filters: ReportFilters) {
  return useQuery({
    queryKey: reportKeys.run(key ?? '', filters),
    queryFn: () => api.get<ReportResult>(`/reports/${key}`, { ...filters }),
    enabled: !!key,
    placeholderData: keepPreviousData,
  });
}

export function downloadReport(key: ReportKey, filters: ReportFilters) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  const qs = params.toString();
  const from = filters.from ?? 'start';
  const to = filters.to ?? 'today';
  return api.download(
    `/reports/${key}/export${qs ? `?${qs}` : ''}`,
    `report-${key}-${from}-to-${to}.xlsx`,
  );
}
