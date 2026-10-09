import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { CalendarClock, Plus } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { CellStack, DataTable } from '../components/ui/DataTable';
import { EmptyState } from '../components/ui/EmptyState';
import { Panel } from '../components/ui/Panel';
import { Pill } from '../components/ui/Pill';
import { TabPanel, Tabs } from '../components/ui/Tabs';
import { useAuth } from '../providers/AuthProvider';
import { RosterTab } from '../features/shifts/RosterTab';
import { ShiftDrawer } from '../features/shifts/ShiftDrawer';
import { useShifts, type Shift } from '../features/shifts/useShifts';

const TABS = [
  { key: 'roster', label: 'Weekly roster' },
  { key: 'templates', label: 'Shift templates' },
];

export function ShiftsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'roster';
  const [open, setOpen] = useState<Shift | 'new' | null>(null);

  const { data: shifts, isLoading } = useShifts();

  const columns = useMemo<ColumnDef<Shift, unknown>[]>(
    () => [
      {
        header: 'Shift',
        id: 'name',
        enableSorting: false,
        meta: { className: 'w-[30%] max-w-0' },
        cell: ({ row }) => (
          <CellStack
            title={row.original.name}
            subtitle={row.original.crossesMidnight ? 'Runs past midnight' : undefined}
          />
        ),
      },
      {
        header: 'Hours',
        id: 'hours',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {row.original.startTime}–{row.original.endTime}
          </span>
        ),
      },
      {
        header: 'Break',
        id: 'break',
        enableSorting: false,
        cell: ({ row }) => <span className="tabular-nums">{row.original.breakMinutes} min</span>,
      },
      {
        header: 'Grace',
        id: 'grace',
        enableSorting: false,
        cell: ({ row }) => <span className="tabular-nums">{row.original.graceMinutes} min</span>,
      },
      {
        header: 'On it now',
        id: 'now',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.isDefault ? (
            <span className="text-sub text-muted">Everyone without an assignment</span>
          ) : (
            <span className="tabular-nums">{row.original.currentAssignments}</span>
          ),
      },
      {
        header: 'Status',
        id: 'status',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex gap-1.5">
            {row.original.isDefault && <Pill tone="blue">Default</Pill>}
            <Pill tone={row.original.isActive ? 'green' : 'gray'} dot>
              {row.original.isActive ? 'Active' : 'Inactive'}
            </Pill>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="People & Work"
        title="Shifts"
        subtitle="Shift templates, who works them, and the week ahead."
        actions={
          can('shift.create') && (
            <Button variant="primary" leadingIcon={<Plus />} onClick={() => setOpen('new')}>
              New shift
            </Button>
          )
        }
      />

      <Tabs
        tabs={TABS}
        value={tab}
        onChange={(key) => setParams(key === 'roster' ? {} : { tab: key }, { replace: true })}
      />

      <TabPanel>
        {tab === 'roster' && <RosterTab />}
        {tab === 'templates' && (
          <Panel flush>
            <DataTable
              data={shifts ?? []}
              columns={columns}
              loading={isLoading}
              minWidth={760}
              getRowId={(row) => row.id}
              onRowClick={setOpen}
              empty={
                <EmptyState
                  icon={<CalendarClock />}
                  title="No shifts yet"
                  description="Create the first shift — it becomes the default for everyone."
                  action={
                    can('shift.create') ? (
                      <Button
                        size="sm"
                        variant="primary"
                        leadingIcon={<Plus />}
                        onClick={() => setOpen('new')}
                      >
                        New shift
                      </Button>
                    ) : undefined
                  }
                />
              }
            />
          </Panel>
        )}
      </TabPanel>

      {open && <ShiftDrawer shift={open === 'new' ? null : open} onClose={() => setOpen(null)} />}
    </div>
  );
}
