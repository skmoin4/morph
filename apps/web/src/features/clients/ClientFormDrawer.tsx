import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { createClientSchema, type CreateClientInput } from '@opsvera/shared';
import { Drawer } from '../../components/ui/Drawer';
import { Button, IconButton } from '../../components/ui/Button';
import { TextAreaField, TextField } from '../../components/ui/Field';
import { blankToNull, mapApiErrorToFields } from '../../lib/forms';
import { useCreateClient, useUpdateClient, type ClientDetail } from './useClients';

/** Add or edit a client. Contacts are entered here only when creating; an
 * existing client's contacts are managed from its detail drawer. */
export function ClientFormDrawer({
  client,
  onClose,
  onSaved,
}: {
  client: ClientDetail | null;
  onClose: () => void;
  onSaved?: (client: ClientDetail) => void;
}) {
  const isEdit = Boolean(client);
  const create = useCreateClient();
  const update = useUpdateClient();

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateClientInput>({
    resolver: zodResolver(createClientSchema),
    defaultValues: {
      name: client?.name ?? '',
      clientCode: client?.clientCode ?? '',
      industry: client?.industry ?? '',
      gstin: client?.gstin ?? '',
      website: client?.website ?? '',
      addressLine1: client?.addressLine1 ?? '',
      city: client?.city ?? '',
      state: client?.state ?? '',
      country: client?.country ?? 'India',
      notes: client?.notes ?? '',
      isActive: client?.isActive ?? true,
      contacts: isEdit ? undefined : [{ name: '', isPrimary: true }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'contacts' });

  async function onSubmit(values: CreateClientInput) {
    const { contacts, ...details } = values;
    try {
      const saved = isEdit
        ? await update.mutateAsync({ id: client!.id, input: blankToNull(details) })
        : await create.mutateAsync({
            ...blankToNull(details),
            // A contact row left empty is just an unused row, not an error.
            contacts: (contacts ?? [])
              .filter((c) => c.name.trim() !== '')
              .map((c) => blankToNull(c)),
          });
      toast.success(isEdit ? 'Client updated' : `${saved.name} added`);
      onSaved?.(saved);
      onClose();
    } catch (error) {
      const { fields: fieldErrors, message } = mapApiErrorToFields(error);
      for (const [path, text] of Object.entries(fieldErrors)) {
        setError(path as keyof CreateClientInput, { message: text });
      }
      if (message) toast.error(message);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={isEdit ? `Edit ${client!.name}` : 'Add client'}
      subtitle="Company details and who to talk to"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={isSubmitting} onClick={handleSubmit(onSubmit)}>
            {isEdit ? 'Save changes' : 'Add client'}
          </Button>
        </>
      }
    >
      <form className="space-y-5" noValidate onSubmit={handleSubmit(onSubmit)}>
        <section className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Client name"
            required
            containerClassName="sm:col-span-2"
            error={errors.name?.message}
            {...register('name')}
          />
          <TextField
            label="Client code"
            hint="Optional short reference"
            error={errors.clientCode?.message}
            {...register('clientCode')}
          />
          <TextField label="Industry" error={errors.industry?.message} {...register('industry')} />
          <TextField label="GSTIN" error={errors.gstin?.message} {...register('gstin')} />
          <TextField label="Website" error={errors.website?.message} {...register('website')} />
          <TextField
            label="Address"
            containerClassName="sm:col-span-2"
            error={errors.addressLine1?.message}
            {...register('addressLine1')}
          />
          <TextField label="City" error={errors.city?.message} {...register('city')} />
          <TextField label="State" error={errors.state?.message} {...register('state')} />
          <TextField label="Country" error={errors.country?.message} {...register('country')} />
          <TextAreaField
            label="Notes"
            rows={3}
            containerClassName="sm:col-span-2"
            error={errors.notes?.message}
            {...register('notes')}
          />
          {isEdit && (
            <label className="flex items-center gap-2 text-sub font-heavy text-ink-2 sm:col-span-2">
              <input type="checkbox" className="size-4 accent-blue" {...register('isActive')} />
              Active client
            </label>
          )}
        </section>

        {!isEdit && (
          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <h3 className="text-title font-heavy text-ink">Contacts</h3>
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<Plus />}
                onClick={() => append({ name: '', isPrimary: false })}
              >
                Add contact
              </Button>
            </div>
            <div className="space-y-3">
              {fields.map((field, index) => (
                <div
                  key={field.id}
                  className="grid gap-3 rounded-card border border-line bg-surface-2 p-3 sm:grid-cols-2"
                >
                  <TextField
                    label="Name"
                    error={errors.contacts?.[index]?.name?.message}
                    {...register(`contacts.${index}.name` as const)}
                  />
                  <TextField
                    label="Designation"
                    {...register(`contacts.${index}.designation` as const)}
                  />
                  <TextField
                    label="Email"
                    type="email"
                    error={errors.contacts?.[index]?.email?.message}
                    {...register(`contacts.${index}.email` as const)}
                  />
                  <TextField label="Phone" {...register(`contacts.${index}.phone` as const)} />
                  <div className="flex items-center justify-between sm:col-span-2">
                    <label className="flex items-center gap-2 text-sub text-ink-2">
                      <input
                        type="checkbox"
                        className="size-4 accent-blue"
                        {...register(`contacts.${index}.isPrimary` as const)}
                      />
                      Primary contact
                    </label>
                    {fields.length > 1 && (
                      <IconButton label="Remove contact" size="sm" onClick={() => remove(index)}>
                        <Trash2 />
                      </IconButton>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </form>
    </Drawer>
  );
}
