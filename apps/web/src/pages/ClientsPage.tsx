import { useMemo, useState } from 'react';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { Briefcase, Plus, Search } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { CellStack, DataTable } from '../components/ui/DataTable';
import { Pill } from '../components/ui/Pill';
import { EmptyState } from '../components/ui/EmptyState';
import { SelectField, TextField } from '../components/ui/Field';
import { useAuth } from '../providers/AuthProvider';
import { ClientDrawer } from '../features/clients/ClientDrawer';
import { ClientFormDrawer } from '../features/clients/ClientFormDrawer';
import { useClients, type ClientListItem } from '../features/clients/useClients';

export function ClientsPage() {
  const { can } = useAuth();
  const canCreate = can('client.create');

  const [q, setQ] = useState('');
  const [active, setActive] = useState('true');
  const [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, isFetching } = useClients({
    q: q || undefined,
    isActive: active === '' ? undefined : active === 'true',
    page,
    sort: sorting[0] ? `${sorting[0].id}:${sorting[0].desc ? 'desc' : 'asc'}` : undefined,
  });
  const rows = data?.data ?? [];

  const columns = useMemo<ColumnDef<ClientListItem, unknown>[]>(
    () => [
      {
        header: 'Client',
        accessorKey: 'name',
        meta: { className: 'w-[30%] max-w-0' },
        cell: ({ row }) => (
          <CellStack
            title={row.original.name}
            subtitle={
              [row.original.clientCode, row.original.industry].filter(Boolean).join(' · ') ||
              undefined
            }
          />
        ),
      },
      {
        header: 'Location',
        accessorKey: 'city',
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {[row.original.city, row.original.state].filter(Boolean).join(', ') || '—'}
          </span>
        ),
      },
      {
        header: 'Primary contact',
        accessorKey: 'contacts',
        enableSorting: false,
        cell: ({ row }) => {
          const contact = row.original.contacts[0];
          return contact ? (
            <CellStack
              title={contact.name}
              subtitle={contact.email ?? contact.phone ?? undefined}
            />
          ) : (
            <span className="text-muted">—</span>
          );
        },
      },
      {
        header: 'Bookings',
        accessorKey: '_count',
        enableSorting: false,
        cell: ({ row }) => <span className="tabular-nums">{row.original._count.bookings}</span>,
      },
      {
        header: 'Projects',
        id: 'projects',
        enableSorting: false,
        cell: ({ row }) => <span className="tabular-nums">{row.original._count.projects}</span>,
      },
      {
        header: 'Status',
        accessorKey: 'isActive',
        enableSorting: false,
        cell: ({ row }) => (
          <Pill tone={row.original.isActive ? 'green' : 'gray'} dot>
            {row.original.isActive ? 'Active' : 'Inactive'}
          </Pill>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Commercial"
        title="Clients"
        subtitle="The companies you book projects for, and who to contact."
        actions={
          canCreate && (
            <Button variant="primary" leadingIcon={<Plus />} onClick={() => setCreating(true)}>
              Add client
            </Button>
          )
        }
      />

      <Panel flush>
        <div className="flex flex-wrap items-end gap-2.5 border-b border-line px-4 py-3">
          <TextField
            label="Search"
            srOnlyLabel
            containerClassName="min-w-[200px] flex-1"
            placeholder="Name, code or city…"
            leadingIcon={<Search />}
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
          <SelectField
            label="Status"
            srOnlyLabel
            containerClassName="w-40"
            value={active}
            onChange={(event) => {
              setActive(event.target.value);
              setPage(1);
            }}
            options={[
              { value: 'true', label: 'Active' },
              { value: 'false', label: 'Inactive' },
              { value: '', label: 'All clients' },
            ]}
          />
        </div>

        <DataTable
          data={rows}
          columns={columns}
          loading={isLoading}
          minWidth={820}
          sorting={sorting}
          onSortingChange={(updater) => {
            setSorting(updater);
            setPage(1);
          }}
          getRowId={(row) => row.id}
          onRowClick={(row) => setOpenId(row.id)}
          empty={
            <EmptyState
              icon={<Briefcase />}
              title={q ? 'No clients match that search' : 'No clients yet'}
              description={
                q
                  ? 'Try a different name, or clear the search.'
                  : 'Add a client before you book a project for them.'
              }
              action={
                canCreate && !q ? (
                  <Button
                    size="sm"
                    variant="primary"
                    leadingIcon={<Plus />}
                    onClick={() => setCreating(true)}
                  >
                    Add client
                  </Button>
                ) : undefined
              }
            />
          }
        />

        {data && data.meta.totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
            <p className="text-sub text-muted">
              Page {data.meta.page} of {data.meta.totalPages} · {data.meta.total} clients
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
        <ClientFormDrawer
          client={null}
          onClose={() => setCreating(false)}
          onSaved={(c) => setOpenId(c.id)}
        />
      )}
      {openId && <ClientDrawer clientId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
