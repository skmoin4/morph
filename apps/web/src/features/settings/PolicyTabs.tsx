import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { CalendarDays, Clock, Plus, Trash2 } from 'lucide-react';
import {
  attendancePolicySchema,
  holidaySchema,
  leaveTypeSchema,
  type AttendancePolicyInput,
  type HolidayInput,
  type LeaveTypeInput,
} from '@opsvera/shared';
import { Panel } from '../../components/ui/Panel';
import { Button, IconButton } from '../../components/ui/Button';
import { CellStack, DataTable } from '../../components/ui/DataTable';
import { Dialog, ConfirmDialog } from '../../components/ui/Dialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pill } from '../../components/ui/Pill';
import { SelectField, TextField } from '../../components/ui/Field';
import { formatDisplayDate } from '../../lib/format';
import { api } from '../../lib/api';
import { ReferenceTable, activeColumn } from './ReferenceTable';
import {
  settingsKeys,
  useAttendancePolicies,
  useHolidays,
  useLeaveTypes,
  useOffices,
  useSettingsMutation,
  type AttendancePolicy,
  type Holiday,
  type LeaveType,
} from './useSettings';

// ---------------------------------------------------------------------------
// Attendance policies
// ---------------------------------------------------------------------------

export function AttendancePoliciesTab({ canEdit }: { canEdit: boolean }) {
  const { data: policies, isLoading } = useAttendancePolicies();
  const { data: offices } = useOffices();
  const [editing, setEditing] = useState<AttendancePolicy | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AttendancePolicy | null>(null);

  const remove = useSettingsMutation({
    mutationFn: (policy: AttendancePolicy) =>
      api.delete(`/settings/attendance-policies/${policy.id}`),
    invalidate: [settingsKeys.attendancePolicies],
    successMessage: 'Policy deleted',
    onSuccess: () => setDeleting(null),
  });

  const columns: ColumnDef<AttendancePolicy, unknown>[] = [
    {
      header: 'Policy',
      accessorKey: 'name',
      meta: { className: 'w-[28%] max-w-0' },
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <CellStack
            title={row.original.name}
            subtitle={row.original.office?.name ?? 'All offices'}
          />
          {row.original.isDefault && (
            <Pill tone="blue" dot={false}>
              Default
            </Pill>
          )}
        </div>
      ),
    },
    {
      header: 'Grace',
      accessorKey: 'graceMinutes',
      cell: ({ row }) => <span className="tabular-nums">{row.original.graceMinutes} min</span>,
    },
    {
      header: 'Half day from',
      accessorKey: 'halfDayBelowHours',
      cell: ({ row }) => (
        <span className="tabular-nums">{Number(row.original.halfDayBelowHours)} h</span>
      ),
    },
    {
      header: 'Full day from',
      accessorKey: 'fullDayMinimumHours',
      cell: ({ row }) => (
        <span className="tabular-nums">{Number(row.original.fullDayMinimumHours)} h</span>
      ),
    },
    {
      header: 'Overtime after',
      accessorKey: 'overtimeAfterHours',
      cell: ({ row }) => (
        <span className="tabular-nums">{Number(row.original.overtimeAfterHours)} h</span>
      ),
    },
    {
      header: 'Late marks',
      accessorKey: 'lateMarksPerHalfDay',
      cell: ({ row }) =>
        row.original.lateMarksPerHalfDay > 0 ? (
          <span className="whitespace-nowrap text-sub text-muted">
            {row.original.lateMarksPerHalfDay} = ½ day
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    ...(canEdit
      ? [
          {
            id: 'actions',
            header: '',
            meta: { className: 'w-0' },
            cell: ({ row }) => (
              <div className="flex justify-end gap-1">
                <IconButton
                  label={`Delete ${row.original.name}`}
                  size="sm"
                  onClick={(event) => {
                    event.stopPropagation();
                    setDeleting(row.original);
                  }}
                >
                  <Trash2 />
                </IconButton>
              </div>
            ),
          } as ColumnDef<AttendancePolicy, unknown>,
        ]
      : []),
  ];

  return (
    <>
      <Panel
        title="Attendance policies"
        subtitle="These thresholds decide whether a day is present, late, half day or overtime. The office policy wins over the company default."
        action={
          canEdit && (
            <Button
              size="sm"
              variant="primary"
              leadingIcon={<Plus />}
              onClick={() => setCreating(true)}
            >
              Add policy
            </Button>
          )
        }
        flush
      >
        <DataTable
          data={policies ?? []}
          columns={columns}
          loading={isLoading}
          minWidth={860}
          getRowId={(row) => row.id}
          onRowClick={canEdit ? (policy) => setEditing(policy) : undefined}
          empty={
            <EmptyState
              icon={<Clock />}
              title="No attendance policies"
              description="Add at least a company default so the rule engine knows what a full day is."
            />
          }
        />
      </Panel>

      {(creating || editing) && (
        <PolicyDialog
          policy={editing}
          offices={(offices?.data ?? []).map((o) => ({ value: o.id, label: o.name }))}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        title={`Delete ${deleting?.name}?`}
        description="Days already computed keep their result; future days fall back to the next matching policy."
        confirmLabel="Delete policy"
        destructive
        loading={remove.isPending}
      />
    </>
  );
}

function PolicyDialog({
  policy,
  offices,
  onClose,
}: {
  policy: AttendancePolicy | null;
  offices: Array<{ value: string; label: string }>;
  onClose: () => void;
}) {
  const isEdit = Boolean(policy);

  const { register, handleSubmit, formState } = useForm<AttendancePolicyInput>({
    resolver: zodResolver(attendancePolicySchema),
    defaultValues: policy
      ? {
          name: policy.name,
          officeId: policy.officeId,
          shiftId: policy.shiftId,
          graceMinutes: policy.graceMinutes,
          lateMarkAfterMinutes: policy.lateMarkAfterMinutes,
          halfDayBelowHours: Number(policy.halfDayBelowHours),
          fullDayMinimumHours: Number(policy.fullDayMinimumHours),
          overtimeAfterHours: Number(policy.overtimeAfterHours),
          earlyExitBeforeMinutes: policy.earlyExitBeforeMinutes,
          lateMarksPerHalfDay: policy.lateMarksPerHalfDay,
          isDefault: policy.isDefault,
          isActive: policy.isActive,
        }
      : {
          name: '',
          officeId: null,
          shiftId: null,
          graceMinutes: 10,
          lateMarkAfterMinutes: 0,
          halfDayBelowHours: 4,
          fullDayMinimumHours: 8,
          overtimeAfterHours: 9,
          earlyExitBeforeMinutes: 15,
          lateMarksPerHalfDay: 3,
          isDefault: false,
          isActive: true,
        },
  });

  const save = useSettingsMutation({
    mutationFn: (values: AttendancePolicyInput) =>
      isEdit
        ? api.put(`/settings/attendance-policies/${policy!.id}`, values)
        : api.post('/settings/attendance-policies', values),
    invalidate: [settingsKeys.attendancePolicies],
    successMessage: isEdit ? 'Policy updated' : 'Policy added',
    onSuccess: onClose,
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEdit ? `Edit ${policy!.name}` : 'Add attendance policy'}
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={handleSubmit((values) => save.mutate(values))}
          >
            {isEdit ? 'Save changes' : 'Add policy'}
          </Button>
        </>
      }
    >
      <form className="space-y-3" noValidate onSubmit={handleSubmit((v) => save.mutate(v))}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Name"
            required
            error={formState.errors.name?.message}
            {...register('name')}
          />
          <SelectField
            label="Applies to"
            placeholder="All offices"
            options={offices}
            error={formState.errors.officeId?.message}
            {...register('officeId')}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Grace period (min)"
            type="number"
            hint="Arriving within this of the shift start is on time."
            error={formState.errors.graceMinutes?.message}
            {...register('graceMinutes')}
          />
          <TextField
            label="Early exit before (min)"
            type="number"
            error={formState.errors.earlyExitBeforeMinutes?.message}
            {...register('earlyExitBeforeMinutes')}
          />
          <TextField
            label="Half day from (hours)"
            type="number"
            step="0.25"
            hint="Time at work from here up to the full-day minimum is a half day; less is absent."
            error={formState.errors.halfDayBelowHours?.message}
            {...register('halfDayBelowHours')}
          />
          <TextField
            label="Full day from (hours)"
            type="number"
            step="0.25"
            hint="Measured as time clocked in, break included."
            error={formState.errors.fullDayMinimumHours?.message}
            {...register('fullDayMinimumHours')}
          />
          <TextField
            label="Overtime after (hours)"
            type="number"
            step="0.25"
            error={formState.errors.overtimeAfterHours?.message}
            {...register('overtimeAfterHours')}
          />
          <TextField
            label="Late marks per half day"
            type="number"
            hint="0 turns the rule off."
            error={formState.errors.lateMarksPerHalfDay?.message}
            {...register('lateMarksPerHalfDay')}
          />
        </div>

        <label className="flex items-start gap-2.5 pt-1 text-sub">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-line text-blue"
            {...register('isDefault')}
          />
          <span>
            <b className="font-heavy text-ink">Company default</b>
            <span className="mt-0.5 block text-muted">
              Used by any office without a policy of its own. Only one policy can be the default.
            </span>
          </span>
        </label>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Leave types
// ---------------------------------------------------------------------------

export function LeaveTypesTab({ canEdit }: { canEdit: boolean }) {
  const { data, isLoading } = useLeaveTypes();

  const columns: ColumnDef<LeaveType, unknown>[] = [
    {
      header: 'Leave type',
      accessorKey: 'name',
      cell: ({ row }) => <CellStack title={row.original.name} subtitle={row.original.shortCode} />,
    },
    {
      header: 'Yearly quota',
      accessorKey: 'yearlyQuota',
      cell: ({ row }) => (
        <span className="tabular-nums">{Number(row.original.yearlyQuota)} days</span>
      ),
    },
    {
      header: 'Carry forward',
      accessorKey: 'carryForward',
      cell: ({ row }) =>
        row.original.carryForward ? (
          <Pill tone="green" dot={false}>
            Up to {Number(row.original.maxCarryForward ?? 0)}
          </Pill>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      header: 'Paid',
      accessorKey: 'isPaid',
      cell: ({ row }) => (
        <Pill tone={row.original.isPaid ? 'green' : 'red'} dot={false}>
          {row.original.isPaid ? 'Paid' : 'Unpaid'}
        </Pill>
      ),
    },
    {
      header: 'Approval',
      accessorKey: 'approvalFlow',
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sub text-muted">
          {row.original.approvalFlow === 'SINGLE_LEVEL' ? 'Single level' : 'Team Lead → Manager'}
        </span>
      ),
    },
    activeColumn<LeaveType>(),
  ];

  return (
    <ReferenceTable<LeaveType, LeaveTypeInput>
      title="Leave types"
      subtitle="Quotas, carry forward and who approves. Approved leave writes the attendance day automatically."
      noun="leave type"
      endpoint="/settings/leave-types"
      queryKey={settingsKeys.leaveTypes}
      rows={data?.data ?? []}
      loading={isLoading}
      canEdit={canEdit}
      columns={columns}
      minWidth={880}
      schema={leaveTypeSchema}
      emptyIcon={<CalendarDays />}
      defaultValues={{
        name: '',
        shortCode: '',
        yearlyQuota: 12,
        carryForward: false,
        maxCarryForward: null,
        allowHalfDay: true,
        isPaid: true,
        approvalFlow: 'SINGLE_LEVEL',
        colorToken: 'blue',
        isActive: true,
      }}
      toFormValues={(row) => ({
        name: row.name,
        shortCode: row.shortCode,
        yearlyQuota: Number(row.yearlyQuota),
        carryForward: row.carryForward,
        maxCarryForward: row.maxCarryForward === null ? null : Number(row.maxCarryForward),
        allowHalfDay: row.allowHalfDay,
        isPaid: row.isPaid,
        approvalFlow: row.approvalFlow,
        colorToken: 'blue',
        isActive: row.isActive,
      })}
      deleteBlockedReason={(row) =>
        row._count.requests > 0
          ? `${row._count.requests} leave requests use this type. Deactivate it instead.`
          : null
      }
      fields={(form) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Name"
              required
              placeholder="Casual Leave"
              error={form.formState.errors.name?.message}
              {...form.register('name')}
            />
            <TextField
              label="Short code"
              required
              placeholder="CL"
              error={form.formState.errors.shortCode?.message}
              {...form.register('shortCode')}
            />
            <TextField
              label="Yearly quota (days)"
              type="number"
              step="0.5"
              required
              error={form.formState.errors.yearlyQuota?.message}
              {...form.register('yearlyQuota')}
            />
            <TextField
              label="Carry forward cap"
              type="number"
              step="0.5"
              hint="Required if carry forward is on."
              error={form.formState.errors.maxCarryForward?.message}
              {...form.register('maxCarryForward')}
            />
          </div>
          <SelectField
            label="Approval flow"
            options={[
              { value: 'SINGLE_LEVEL', label: 'Single level' },
              { value: 'TEAM_LEAD_THEN_MANAGER', label: 'Team Lead, then Manager' },
            ]}
            error={form.formState.errors.approvalFlow?.message}
            {...form.register('approvalFlow')}
          />
          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-sub">
              <input
                type="checkbox"
                className="size-4 rounded border-line text-blue"
                {...form.register('carryForward')}
              />
              Carry forward unused days
            </label>
            <label className="flex items-center gap-2 text-sub">
              <input
                type="checkbox"
                className="size-4 rounded border-line text-blue"
                {...form.register('allowHalfDay')}
              />
              Allow half days
            </label>
            <label className="flex items-center gap-2 text-sub">
              <input
                type="checkbox"
                className="size-4 rounded border-line text-blue"
                {...form.register('isPaid')}
              />
              Paid leave
            </label>
          </div>
        </>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

export function HolidaysTab({ canEdit }: { canEdit: boolean }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const { data, isLoading } = useHolidays(year);
  const { data: offices } = useOffices();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Holiday | null>(null);

  const remove = useSettingsMutation({
    mutationFn: (holiday: Holiday) => api.delete(`/settings/holidays/${holiday.id}`),
    invalidate: [settingsKeys.holidays(year)],
    successMessage: 'Holiday removed',
    onSuccess: () => setDeleting(null),
  });

  const columns: ColumnDef<Holiday, unknown>[] = [
    {
      header: 'Holiday',
      accessorKey: 'name',
      cell: ({ row }) => <CellStack title={row.original.name} />,
    },
    {
      header: 'Date',
      accessorKey: 'date',
      cell: ({ row }) => (
        <span className="whitespace-nowrap">{formatDisplayDate(row.original.date)}</span>
      ),
    },
    {
      header: 'Office',
      accessorKey: 'officeId',
      cell: ({ row }) => (
        <Pill tone="blue" dot={false}>
          {row.original.office?.name ?? 'All offices'}
        </Pill>
      ),
    },
    {
      header: 'Type',
      accessorKey: 'isOptional',
      cell: ({ row }) => (
        <Pill tone={row.original.isOptional ? 'amber' : 'gray'} dot={false}>
          {row.original.isOptional ? 'Optional' : 'Fixed'}
        </Pill>
      ),
    },
    ...(canEdit
      ? [
          {
            id: 'actions',
            header: '',
            meta: { className: 'w-0' },
            cell: ({ row }) => (
              <div className="flex justify-end">
                <IconButton
                  label={`Remove ${row.original.name}`}
                  size="sm"
                  onClick={() => setDeleting(row.original)}
                >
                  <Trash2 />
                </IconButton>
              </div>
            ),
          } as ColumnDef<Holiday, unknown>,
        ]
      : []),
  ];

  return (
    <>
      <Panel
        title="Holiday calendar"
        subtitle="Holidays are per office — Indian public holidays do not apply in Riyadh."
        action={
          <div className="flex items-center gap-2">
            <SelectField
              label="Year"
              srOnlyLabel
              value={String(year)}
              onChange={(event) => setYear(Number(event.target.value))}
              options={[currentYear - 1, currentYear, currentYear + 1].map((y) => ({
                value: String(y),
                label: String(y),
              }))}
            />
            {canEdit && (
              <Button
                size="sm"
                variant="primary"
                leadingIcon={<Plus />}
                onClick={() => setAdding(true)}
              >
                Add holiday
              </Button>
            )}
          </div>
        }
        flush
      >
        <DataTable
          data={data?.data ?? []}
          columns={columns}
          loading={isLoading}
          minWidth={700}
          getRowId={(row) => row.id}
          empty={
            <EmptyState
              icon={<CalendarDays />}
              title={`No holidays set for ${year}`}
              description="Add the public holidays each office observes."
              action={
                canEdit && (
                  <Button
                    size="sm"
                    variant="primary"
                    leadingIcon={<Plus />}
                    onClick={() => setAdding(true)}
                  >
                    Add holiday
                  </Button>
                )
              }
            />
          }
        />
      </Panel>

      {adding && (
        <HolidayDialog offices={offices?.data ?? []} year={year} onClose={() => setAdding(false)} />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        title={`Remove ${deleting?.name}?`}
        description="Attendance days already marked as a holiday keep their status until recomputed."
        confirmLabel="Remove holiday"
        destructive
        loading={remove.isPending}
      />
    </>
  );
}

function HolidayDialog({
  offices,
  year,
  onClose,
}: {
  offices: Array<{ id: string; name: string }>;
  year: number;
  onClose: () => void;
}) {
  const { register, handleSubmit, watch, setValue, formState } = useForm<HolidayInput>({
    resolver: zodResolver(holidaySchema),
    defaultValues: {
      name: '',
      date: `${year}-01-01`,
      officeIds: offices.map((o) => o.id),
      isOptional: false,
    },
  });

  const selected = watch('officeIds') ?? [];

  const save = useSettingsMutation({
    mutationFn: (values: HolidayInput) => api.post('/settings/holidays', values),
    invalidate: [settingsKeys.holidays(year)],
    successMessage: (result) => {
      const { created, skipped } = result as { created: number; skipped: number };
      return skipped > 0
        ? `Added for ${created} office(s); ${skipped} already had it`
        : `Holiday added for ${created} office(s)`;
    },
    onSuccess: onClose,
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add holiday"
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={handleSubmit((values) => save.mutate(values))}
          >
            Add holiday
          </Button>
        </>
      }
    >
      <form className="space-y-3" noValidate onSubmit={handleSubmit((v) => save.mutate(v))}>
        <TextField
          label="Holiday name"
          required
          placeholder="Diwali"
          error={formState.errors.name?.message}
          {...register('name')}
        />
        <TextField
          label="Date"
          type="date"
          required
          error={formState.errors.date?.message}
          {...register('date')}
        />

        <div>
          <p className="mb-1.5 text-sub font-heavy text-ink-2">
            Offices observing it
            <span aria-hidden className="ml-0.5 text-red">
              *
            </span>
          </p>
          <div className="grid gap-1.5">
            {offices.map((office) => (
              <label key={office.id} className="flex items-center gap-2 text-sub">
                <input
                  type="checkbox"
                  className="size-4 rounded border-line text-blue"
                  checked={selected.includes(office.id)}
                  onChange={(event) =>
                    setValue(
                      'officeIds',
                      event.target.checked
                        ? [...selected, office.id]
                        : selected.filter((id) => id !== office.id),
                      { shouldValidate: true },
                    )
                  }
                />
                {office.name}
              </label>
            ))}
          </div>
          {formState.errors.officeIds && (
            <p role="alert" className="mt-1.5 text-micro tracking-normal text-red">
              {formState.errors.officeIds.message}
            </p>
          )}
        </div>

        <label className="flex items-center gap-2 pt-1 text-sub">
          <input
            type="checkbox"
            className="size-4 rounded border-line text-blue"
            {...register('isOptional')}
          />
          Optional holiday
        </label>
      </form>
    </Dialog>
  );
}
