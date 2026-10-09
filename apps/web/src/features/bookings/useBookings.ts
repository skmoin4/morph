import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApproveBookingInput,
  AttachConfirmationEmailInput,
  CancelBookingInput,
  ConfirmBookingInput,
  CreateBookingInput,
  UpdateBookingInput,
} from '@opsvera/shared';
import { api } from '../../lib/api';
import type { Paginated } from '../settings/useSettings';

export type BookingStatus = 'DRAFT' | 'CONFIRMED' | 'PROJECT_CREATED' | 'CANCELLED';
export type ConfirmationType = 'EMAIL' | 'VERBAL';

export interface BookingConfirmation {
  id: string;
  type: ConfirmationType;
  emailDocumentId: string | null;
  emailDocument?: { id: string; fileName: string; sizeBytes: number } | null;
  poDocument?: { id: string; fileName: string; sizeBytes: number } | null;
  emailReceivedAt: string | null;
  poNumber: string | null;
  notes: string | null;
  confirmedByName: string | null;
  confirmedOn: string | null;
  verbalMode: 'CALL' | 'MEETING' | null;
  verbalSummary: string | null;
}

export interface BookingListItem {
  id: string;
  bookingNumber: string;
  projectName: string;
  status: BookingStatus;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  approvalNote: string | null;
  bookingDate: string;
  expectedStartDate: string;
  expectedEndDate: string;
  billingType: 'FIXED' | 'HOURLY' | 'MILESTONE';
  budgetHours: string;
  /** Stripped by the API unless the caller holds project.value.view. */
  projectValue?: string;
  scopeDescription: string | null;
  generatedProjectCode: string | null;
  cancelReason: string | null;
  clientId: string;
  clientContactId: string | null;
  projectTypeId: string;
  officeId: string;
  projectManagerId: string | null;
  client: { id: string; name: string };
  clientContact: { id: string; name: string; email: string | null } | null;
  projectType: { id: string; name: string; shortCode: string; colorToken: string | null };
  office: { id: string; name: string; shortCode: string };
  confirmation: BookingConfirmation | null;
  project: { id: string; projectCode: string; status: string } | null;
  emailPending: boolean;
  /** Days past the grace period, or null. A reminder — never a block. */
  emailOverdueDays: number | null;
  /** Index into the five-stage lifecycle stepper. */
  lifecycleStage: number;
  canCancel: { allowed: boolean; reason?: string };
}

export interface BookingDetail extends BookingListItem {
  policy: { requiresApproval: boolean; verbalEmailGraceDays: number };
}

export interface BookingSummary {
  draft: number;
  awaitingApproval: number;
  projectCreated: number;
  cancelled: number;
  activeProjects: number;
  emailPending: number;
  emailOverdue: number;
  bookedThisMonth: { count: number; projectValue?: string };
  requiresApproval: boolean;
}

export interface CodePreview {
  code: string;
  /** True when the code has already been issued, so it is final. */
  issued: boolean;
  requiresApproval: boolean;
}

export interface BookingFilters {
  q?: string;
  status?: string;
  clientId?: string;
  officeId?: string;
  projectTypeId?: string;
  confirmationType?: ConfirmationType;
  emailPending?: boolean;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
}

export interface UploadedFile {
  id: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
}

export const bookingKeys = {
  all: ['bookings'] as const,
  list: (filters: BookingFilters) => ['bookings', 'list', filters] as const,
  detail: (id: string) => ['bookings', 'detail', id] as const,
  summary: ['bookings', 'summary'] as const,
  preview: (id: string) => ['bookings', 'preview', id] as const,
};

export function useBookings(filters: BookingFilters) {
  return useQuery({
    queryKey: bookingKeys.list(filters),
    queryFn: () =>
      api.get<Paginated<BookingListItem>>('/bookings', {
        q: filters.q,
        status: filters.status,
        clientId: filters.clientId,
        officeId: filters.officeId,
        projectTypeId: filters.projectTypeId,
        confirmationType: filters.confirmationType,
        emailPending: filters.emailPending ? true : undefined,
        from: filters.from,
        to: filters.to,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 25,
        sort: filters.sort,
      }),
    placeholderData: (previous) => previous,
  });
}

export function useBooking(id: string | null) {
  return useQuery({
    queryKey: bookingKeys.detail(id ?? ''),
    queryFn: () => api.get<BookingDetail>(`/bookings/${id}`),
    enabled: Boolean(id),
  });
}

export interface BookingLookups {
  offices: Array<{ id: string; name: string; shortCode: string }>;
  projectTypes: Array<{ id: string; name: string; shortCode: string }>;
}

/** Narrow lookups open to anyone who can see bookings (settings.view is not needed). */
export function useBookingLookups(enabled = true) {
  return useQuery({
    queryKey: ['bookings', 'lookups'] as const,
    queryFn: () => api.get<BookingLookups>('/bookings/lookups'),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useBookingSummary(enabled = true) {
  return useQuery({
    queryKey: bookingKeys.summary,
    queryFn: () => api.get<BookingSummary>('/bookings/summary'),
    enabled,
  });
}

export function useCodePreview(id: string | null) {
  return useQuery({
    queryKey: bookingKeys.preview(id ?? ''),
    queryFn: () => api.get<CodePreview>(`/bookings/${id}/code-preview`),
    enabled: Boolean(id),
    // A forecast of a moving counter: never reuse a cached one.
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * Every mutation here changes the register, the KPI row, the Home page counts
 * and possibly the project list, so all booking queries are refreshed.
 */
function useBookingMutation<TVariables, TResult = BookingDetail>(
  run: (variables: TVariables) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bookingKeys.all }),
  });
}

export const useCreateBooking = () =>
  useBookingMutation((input: CreateBookingInput) => api.post<BookingDetail>('/bookings', input));

export const useUpdateBooking = () =>
  useBookingMutation(({ id, input }: { id: string; input: UpdateBookingInput }) =>
    api.patch<BookingDetail>(`/bookings/${id}`, input),
  );

export const useConfirmBooking = () =>
  useBookingMutation(({ id, input }: { id: string; input: ConfirmBookingInput }) =>
    api.post<BookingDetail>(`/bookings/${id}/confirm`, input),
  );

export const useDecideApproval = () =>
  useBookingMutation(({ id, input }: { id: string; input: ApproveBookingInput }) =>
    api.post<BookingDetail>(`/bookings/${id}/approval`, input),
  );

export const useAttachEmail = () =>
  useBookingMutation(({ id, input }: { id: string; input: AttachConfirmationEmailInput }) =>
    api.post<BookingDetail>(`/bookings/${id}/confirmation-email`, input),
  );

export const useCancelBooking = () =>
  useBookingMutation(({ id, input }: { id: string; input: CancelBookingInput }) =>
    api.post<BookingDetail>(`/bookings/${id}/cancel`, input),
  );

export function uploadConfirmationFile(file: File, category?: string) {
  return api.upload<UploadedFile>('/files/confirmations', file, { category });
}

/** Files are served with Content-Disposition: attachment, behind the bearer token. */
export function fileDownloadPath(id: string): string {
  return `/files/${id}`;
}
