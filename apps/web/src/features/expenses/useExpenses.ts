import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BulkExpenseDecisionInput,
  ExpenseDecisionInput,
  ExpenseInput,
  ReverseExpenseInput,
  UpdateExpenseInput,
} from '@opsvera/shared';
import { api } from '../../lib/api';
import type { Paginated } from '../settings/useSettings';

export type ExpenseStatus =
  'DRAFT' | 'PENDING_MANAGER' | 'PENDING_FINANCE' | 'APPROVED' | 'REJECTED';

export interface ExpenseCategory {
  id: string;
  name: string;
  shortCode: string | null;
  perClaimLimit: string | null;
  perMonthLimit: string | null;
  requiresReceipt: boolean;
}

export interface ExpenseApprovalRow {
  stage: 'MANAGER' | 'FINANCE';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  comment: string | null;
  decidedAt: string | null;
  approver: string | null;
}

export interface ExpenseRow {
  id: string;
  status: ExpenseStatus;
  expenseDate: string;
  amount: string;
  currency: string;
  isBillable: boolean;
  description: string | null;
  exceededLimit: boolean;
  reimbursementStatus: 'PENDING' | 'REIMBURSED';
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  reimbursedAt: string | null;
  costPosted: boolean;
  employee: { id: string; employeeCode: string; fullName: string; office: string };
  project: { id: string; projectCode: string; name: string } | null;
  category: ExpenseCategory;
  receipt: { id: string; fileName: string; mimeType: string; sizeBytes: number } | null;
  awaiting: 'MANAGER' | 'FINANCE' | null;
  approvals: ExpenseApprovalRow[];
  isMine: boolean;
  canEdit: boolean;
  canSubmit: boolean;
  canWithdraw: boolean;
  canDecide: boolean;
  canReimburse: boolean;
  canReverse: boolean;
  limitMessages?: string[];
  warnings?: string[];
}

export interface ExpensePage extends Paginated<ExpenseRow> {
  meta: Paginated<ExpenseRow>['meta'] & { totalAmount: string };
}

export interface ExpenseSummary {
  mine: Record<
    'waiting' | 'approvedUnpaid' | 'reimbursed' | 'rejected' | 'drafts',
    { count: number; amount: string }
  >;
  toDecide: { count: number; amount: string };
  toReimburse: { count: number; amount: string };
}

export interface ExpenseLookups {
  categories: ExpenseCategory[];
  projects: Array<{ id: string; projectCode: string; name: string; status: string }>;
}

export interface BatchResult {
  done: number;
  failed: number;
  results: Array<{ id: string; ok: boolean; code?: string; message?: string }>;
}

export interface ExpenseFilters {
  status?: string;
  mine?: boolean;
  toDecide?: boolean;
  toReimburse?: boolean;
  reimbursement?: string;
  projectId?: string;
  categoryId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export const expenseKeys = {
  all: ['expenses'] as const,
  list: (filters: object) => ['expenses', 'list', filters] as const,
  summary: ['expenses', 'summary'] as const,
  lookups: ['expenses', 'lookups'] as const,
};

export function useExpenses(filters: ExpenseFilters, enabled = true) {
  return useQuery({
    queryKey: expenseKeys.list(filters),
    queryFn: () =>
      api.get<ExpensePage>('/expenses', {
        status: filters.status,
        mine: filters.mine ? true : undefined,
        toDecide: filters.toDecide ? true : undefined,
        toReimburse: filters.toReimburse ? true : undefined,
        reimbursement: filters.reimbursement,
        projectId: filters.projectId,
        categoryId: filters.categoryId,
        q: filters.q,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 25,
      }),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useExpenseSummary(enabled = true) {
  return useQuery({
    queryKey: expenseKeys.summary,
    queryFn: () => api.get<ExpenseSummary>('/expenses/summary'),
    enabled,
  });
}

export function useExpenseLookups(enabled = true) {
  return useQuery({
    queryKey: expenseKeys.lookups,
    queryFn: () => api.get<ExpenseLookups>('/expenses/lookups'),
    enabled,
    staleTime: 60_000,
  });
}

/** A claim moves lists, totals, and — on approval — project cost. */
function useInvalidateExpenses() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: expenseKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
  };
}

export function useUploadReceipt() {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('receipt', file, file.name);
      return api.post<{ id: string; fileName: string; mimeType: string; sizeBytes: number }>(
        '/expenses/receipts',
        form,
      );
    },
  });
}

export function useCreateExpense() {
  const invalidate = useInvalidateExpenses();
  return useMutation({
    mutationFn: (input: ExpenseInput) => api.post<ExpenseRow>('/expenses', input),
    onSuccess: invalidate,
  });
}

export function useUpdateExpense() {
  const invalidate = useInvalidateExpenses();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateExpenseInput }) =>
      api.patch<ExpenseRow>(`/expenses/${id}`, input),
    onSuccess: invalidate,
  });
}

export function useDeleteExpense() {
  const invalidate = useInvalidateExpenses();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: boolean }>(`/expenses/${id}`),
    onSuccess: invalidate,
  });
}

export function useSubmitExpense() {
  const invalidate = useInvalidateExpenses();
  return useMutation({
    mutationFn: (id: string) => api.post<ExpenseRow>(`/expenses/${id}/submit`),
    onSuccess: invalidate,
  });
}

export function useWithdrawExpense() {
  const invalidate = useInvalidateExpenses();
  return useMutation({
    mutationFn: (id: string) => api.post<ExpenseRow>(`/expenses/${id}/withdraw`),
    onSuccess: invalidate,
  });
}

export function useDecideExpense() {
  const invalidate = useInvalidateExpenses();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ExpenseDecisionInput }) =>
      api.post<ExpenseRow>(`/expenses/${id}/decision`, input),
    onSuccess: invalidate,
  });
}

export function useBulkDecideExpenses() {
  const invalidate = useInvalidateExpenses();
  return useMutation({
    mutationFn: (input: BulkExpenseDecisionInput) =>
      api.post<BatchResult>('/expenses/bulk-decision', input),
    onSuccess: invalidate,
  });
}

export function useReimburse() {
  const invalidate = useInvalidateExpenses();
  return useMutation({
    mutationFn: (ids: string[]) => api.post<BatchResult>('/expenses/reimburse', { ids }),
    onSuccess: invalidate,
  });
}

export function useReverseExpense() {
  const invalidate = useInvalidateExpenses();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReverseExpenseInput }) =>
      api.post<ExpenseRow>(`/expenses/${id}/reverse`, input),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export const EXPENSE_STATUS_LABEL: Record<ExpenseStatus, string> = {
  DRAFT: 'Draft',
  PENDING_MANAGER: 'With manager',
  PENDING_FINANCE: 'With Finance',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

/** "27500.00" -> "₹ 27,500"; keeps paise only when there are some. */
export function formatRupees(amount: string | number): string {
  const n = Number(amount);
  const hasPaise = Math.abs(n * 100 - Math.round(n) * 100) > 0.5;
  return `₹ ${new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(n)}`;
}

/** Amounts as typed: "1,250", "₹1250.5" — returns a 2-decimal string, or null. */
export function parseAmountInput(raw: string): string | null {
  const text = raw.replace(/[₹,\s]/g, '');
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(text)) return null;
  const n = Number(text);
  return n > 0 ? n.toFixed(2) : null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
