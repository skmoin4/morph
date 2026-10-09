import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import {
  endsNextDay,
  formatExclusiveEndInclusive,
  shiftAssignmentSchema,
  shiftLengthMinutes,
  shiftSchema,
  type ShiftInput,
} from '@opsvera/shared';
import { Button, IconButton } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/Dialog';
import { Drawer } from '../../components/ui/Drawer';
import { SelectField, TextField } from '../../components/ui/Field';
import { Pill } from '../../components/ui/Pill';
import { Skeleton } from '../../components/ui/Skeleton';
import { ApiRequestError } from '../../lib/api';
import { mapApiErrorToFields } from '../../lib/forms';
import { formatDisplayDate } from '../../lib/format';
import { useAuth } from '../../providers/AuthProvider';
import {
  useAssignShift,
  useCreateShift,
  useDeleteShift,
  useRemoveAssignment,
  useShiftAssignments,
  useShiftLookups,
  useUpdateShift,
  WEEKDAY_NAMES,
  type Shift,
} from './useShifts';

const hours = (minutes: number) =>
  `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;

/** Create or edit a shift; for an existing one, who works it. */
export function ShiftDrawer({ shift, onClose }: { shift: Shift | null; onClose: () => void }) {
  const { can } = useAuth();
  const isNew = shift === null;
  const create = useCreateShift();
  const update = useUpdateShift();
  const remove = useDeleteShift();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const canEdit = isNew ? can('shift.create') : can('shift.edit');

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ShiftInput>({
    resolver: zodResolver(shiftSchema),
    defaultValues: shift
      ? {
          name: shift.name,
          startTime: shift.startTime,
          endTime: shift.endTime,
          breakMinutes: shift.breakMinutes,
          graceMinutes: shift.graceMinutes,
          isDefault: shift.isDefault,
          isActive: shift.isActive,
        }
      : {
          name: '',
          startTime: '09:30',
          endTime: '18:30',
          breakMinutes: 60,
          graceMinutes: 10,
          isDefault: false,
          isActive: true,
        },
  });

  const [start, end, breakMinutes] = watch(['startTime', 'endTime', 'breakMinutes']);
  const validTimes =
    /^\d{2}:\d{2}$/.test(start ?? '') && /^\d{2}:\d{2}$/.test(end ?? '') && start !== end;
  const length = validTimes ? shiftLengthMinutes(start, end) : null;

  async function onSubmit(values: ShiftInput) {
    try {
      if (isNew) await create.mutateAsync(values);
      else await update.mutateAsync({ id: shift.id, input: values });
      toast.success(isNew ? 'Shift created' : 'Shift updated');
      onClose();
    } catch (error) {
      const { fields, message } = mapApiErrorToFields(error);
      for (const [path, text] of Object.entries(fields))
        setError(path as keyof ShiftInput, { message: text });
      if (message) toast.error(message);
    }
  }

  async function confirmDelete() {
    if (!shift) return;
    try {
      await remove.mutateAsync(shift.id);
      toast.success('Shift deleted');
      onClose();
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not delete the shift.');
      setConfirmingDelete(false);
    }
  }

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        width="lg"
        title={isNew ? 'New shift' : shift.name}
        subtitle={isNew ? 'A template people can be put on' : `${shift.startTime}–${shift.endTime}`}
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <div>
              {!isNew && can('shift.delete') && (
                <Button
                  variant="danger"
                  leadingIcon={<Trash2 />}
                  onClick={() => setConfirmingDelete(true)}
                >
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>
                {canEdit ? 'Cancel' : 'Close'}
              </Button>
              {canEdit && (
                <Button
                  variant="primary"
                  loading={isSubmitting}
                  disabled={!isNew && !isDirty}
                  onClick={handleSubmit(onSubmit)}
                >
                  {isNew ? 'Create shift' : 'Save changes'}
                </Button>
              )}
            </div>
          </div>
        }
      >
        <div className="space-y-6">
          <form noValidate onSubmit={handleSubmit(onSubmit)}>
            <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Name"
                required
                containerClassName="sm:col-span-2"
                error={errors.name?.message}
                {...register('name')}
              />
              <TextField
                label="Starts"
                type="time"
                required
                error={errors.startTime?.message}
                {...register('startTime')}
              />
              <TextField
                label="Ends"
                type="time"
                required
                error={errors.endTime?.message}
                {...register('endTime')}
              />
              <TextField
                label="Unpaid break (minutes)"
                type="number"
                min={0}
                hint="Taken off a long day, unless the person already punched out for it."
                error={errors.breakMinutes?.message}
                {...register('breakMinutes')}
              />
              <TextField
                label="Grace (minutes)"
                type="number"
                min={0}
                hint="Used when no attendance policy sets its own."
                error={errors.graceMinutes?.message}
                {...register('graceMinutes')}
              />
              {length !== null && (
                <p className="rounded-card bg-surface-2 p-3 text-sub text-ink-2 sm:col-span-2">
                  {hours(length)} long
                  {endsNextDay(start, end) &&
                    ' — runs past midnight, so a clock-out the next morning still belongs to the day it started'}
                  {breakMinutes ? ` · ${hours(length - Number(breakMinutes))} after the break` : ''}
                  .
                </p>
              )}
              <label className="flex items-start gap-2.5 text-sub sm:col-span-2">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-blue"
                  {...register('isDefault')}
                />
                <span>
                  <b className="font-heavy text-ink">Default shift</b>
                  <span className="block text-muted">
                    Applies to anyone with no assignment of their own. Only one shift is the
                    default.
                  </span>
                </span>
              </label>
              {!isNew && (
                <label className="flex items-center gap-2.5 text-sub sm:col-span-2">
                  <input type="checkbox" className="size-4 accent-blue" {...register('isActive')} />
                  <b className="font-heavy text-ink">Active</b>
                  <span className="text-muted">
                    — inactive shifts cannot be given to anyone new
                  </span>
                </label>
              )}
            </fieldset>
          </form>

          {!isNew && shift && (
            <p className="rounded-card border border-line bg-surface-2 p-3 text-sub text-muted">
              Edits apply from now on. Days already settled keep the result they were given.
            </p>
          )}

          {shift && <Assignments shift={shift} />}
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={confirmDelete}
        loading={remove.isPending}
        destructive
        title="Delete this shift?"
        description="Only a shift nobody has ever used can be deleted; otherwise deactivate it."
        confirmLabel="Delete shift"
      />
    </>
  );
}

function Assignments({ shift }: { shift: Shift }) {
  const { can } = useAuth();
  const canAssign = can('shift.create');
  const { data, isLoading } = useShiftAssignments(shift.id);
  const { data: lookups } = useShiftLookups(canAssign);
  const assign = useAssignShift();
  const removeAssignment = useRemoveAssignment();

  const [adding, setAdding] = useState(false);
  const [who, setWho] = useState('');
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState('');
  const [offDays, setOffDays] = useState<number[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function add() {
    const [kind, id] = who.split(':');
    const parsed = shiftAssignmentSchema.safeParse({
      employeeId: kind === 'e' ? id : null,
      departmentId: kind === 'd' ? id : null,
      effectiveFrom: from,
      effectiveTo: to || null,
      weeklyOffDays: offDays,
    });
    if (!who) return setErrors({ employeeId: 'Choose a person or a department.' });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      return setErrors(next);
    }
    try {
      await assign.mutateAsync({ id: shift.id, input: parsed.data });
      toast.success('Assigned');
      setAdding(false);
      setWho('');
      setTo('');
      setOffDays(null);
      setErrors({});
    } catch (error) {
      if (error instanceof ApiRequestError) setErrors({ effectiveFrom: error.message });
      else toast.error('Could not assign.');
    }
  }

  async function removeOne(id: string) {
    try {
      await removeAssignment.mutateAsync(id);
      toast.success('Assignment removed');
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not remove it.');
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-title font-heavy text-ink">
          Who works it{' '}
          <span className="text-sub font-normal text-muted">({data?.length ?? 0})</span>
        </h3>
        {canAssign && shift.isActive && !adding && (
          <Button size="sm" variant="ghost" leadingIcon={<Plus />} onClick={() => setAdding(true)}>
            Assign
          </Button>
        )}
      </div>

      {adding && lookups && (
        <div className="mb-3 grid gap-3 rounded-card border border-line bg-surface-2 p-3 sm:grid-cols-2">
          <SelectField
            label="Person or department"
            required
            placeholder="Choose…"
            containerClassName="sm:col-span-2"
            error={errors.employeeId}
            value={who}
            onChange={(event) => setWho(event.target.value)}
            options={[
              ...lookups.departments.map((d) => ({
                value: `d:${d.id}`,
                label: `Department · ${d.name}`,
              })),
              ...lookups.employees.map((e) => ({
                value: `e:${e.id}`,
                label: `${e.fullName} (${e.employeeCode} · ${e.office})`,
              })),
            ]}
          />
          <TextField
            label="From"
            type="date"
            required
            error={errors.effectiveFrom}
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <TextField
            label="Until (optional)"
            type="date"
            hint="Leave empty until changed. A temporary change hands back to the previous shift afterwards."
            error={errors.effectiveTo}
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-sub font-heavy text-ink-2">Weekly offs for this assignment</p>
            <label className="mb-2 flex items-center gap-2 text-sub text-ink-2">
              <input
                type="checkbox"
                className="size-4 accent-blue"
                checked={offDays === null}
                onChange={(event) => setOffDays(event.target.checked ? null : [0])}
              />
              Use the office’s weekly offs
            </label>
            {offDays !== null && (
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_NAMES.map((name, day) => (
                  <label
                    key={name}
                    className={`cursor-pointer rounded-control border px-2.5 py-1 text-sub font-heavy ${offDays.includes(day) ? 'border-blue bg-pill-blue-bg text-pill-blue-fg' : 'border-line bg-surface text-muted'}`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={offDays.includes(day)}
                      onChange={() =>
                        setOffDays(
                          offDays.includes(day)
                            ? offDays.filter((d) => d !== day)
                            : [...offDays, day],
                        )
                      }
                    />
                    {name}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" loading={assign.isPending} onClick={add}>
              Assign
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : (data?.length ?? 0) === 0 ? (
        <p className="text-sub text-muted">
          {shift.isDefault
            ? 'Nobody is assigned directly — everyone without an assignment is on this shift.'
            : 'Nobody is on this shift yet.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {data!.map((a) => {
            const ended = a.effectiveTo && a.effectiveTo.slice(0, 10) <= today;
            const upcoming = a.effectiveFrom.slice(0, 10) > today;
            return (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line-soft bg-surface-2 p-3"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-body font-heavy text-ink">
                    {a.employee ? a.employee.fullName : `Department · ${a.department?.name}`}
                    {ended && <Pill tone="gray">Ended</Pill>}
                    {upcoming && <Pill tone="blue">Upcoming</Pill>}
                    {!ended && !upcoming && <Pill tone="green">Current</Pill>}
                  </p>
                  <p className="text-sub text-muted">
                    From {formatDisplayDate(a.effectiveFrom)}
                    {a.effectiveTo
                      ? ` to ${formatExclusiveEndInclusive(a.effectiveTo)}`
                      : ' — until changed'}
                    {a.weeklyOffDays &&
                      ` · off ${a.weeklyOffDays.map((d) => WEEKDAY_NAMES[d]).join(', ') || 'never'}`}
                  </p>
                </div>
                {can('shift.delete') && (
                  <IconButton label="Remove assignment" size="sm" onClick={() => removeOne(a.id)}>
                    <Trash2 />
                  </IconButton>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
