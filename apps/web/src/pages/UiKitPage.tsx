import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { CalendarPlus, Download, FileText, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button, IconButton } from '../components/ui/Button';
import { Panel, PanelLink, Card, ListItem } from '../components/ui/Panel';
import { MetricCard, MetricRow } from '../components/ui/MetricCard';
import { Pill, StatusPill } from '../components/ui/Pill';
import { Progress, ProgressWithLabel } from '../components/ui/Progress';
import { CellNumber, CellStack, DataTable } from '../components/ui/DataTable';
import { Drawer } from '../components/ui/Drawer';
import { ConfirmDialog, Dialog } from '../components/ui/Dialog';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton, SkeletonText } from '../components/ui/Skeleton';
import { Tabs, TabPanel } from '../components/ui/Tabs';
import { Avatar } from '../components/ui/Avatar';
import { BOOKING_LIFECYCLE, Stepper } from '../components/ui/Stepper';
import { SelectField, TextAreaField, TextField } from '../components/ui/Field';
import { formatCurrencyShort, formatDisplayDate, formatHours } from '../lib/format';

interface DemoProject {
  code: string;
  name: string;
  client: string;
  progress: number;
  burn: number;
  cost: string;
  margin: string;
  health: string;
}

const DEMO_ROWS: DemoProject[] = [
  {
    code: 'MOR-26-27-HOS-0001',
    name: 'Aarogya Super Speciality Hospital',
    client: 'Aarogya Hospitals Pvt Ltd',
    progress: 47,
    burn: 65,
    cost: '5922800',
    margin: '3577200',
    health: 'HEALTHY',
  },
  {
    code: 'MOR-26-27-DC-0002',
    name: 'Northbridge Mumbai DC — Phase 2',
    client: 'Northbridge Data Centres',
    progress: 61,
    burn: 29,
    cost: '9503530',
    margin: '9246470',
    health: 'HEALTHY',
  },
  {
    code: 'MOR-26-27-PHA-0003',
    name: 'Veridia Nashik Formulation Block',
    client: 'Veridia Pharma Ltd',
    progress: 73,
    burn: 87,
    cost: '4688720',
    margin: '1511280',
    health: 'AT_RISK',
  },
];

const COLUMNS: ColumnDef<DemoProject, unknown>[] = [
  {
    header: 'Project',
    accessorKey: 'name',
    // The widest column, so it is the one that truncates when space is tight.
    meta: { className: 'w-[38%] max-w-0' },
    cell: ({ row }) => (
      <CellStack
        title={row.original.name}
        subtitle={`${row.original.code} · ${row.original.client}`}
      />
    ),
  },
  {
    header: 'Progress',
    accessorKey: 'progress',
    cell: ({ row }) => (
      <ProgressWithLabel value={row.original.progress} caption={`${row.original.progress}%`} />
    ),
  },
  {
    header: 'Hours burn',
    accessorKey: 'burn',
    cell: ({ row }) => (
      <ProgressWithLabel
        value={row.original.burn}
        risk={row.original.burn >= 80}
        caption={`${row.original.burn}% consumed`}
      />
    ),
  },
  {
    header: 'Actual cost',
    accessorKey: 'cost',
    cell: ({ row }) => <CellNumber>{formatCurrencyShort(row.original.cost)}</CellNumber>,
  },
  {
    header: 'Margin',
    accessorKey: 'margin',
    cell: ({ row }) => (
      <CellNumber className="text-green">{formatCurrencyShort(row.original.margin)}</CellNumber>
    ),
  },
  {
    header: 'Health',
    accessorKey: 'health',
    cell: ({ row }) => <StatusPill status={row.original.health} />,
  },
];

/**
 * Every shell component on one page, for side-by-side comparison with the
 * prototype before any module is built. Not part of the product: it is routed
 * only in development.
 */
