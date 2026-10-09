import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { MapPin, Plus, Trash2, Wifi } from 'lucide-react';
import { createOfficeSchema, type CreateOfficeInput } from '@opsvera/shared';
import { Panel } from '../../components/ui/Panel';
import { Button } from '../../components/ui/Button';
import { CellStack, DataTable } from '../../components/ui/DataTable';
import { Drawer } from '../../components/ui/Drawer';
import { ConfirmDialog } from '../../components/ui/Dialog';
import { Pill } from '../../components/ui/Pill';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField, TextAreaField, TextField } from '../../components/ui/Field';
import { api } from '../../lib/api';
import { settingsKeys, useOffices, useSettingsMutation, type Office } from './useSettings';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A short, practical list; the field still accepts any valid IANA zone. */
const COMMON_ZONES = [
  'Asia/Kolkata',
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'UTC',
];

export function OfficesTab({ canEdit }: { canEdit: boolean }) {
  const { data, isLoading } = useOffices();
  const [editing, setEditing] = useState<Office | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Office | null>(null);

  const remove = useSettingsMutation({
    mutationFn: (office: Office) => api.delete(`/settings/offices/${office.id}`),
    invalidate: [settingsKeys.offices],
    successMessage: 'Office deleted',
    onSuccess: () => setDeleting(null),
  });

  const columns: ColumnDef<Office, unknown>[] = [
    {
      header: 'Office',
      accessorKey: 'name',
      meta: { className: 'w-[26%] max-w-0' },
      cell: ({ row }) => (
        <CellStack
          title={row.original.name}
          subtitle={[row.original.shortCode, row.original.city].filter(Boolean).join(' · ')}
        />
      ),
    },
    {
      header: 'Time zone',
      accessorKey: 'timezone',
      cell: ({ row }) => <span className="whitespace-nowrap">{row.original.timezone}</span>,
    },
    {
      header: 'Weekly off',
      accessorKey: 'weeklyOffDays',
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {[...row.original.weeklyOffDays].sort().map((day) => (
            <Pill key={day} tone="gray" dot={false}>
              {DAY_SHORT[day]}
            </Pill>
          ))}
        </div>
      ),
    },
    {
      header: 'Punching',
      accessorKey: 'requiresGps',
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.requiresGps ? (
            <Pill tone="violet" dot={false} icon={<MapPin />}>
              GPS required
            </Pill>
          ) : (
            <Pill tone="blue" dot={false} icon={<MapPin />}>
              {row.original.geofenceRadiusM} m
            </Pill>
          )}
          {row.original.allowedIPs.length > 0 && (
            <Pill tone="gray" dot={false} icon={<Wifi />}>
              {row.original.allowedIPs.length} IP rule
              {row.original.allowedIPs.length === 1 ? '' : 's'}
            </Pill>
          )}
        </div>
      ),
    },
    {
      header: 'In use',
      accessorKey: 'id',
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sub text-muted">
          {row.original._count.employees} people · {row.original._count.projects} projects
        </span>
      ),
    },
    {
      header: 'Status',
      accessorKey: 'isActive',
      cell: ({ row }) => (
        <Pill tone={row.original.isActive ? 'green' : 'gray'}>
          {row.original.isActive ? 'Active' : 'Inactive'}
        </Pill>
      ),
    },
  ];

  return (
    <>
      <Panel
        title="Offices & job sites"
        subtitle="Time zone and weekly offs here decide how every attendance day is judged."
        action={
          canEdit && (
            <Button
              size="sm"
              variant="primary"
              leadingIcon={<Plus />}
              onClick={() => setCreating(true)}
            >
              Add office
            </Button>
          )
        }
        flush
      >
        <DataTable
          data={data?.data ?? []}
          columns={columns}
          loading={isLoading}
          minWidth={820}
          getRowId={(row) => row.id}
          onRowClick={canEdit ? (office) => setEditing(office) : undefined}
          empty={
            <EmptyState
              icon={<MapPin />}
              title="No offices yet"
              description="Add the offices and client sites your team punches in from."
              action={
                canEdit && (
                  <Button
                    size="sm"
                    variant="primary"
                    leadingIcon={<Plus />}
                    onClick={() => setCreating(true)}
                  >
                    Add office
                  </Button>
                )
              }
            />
          }
        />
      </Panel>

      {(creating || editing) && (
        <OfficeDrawer
          office={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onRequestDelete={(office) => {
            setEditing(null);
            setDeleting(office);
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        title={`Delete ${deleting?.name}?`}
        description="Attendance already recorded against this office is kept, but it can no longer be selected."
        confirmLabel="Delete office"
        destructive
        loading={remove.isPending}
      />
    </>
  );
}

function OfficeDrawer({
  office,
  onClose,
  onRequestDelete,
}: {
  office: Office | null;
  onClose: () => void;
  onRequestDelete: (office: Office) => void;
}) {
  const isEdit = Boolean(office);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<CreateOfficeInput>({
    resolver: zodResolver(createOfficeSchema),
    defaultValues: office
      ? {
          name: office.name,
          shortCode: office.shortCode,
          timezone: office.timezone,
          addressLine1: office.addressLine1,
          city: office.city,
          state: office.state,
          country: office.country,
          latitude: office.latitude === null ? null : Number(office.latitude),
          longitude: office.longitude === null ? null : Number(office.longitude),
          geofenceRadiusM: office.geofenceRadiusM,
          weeklyOffDays: office.weeklyOffDays,
          allowedIPs: office.allowedIPs,
          requiresGps: office.requiresGps,
          isActive: office.isActive,
        }
      : {
          name: '',
          shortCode: '',
          timezone: 'Asia/Kolkata',
          geofenceRadiusM: 200,
          weeklyOffDays: [0],
          allowedIPs: [],
          requiresGps: false,
          isActive: true,
        },
  });

  const save = useSettingsMutation({
    mutationFn: (values: CreateOfficeInput) =>
      isEdit
        ? api.patch(`/settings/offices/${office!.id}`, values)
        : api.post('/settings/offices', values),
    invalidate: [settingsKeys.offices],
    successMessage: isEdit ? 'Office updated' : 'Office added',
    onSuccess: onClose,
  });

  const weeklyOffDays = watch('weeklyOffDays') ?? [];
  const allowedIPs = watch('allowedIPs') ?? [];

  return (
    <Drawer
      open
      onClose={onClose}
      title={isEdit ? office!.name : 'Add office'}
      subtitle={isEdit ? `${office!.shortCode} · ${office!.timezone}` : 'Office or client job site'}
      width="md"
      footer={
        <>
          {isEdit && (
            <Button
              variant="danger"
              leadingIcon={<Trash2 />}
              className="mr-auto"
              onClick={() => onRequestDelete(office!)}
            >
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={isEdit && !isDirty}
            onClick={handleSubmit((values) => save.mutate(values))}
          >
            {isEdit ? 'Save changes' : 'Add office'}
          </Button>
        </>
      }
    >
      <form className="space-y-5" noValidate onSubmit={handleSubmit((v) => save.mutate(v))}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Office name"
            required
            error={errors.name?.message}
            {...register('name')}
          />
          <TextField
            label="Short code"
            required
            hint="Used in lists and exports."
            error={errors.shortCode?.message}
            {...register('shortCode')}
          />
          <SelectField
            label="Time zone"
            required
            containerClassName="sm:col-span-2"
            hint="Attendance days, timesheet weeks and holidays are evaluated in this zone."
            error={errors.timezone?.message}
            options={COMMON_ZONES.map((tz) => ({ value: tz, label: tz }))}
            {...register('timezone')}
          />
          <TextAreaField
            label="Address"
            rows={2}
            containerClassName="sm:col-span-2"
            {...register('addressLine1')}
          />
          <TextField label="City" {...register('city')} />
          <TextField label="State" {...register('state')} />
          <TextField label="Country" containerClassName="sm:col-span-2" {...register('country')} />
        </div>

        <section>
          <h3 className="text-title font-heavy text-ink">Weekly offs</h3>
          <p className="mt-1 text-sub text-muted">
            Riyadh is Friday and Saturday; most Indian offices are Sunday only.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {DAY_NAMES.map((day, index) => {
              const selected = weeklyOffDays.includes(index);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    setValue(
                      'weeklyOffDays',
                      selected
                        ? weeklyOffDays.filter((d) => d !== index)
                        : [...weeklyOffDays, index].sort(),
                      { shouldDirty: true, shouldValidate: true },
                    )
                  }
                  className={`rounded-control border px-2.5 py-1.5 text-sub font-heavy transition-colors ${
                    selected
                      ? 'border-blue bg-pill-blue-bg text-pill-blue-fg'
                      : 'border-line bg-surface text-muted hover:bg-surface-2'
                  }`}
                >
                  {DAY_SHORT[index]}
                </button>
              );
            })}
          </div>
          {errors.weeklyOffDays && (
            <p role="alert" className="mt-1.5 text-micro tracking-normal text-red">
              {errors.weeklyOffDays.message}
            </p>
          )}
        </section>

        <section>
          <h3 className="text-title font-heavy text-ink">Mobile punching</h3>
          <p className="mt-1 text-sub text-muted">
            A punch outside the radius is accepted but flagged for the manager.
          </p>
          <div className="mt-2.5 grid gap-3 sm:grid-cols-3">
            <TextField
              label="Latitude"
              type="number"
              step="0.0000001"
              error={errors.latitude?.message}
              {...register('latitude')}
            />
            <TextField
              label="Longitude"
              type="number"
              step="0.0000001"
              error={errors.longitude?.message}
              {...register('longitude')}
            />
            <TextField
              label="Geofence (m)"
              type="number"
              error={errors.geofenceRadiusM?.message}
              {...register('geofenceRadiusM')}
            />
          </div>
          <label className="mt-3 flex items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-0.5 size-4 rounded border-line text-blue"
              {...register('requiresGps')}
            />
            <span className="text-sub">
              <b className="font-heavy text-ink">Client site — GPS and selfie required</b>
              <span className="mt-0.5 block text-muted">
                Office-network punching is disabled here, whatever the employee's method.
              </span>
            </span>
          </label>
        </section>

        <section>
          <h3 className="text-title font-heavy text-ink">Office network</h3>
          <p className="mt-1 text-sub text-muted">
            Punches from these addresses are accepted without GPS. One per line, IPv4 or CIDR.
          </p>
          <TextAreaField
            label="Allowed IPs"
            srOnlyLabel
            rows={3}
            className="mt-2 font-mono"
            placeholder="103.21.58.0/24"
            value={allowedIPs.join('\n')}
            onChange={(event) =>
              setValue(
                'allowedIPs',
                event.target.value
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean),
                { shouldDirty: true },
              )
            }
            error={
              Array.isArray(errors.allowedIPs)
                ? errors.allowedIPs.find(Boolean)?.message
                : errors.allowedIPs?.message
            }
          />
        </section>
      </form>
    </Drawer>
  );
}
