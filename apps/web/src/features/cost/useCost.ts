import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CostAdjustmentInput, ReverseEntryInput } from '@opsvera/shared';
import { api } from '../../lib/api';
import type { Paginated } from '../settings/useSettings';

export interface CostSummary {
  project: {
    id: string;
    projectCode: string;
    name: string;
    status: string;
    health: string;
    office: string;
  };
  budgetHours: number;
  actualHours: number;
  burnPercent: number | null;
  alertLevel: 0 | 80 | 100;
  hoursRemaining: number;
  actualLabourCost: string;
  actualExpenseCost: string;
  actualTotalCost: string;
  /** Absent when the caller lacks the matching permission. */
  projectValue?: string;
  marginAmount?: string;
  marginPercent?: number | null;
  costPerHour: string | null;
  bySource: Record<'TIMESHEET' | 'EXPENSE' | 'ADJUSTMENT', { hours: number; amount: string }>;
  byEmployee: Array<{
    employee: { id: string; fullName: string; employeeCode: string };
    hours: number;
    amount: string;
  }>;
  series: Array<{ date: string; hours: number; cost: string }>;
  reconciled: boolean;
  drift: string[];
}

export interface RateSegment {
  from: string;
  to: string;
  hours: string;
  rate: string;
  amount: string;
}

export interface LedgerRow {
  id: string;
  postingDate: string;
  sourceType: 'TIMESHEET' | 'EXPENSE' | 'ADJUSTMENT';
  sourceId: string;
  sourceLabel: string;
  postingVersion: number;
  isReversal: boolean;
  reversesId: string | null;
  reversed: boolean;
  hours: number | null;
  rateApplied: number | null;
  rateBreakdown: RateSegment[] | null;
  amount: string;
  description: string | null;
  employee: { id: string; fullName: string; employeeCode: string } | null;
  postedBy: string | null;
  canReverse: boolean;
}

export interface LedgerPage extends Paginated<LedgerRow> {
  meta: Paginated<LedgerRow>['meta'] & { netAmount: string; netHours: number };
}

export interface OverviewRow {
  id: string;
  projectCode: string;
  name: string;
  client: string;
  office: string;
  status: string;
  health: string;
  budgetHours: number;
  actualHours: number;
  burnPercent: number | null;
  alertLevel: 0 | 80 | 100;
  actualLabourCost: string;
  actualExpenseCost: string;
  actualTotalCost: string;
  projectValue?: string;
  marginAmount?: string;
  marginPercent?: number | null;
}

export interface OverviewPage extends Paginated<OverviewRow> {
  meta: Paginated<OverviewRow>['meta'] & {
    totalCost: string;
    totalHours: number;
    overBudget: number;
    nearBudget: number;
  };
}

export const costKeys = {
  all: ['cost'] as const,
  summary: (id: string) => ['cost', 'summary', id] as const,
  ledger: (id: string, filters: object) => ['cost', 'ledger', id, filters] as const,
  overview: (filters: object) => ['cost', 'overview', filters] as const,
};

export function useCostSummary(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: costKeys.summary(projectId ?? ''),
    queryFn: () => api.get<CostSummary>(`/cost/projects/${projectId}/summary`),
    enabled: enabled && !!projectId,
  });
}

export function useLedger(
  projectId: string,
  filters: { sourceType?: string; page?: number; pageSize?: number },
) {
  return useQuery({
    queryKey: costKeys.ledger(projectId, filters),
    queryFn: () =>
      api.get<LedgerPage>(`/cost/projects/${projectId}/ledger`, {
        sourceType: filters.sourceType,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 25,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useCostOverview(filters: {
  status?: string;
  alert?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}) {
  return useQuery({
    queryKey: costKeys.overview(filters),
    queryFn: () =>
      api.get<OverviewPage>('/cost/overview', {
        status: filters.status,
        alert: filters.alert,
        q: filters.q,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 25,
      }),
    placeholderData: keepPreviousData,
  });
}

function useInvalidateCost() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: costKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
  };
}

export function useAddAdjustment(projectId: string) {
  const invalidate = useInvalidateCost();
  return useMutation({
    mutationFn: (input: CostAdjustmentInput) =>
      api.post<{ id: string }>(`/cost/projects/${projectId}/adjustments`, input),
    onSuccess: invalidate,
  });
}

export function useReverseEntry() {
  const invalidate = useInvalidateCost();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReverseEntryInput }) =>
      api.post<{ reversed: boolean }>(`/cost/entries/${id}/reverse`, input),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** "-1250.00" -> "−₹ 1,250" with a true minus, for reversal rows. */
export function formatSigned(amount: string): string {
  const n = Number(amount);
  const abs = Math.abs(n);
  const hasPaise = Math.abs(abs * 100 - Math.round(abs) * 100) > 0.5;
  const text = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(abs);
  return `${n < 0 ? '−' : ''}₹ ${text}`;
}

export function formatHoursPlain(hours: number): string {
  return `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(hours)} h`;
}

/** The tone a burn level deserves, matching the project health colours. */
export function levelTone(level: 0 | 80 | 100): 'good' | 'warn' | 'bad' {
  return level === 100 ? 'bad' : level === 80 ? 'warn' : 'good';
}

/** One sentence explaining how a labour row was costed. */
export function describeRate(
  row: Pick<LedgerRow, 'rateBreakdown' | 'rateApplied' | 'hours'>,
): string | null {
  const segments = row.rateBreakdown;
  if (!segments || segments.length === 0) return null;
  return segments
    .map(
      (s) =>
        `${s.from === s.to ? s.from : `${s.from} to ${s.to}`}: ${Number(s.hours)} h × ₹${Number(s.rate)} = ₹${Number(s.amount).toLocaleString('en-IN')}`,
    )
    .join(' · ');
}