export function UiKitPage() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tab, setTab] = useState('overview');
  const [loadingTable, setLoadingTable] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>();

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Design System"
        title="UI Kit"
        subtitle="Every shell component, built from the prototype's tokens. Step 3 review gate."
        actions={
          <>
            <Button variant="ghost" leadingIcon={<Download />}>
              Export
            </Button>
            <Button variant="primary" leadingIcon={<Plus />}>
              Quick Action
            </Button>
          </>
        }
      />

      <Section
        title="Metric cards"
        note="Six-across KPI row; wraps to 3 then 2 on smaller screens."
      >
        <MetricRow>
          <MetricCard
            label="Booked MTD"
            value="₹ 21.0 L"
            foot="4 confirmed bookings"
            state="good"
          />
          <MetricCard label="Active Projects" value="3" foot="1 requires attention" />
          <MetricCard
            label="Budget Burn"
            value="87%"
            foot="Veridia over 80%"
            state="warn"
            delta={{ value: '12 pts', direction: 'up', isGood: false }}
          />
          <MetricCard
            label="Today's Attendance"
            value="42 / 45"
            foot="93.3% present"
            state="good"
          />
          <MetricCard
            label="Pending Approvals"
            value="4"
            foot="2 timesheets, 2 expenses"
            state="warn"
          />
          <MetricCard
            label="Projected Margin"
            value="₹ 9.60 L"
            foot="Across active portfolio"
            state="good"
          />
        </MetricRow>
        <div className="mt-3">
          <MetricRow>
            <MetricCard loading label="" value="" />
            <MetricCard loading label="" value="" />
            <MetricCard loading label="" value="" />
          </MetricRow>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" leadingIcon={<Plus />}>
            Primary
          </Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="subtle">Subtle</Button>
          <Button variant="danger" leadingIcon={<Trash2 />}>
            Danger
          </Button>
          <Button variant="primary" loading>
            Saving
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
          <IconButton label="Add" variant="secondary">
            <Plus />
          </IconButton>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
      </Section>

      <Section
        title="Status pills"
        note="One colour vocabulary: green healthy/approved, blue info/sent, amber pending/review, red risk/overdue, gray draft."
      >
        <div className="flex flex-wrap gap-2">
          {['DRAFT', 'CONFIRMED', 'PROJECT_CREATED', 'ACTIVE', 'AT_RISK', 'CRITICAL'].map((s) => (
            <StatusPill key={s} status={s} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {['PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'REIMBURSED'].map((s) => (
            <StatusPill key={s} status={s} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'HOLIDAY', 'WEEKLY_OFF'].map(
            (s) => (
              <StatusPill key={s} status={s} />
            ),
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Pill tone="amber" icon={<FileText />}>
            Email pending
          </Pill>
          <Pill tone="blue" dot={false}>
            HOS
          </Pill>
          <Pill tone="violet" dot={false}>
            Hourly
          </Pill>
        </div>
      </Section>

      <Section
        title="Booking lifecycle stepper"
        note="Shown on both the booking and the project page."
      >
        <Stepper steps={BOOKING_LIFECYCLE} currentIndex={3} />
        <p className="mt-3 text-sub text-muted">Cancelled booking:</p>
        <Stepper steps={BOOKING_LIFECYCLE} currentIndex={1} cancelled className="mt-2" />
      </Section>

      <Section title="Panels and cards">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(330px,0.75fr)]">
          <Panel
            title="Project portfolio health"
            subtitle="Progress, effort burn, cost and expected margin in a single row."
            action={
              <PanelLink onClick={() => toast('Opens the portfolio')}>Open Portfolio →</PanelLink>
            }
            flush
          >
            <DataTable
              data={DEMO_ROWS}
              columns={COLUMNS}
              loading={loadingTable}
              onRowClick={() => setDrawerOpen(true)}
              getRowId={(row) => row.code}
              minWidth={700}
            />
            <div className="border-t border-line px-4 py-2.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setLoadingTable(true);
                  window.setTimeout(() => setLoadingTable(false), 1200);
                }}
              >
                Show loading state
              </Button>
            </div>
          </Panel>

          <div className="space-y-3">
            <Panel title="Action Center" subtitle="Only items that need a decision.">
              <div className="grid gap-2">
                <ListItem>
                  <div className="min-w-0">
                    <b className="text-body font-heavy">Veridia scope-creep risk</b>
                    <small className="mt-0.5 block text-sub text-muted">
                      87% of budget hours consumed at 73% progress.
                    </small>
                  </div>
                  <StatusPill status="AT_RISK" />
                </ListItem>
                <ListItem>
                  <div className="min-w-0">
                    <b className="text-body font-heavy">2 timesheets awaiting approval</b>
                    <small className="mt-0.5 block text-sub text-muted">Week of 05 Oct 2026</small>
                  </div>
                  <StatusPill status="PENDING" />
                </ListItem>
              </div>
            </Panel>

            <Card>
              <h3 className="text-title font-heavy">Plain card</h3>
              <p className="mt-1 text-sub text-muted">
                Lighter than a panel. Used inside panel bodies for sub-sections.
              </p>
              <p className="mt-2.5 text-metric font-black">{formatHours('286.5')}</p>
            </Card>
          </div>
        </div>
      </Section>

      <Section title="Progress bars">
        <div className="max-w-sm space-y-3">
          <ProgressWithLabel value={47} caption="47% complete" />
          <ProgressWithLabel value={87} risk caption="87% consumed — over the 80% alert" />
          <Progress value={100} />
        </div>
      </Section>

      <Section title="Tabs" note="Used by the Project 360 and Employee 360 pages.">
        <Tabs
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'booking', label: 'Booking & confirmation' },
            { key: 'schedule', label: 'Schedule' },
            { key: 'team', label: 'Team', count: 4 },
            { key: 'tasks', label: 'Tasks', count: 14 },
            { key: 'cost', label: 'Cost ledger' },
          ]}
          value={tab}
          onChange={setTab}
        />
        <TabPanel>
          <p className="text-body text-muted">
            Panel for <b className="font-heavy text-ink">{tab}</b>.
          </p>
        </TabPanel>
      </Section>

      <Section
        title="Form controls"
        note="Inline validation, described-by hints, visible focus rings."
      >
        <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
          <TextField
            label="Project name"
            placeholder="Aarogya Super Speciality Hospital"
            required
          />
          <SelectField
            label="Project type"
            placeholder="Choose a type"
            options={[
              { value: 'HOS', label: 'Hospital (HOS)' },
              { value: 'DC', label: 'Data Centre (DC)' },
              { value: 'PHA', label: 'Pharma (PHA)' },
              { value: 'SOL', label: 'Solar (SOL)' },
            ]}
          />
          <TextField
            label="Project value"
            placeholder="9500000"
            hint="Indian format, two decimal places."
            leadingIcon={<span className="text-body">₹</span>}
          />
          <TextField
            label="Budget hours"
            defaultValue="-40"
            error={fieldError}
            onBlur={(e) =>
              setFieldError(
                Number(e.target.value) < 0 ? 'Budget hours cannot be negative' : undefined,
              )
            }
            hint="Blur the field to see the error state."
          />
          <TextAreaField
            label="Scope description"
            containerClassName="sm:col-span-2"
            placeholder="Full BIM coordination (LOD 400) and MEP detailed design…"
          />
        </div>
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
            Open detail drawer
          </Button>
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            Open dialog
          </Button>
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>
            Destructive confirm
          </Button>
          <Button variant="ghost" onClick={() => toast.success('Timesheet approved')}>
            Success toast
          </Button>
          <Button variant="ghost" onClick={() => toast.error('Booking needs a confirmation first')}>
            Error toast
          </Button>
        </div>
        <p className="mt-2 text-sub text-muted">
          Press <kbd className="rounded border border-line bg-surface-2 px-1">⌘K</kbd> for the
          command palette.
        </p>
      </Section>

      <Section title="Loading and empty states">
        <div className="grid gap-3 md:grid-cols-2">
          <Panel title="Skeletons">
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1">
                <SkeletonText lines={2} />
              </div>
            </div>
          </Panel>
          <Panel title="Empty state">
            <EmptyState
              icon={<CalendarPlus />}
              title="No bookings yet"
              description="Book a project for a client and attach their confirmation to get started."
              action={
                <Button variant="primary" size="sm" leadingIcon={<Plus />}>
                  New booking
                </Button>
              }
            />
          </Panel>
        </div>
      </Section>

      <Section title="Avatars and typography">
        <div className="flex items-center gap-3">
          <Avatar name="Rajesh Deshmukh" size="sm" />
          <Avatar name="Priya Kulkarni" />
          <Avatar name="Faisal Al-Harbi" size="lg" />
        </div>
        <dl className="mt-4 grid max-w-xl gap-2">
          {[
            ['display · 34px', 'text-display font-black'],
            ['metric · 28px', 'text-metric font-black'],
            ['title · 14px', 'text-title font-heavy'],
            ['body · 13px', 'text-body'],
            ['sub · 12px', 'text-sub text-muted'],
            ['micro · 11px', 'text-micro uppercase text-muted'],
          ].map(([label, className]) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-4 border-b border-line-soft pb-1.5"
            >
              <dt className="text-micro tracking-normal text-muted-2">{label}</dt>
              <dd className={className}>The quick brown fox · ₹ 10,50,000</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sub text-muted">
          Dates render as {formatDisplayDate('2026-10-04')}; money uses Indian grouping with L / Cr
          short forms on dashboards.
        </p>
      </Section>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Aarogya Super Speciality Hospital"
        subtitle="MOR-26-27-HOS-0001 · Aarogya Hospitals Pvt Ltd"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDrawerOpen(false)}>
              Close
            </Button>
            <Button variant="primary">Open Project 360</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Stepper steps={BOOKING_LIFECYCLE} currentIndex={4} />
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <p className="text-micro font-heavy uppercase text-muted">Budget hours</p>
              <p className="mt-1.5 text-metric font-black">4,200</p>
            </Card>
            <Card>
              <p className="text-micro font-heavy uppercase text-muted">Actual hours</p>
              <p className="mt-1.5 text-metric font-black">2,734</p>
            </Card>
          </div>
          <p className="text-body leading-relaxed text-muted">
            A row click opens this drawer. Focus is trapped inside it, Escape closes it, and focus
            returns to the row you came from.
          </p>
        </div>
      </Drawer>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Attach confirmation email"
        description="A verbal booking keeps its “Email pending” badge until the client's email is attached."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setDialogOpen(false)}>
              Attach
            </Button>
          </>
        }
      />

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          toast.success('Booking cancelled');
        }}
        title="Cancel this booking?"
        description="The booking will be marked cancelled. Its number is never reused."
        confirmLabel="Cancel booking"
        cancelLabel="Keep it"
        destructive
      />
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <Panel title={title} subtitle={note}>
      {children}
    </Panel>
  );
}
