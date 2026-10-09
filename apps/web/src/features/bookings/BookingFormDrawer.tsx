import { useMemo } from 'react';
import { useForm, useWatch, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { bookingBaseSchema, createBookingSchema, type CreateBookingInput } from '@opsvera/shared';
import { Drawer } from '../../components/ui/Drawer';
import { Button } from '../../components/ui/Button';
import { SelectField, TextAreaField, TextField } from '../../components/ui/Field';
import { blankAsNull, blankToNull, mapApiErrorToFields } from '../../lib/forms';
import { useAuth } from '../../providers/AuthProvider';
import { useClients } from '../clients/useClients';
import { useEmployees } from '../people/usePeople';
import { BILLING_LABEL } from './BookingBadges';
import {
  useBookingLookups,
  useCreateBooking,
  useUpdateBooking,
  type BookingDetail,
} from './useBookings';

type FormValues = CreateBookingInput;

const today = () => new Date().toISOString().slice(0, 10);

/** New booking, or edit one that has not become a project yet. */
export function BookingFormDrawer({
  booking,
  defaultClientId,
  onClose,
  onSaved,
}: {
  booking: BookingDetail | null;
  defaultClientId?: string;
  onClose: () => void;
  onSaved: (booking: BookingDetail) => void;
}) {
  const isEdit = Boolean(booking);
  const { can } = useAuth();
  const create = useCreateBooking();
  const update = useUpdateBooking();

  const { data: clients } = useClients({ isActive: true, pageSize: 200 });
  const { data: lookups } = useBookingLookups();
  // Only people who can see the employee list can pick a PM from it.
  const canPickManager = can('employee.view');
  const { data: managers } = useEmployees(
    { status: 'ACTIVE', pageSize: 200 },
    { enabled: canPickManager },
  );

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    // A role that cannot see project values gets no value in the booking, so it
    // cannot be required of them — and must not be overwritten on save.
    resolver: blankAsNull<FormValues>(
      zodResolver(
        (isEdit && booking!.projectValue === undefined
          ? bookingBaseSchema.partial({ projectValue: true })
          : createBookingSchema) as typeof createBookingSchema,
      ) as unknown as Resolver<FormValues>,
      ['clientContactId', 'projectManagerId', 'scopeDescription'],
    ),
    defaultValues: booking
      ? {
          clientId: booking.clientId,
          clientContactId: booking.clientContactId ?? '',
          projectName: booking.projectName,
          projectTypeId: booking.projectTypeId,
          officeId: booking.officeId,
          bookingDate: booking.bookingDate.slice(0, 10),
          projectValue: (booking.projectValue ?? undefined) as string,
          budgetHours: Number(booking.budgetHours),
          billingType: booking.billingType,
          expectedStartDate: booking.expectedStartDate.slice(0, 10),
          expectedEndDate: booking.expectedEndDate.slice(0, 10),
          scopeDescription: booking.scopeDescription ?? '',
          projectManagerId: booking.projectManagerId ?? '',
        }
      : {
          clientId: defaultClientId ?? '',
          clientContactId: '',
          projectName: '',
          projectTypeId: '',
          officeId: '',
          bookingDate: today(),
          projectValue: '',
          budgetHours: 0,
          billingType: 'FIXED',
          expectedStartDate: '',
          expectedEndDate: '',
          scopeDescription: '',
          projectManagerId: '',
        },
  });

  const valueHidden = isEdit && booking!.projectValue === undefined;

  const clientId = useWatch({ control, name: 'clientId' });
  const contacts = useMemo(
    () => clients?.data.find((c) => c.id === clientId)?.contacts ?? [],
    [clients, clientId],
  );

  async function onSubmit(values: CreateBookingInput) {
    const input = blankToNull(values) as CreateBookingInput;
    if (valueHidden) delete (input as Partial<CreateBookingInput>).projectValue;
    try {
      const saved = isEdit
        ? await update.mutateAsync({ id: booking!.id, input })
        : await create.mutateAsync(input);
      toast.success(
        isEdit ? 'Booking updated' : `Booking ${saved.bookingNumber} created as a draft`,
      );
      onSaved(saved);
      onClose();
    } catch (error) {
      const { fields, message } = mapApiErrorToFields(error);
      for (const [path, text] of Object.entries(fields)) {
        setError(path as keyof FormValues, { message: text });
      }
      if (message) toast.error(message);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      width="lg"
      title={isEdit ? `Edit ${booking!.bookingNumber}` : 'New booking'}
      subtitle={
        isEdit
          ? booking!.projectName
          : 'Saved as a draft. It becomes a project once the client’s confirmation is attached.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={isSubmitting} onClick={handleSubmit(onSubmit)}>
            {isEdit ? 'Save changes' : 'Create draft booking'}
          </Button>
        </>
      }
    >
      <form className="space-y-6" noValidate onSubmit={handleSubmit(onSubmit)}>
        <section>
          <h3 className="mb-2.5 text-title font-heavy text-ink">Client and project</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Client"
              required
              placeholder="Choose a client"
              hint="Not listed? Add the client under Commercial → Clients first."
              error={errors.clientId?.message}
              options={(clients?.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
              {...register('clientId')}
            />
            <SelectField
              label="Client contact"
              placeholder={contacts.length === 0 ? 'No contacts' : 'Choose a contact'}
              error={errors.clientContactId?.message}
              options={contacts.map((c) => ({
                value: c.id,
                label: c.isPrimary ? `${c.name} (primary)` : c.name,
              }))}
              {...register('clientContactId')}
            />
            <TextField
              label="Project name"
              required
              containerClassName="sm:col-span-2"
              error={errors.projectName?.message}
              {...register('projectName')}
            />
            <SelectField
              label="Project type"
              required
              placeholder="Choose a type"
              hint="Its short code goes into the project code."
              error={errors.projectTypeId?.message}
              options={(lookups?.projectTypes ?? []).map((t) => ({
                value: t.id,
                label: `${t.name} (${t.shortCode})`,
              }))}
              {...register('projectTypeId')}
            />
            <SelectField
              label="Office"
              required
              placeholder="Choose an office"
              error={errors.officeId?.message}
              options={(lookups?.offices ?? []).map((o) => ({ value: o.id, label: o.name }))}
              {...register('officeId')}
            />
            {canPickManager && (
              <SelectField
                label="Project manager"
                placeholder="Decide later"
                hint="Carried to the project when it is created."
                error={errors.projectManagerId?.message}
                options={(managers?.data ?? []).map((m) => ({ value: m.id, label: m.fullName }))}
                {...register('projectManagerId')}
              />
            )}
          </div>
        </section>

        <section>
          <h3 className="mb-2.5 text-title font-heavy text-ink">Commercials</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Booking date"
              type="date"
              required
              hint="Decides the financial year in the project code."
              error={errors.bookingDate?.message}
              {...register('bookingDate')}
            />
            <SelectField
              label="Billing type"
              required
              hint="Recorded only; invoicing arrives in a later phase."
              error={errors.billingType?.message}
              options={Object.entries(BILLING_LABEL).map(([value, label]) => ({ value, label }))}
              {...register('billingType')}
            />
            <TextField
              label="Project value (₹)"
              required={!valueHidden}
              inputMode="decimal"
              placeholder={valueHidden ? 'Hidden for your role — leave blank to keep' : '7500000'}
              error={errors.projectValue?.message}
              {...register('projectValue')}
            />
            <TextField
              label="Budget hours"
              type="number"
              min={0}
              step="any"
              required
              error={errors.budgetHours?.message}
              {...register('budgetHours')}
            />
            <TextField
              label="Expected start"
              type="date"
              required
              error={errors.expectedStartDate?.message}
              {...register('expectedStartDate')}
            />
            <TextField
              label="Expected end"
              type="date"
              required
              error={errors.expectedEndDate?.message}
              {...register('expectedEndDate')}
            />
          </div>
        </section>

        <TextAreaField
          label="Scope description"
          rows={4}
          hint="What was agreed — carried over to the project."
          error={errors.scopeDescription?.message}
          {...register('scopeDescription')}
        />
      </form>
    </Drawer>
  );
}
