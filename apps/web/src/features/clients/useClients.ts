import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientContactInput, CreateClientInput, UpdateClientInput } from '@opsvera/shared';
import { api } from '../../lib/api';
import type { Paginated } from '../settings/useSettings';

export interface ClientContact {
  id: string;
  name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface ClientListItem {
  id: string;
  name: string;
  clientCode: string | null;
  industry: string | null;
  gstin: string | null;
  website: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  notes: string | null;
  isActive: boolean;
  contacts: ClientContact[];
  _count: { bookings: number; projects: number };
}

export interface ClientDetail extends ClientListItem {
  bookings: Array<{
    id: string;
    bookingNumber: string;
    projectName: string;
    status: 'DRAFT' | 'CONFIRMED' | 'PROJECT_CREATED' | 'CANCELLED';
    bookingDate: string;
    projectValue?: string;
    projectType: { shortCode: string };
    project: { id: string; projectCode: string; status: string } | null;
  }>;
}

export interface ClientFilters {
  q?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
  sort?: string;
}

export const clientKeys = {
  all: ['clients'] as const,
  list: (filters: ClientFilters) => ['clients', 'list', filters] as const,
  detail: (id: string) => ['clients', 'detail', id] as const,
};

export function useClients(filters: ClientFilters) {
  return useQuery({
    queryKey: clientKeys.list(filters),
    queryFn: () =>
      api.get<Paginated<ClientListItem>>('/clients', {
        q: filters.q,
        isActive: filters.isActive,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 25,
        sort: filters.sort,
      }),
    placeholderData: (previous) => previous,
  });
}

export function useClient(id: string | null) {
  return useQuery({
    queryKey: clientKeys.detail(id ?? ''),
    queryFn: () => api.get<ClientDetail>(`/clients/${id}`),
    enabled: Boolean(id),
  });
}

function useClientMutation<TVariables, TResult>(run: (variables: TVariables) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    // A client change shows up in the register's client column and filter too.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: clientKeys.all }),
  });
}

export const useCreateClient = () =>
  useClientMutation((input: CreateClientInput) => api.post<ClientDetail>('/clients', input));

export const useUpdateClient = () =>
  useClientMutation(({ id, input }: { id: string; input: UpdateClientInput }) =>
    api.patch<ClientDetail>(`/clients/${id}`, input),
  );

export const useAddContact = () =>
  useClientMutation(({ id, input }: { id: string; input: ClientContactInput }) =>
    api.post<ClientContact>(`/clients/${id}/contacts`, input),
  );

export const useRemoveContact = () =>
  useClientMutation((contactId: string) => api.delete<void>(`/clients/contacts/${contactId}`));
