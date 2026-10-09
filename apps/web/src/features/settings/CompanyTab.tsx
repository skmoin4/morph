import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  buildProjectCode,
  financialYearLabel,
  updateCompanySchema,
  type UpdateCompanyInput,
} from '@opsvera/shared';
import { Panel } from '../../components/ui/Panel';
import { Button } from '../../components/ui/Button';
import { SelectField, TextField } from '../../components/ui/Field';
import { Pill } from '../../components/ui/Pill';
import { SkeletonText } from '../../components/ui/Skeleton';
import { api } from '../../lib/api';
import { settingsKeys, useCompany, useSettingsMutation, type Company } from './useSettings';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function CompanyTab({ canEdit }: { canEdit: boolean }) {
  const { data: company, isLoading } = useCompany();

  const form = useForm<UpdateCompanyInput>({
    resolver: zodResolver(updateCompanySchema),
    values: company ? toFormValues(company) : undefined,
  });

  const { register, handleSubmit, watch, reset, formState } = form;

  const save = useSettingsMutation({
    mutationFn: (values: UpdateCompanyInput) => api.put<Company>('/settings/company', values),
    invalidate: [settingsKeys.company],
    successMessage: 'Company profile saved',
    onSuccess: (updated) => reset(toFormValues(updated)),
  });

  const prefix = watch('codePrefix');
  const pattern = watch('projectCodePattern');
  const fyStartMonth = watch('fyStartMonth');

  // Live preview of the next code, so the effect of a pattern change is
  // visible before it is saved.
  const preview = useMemo(() => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      return buildProjectCode(pattern ?? '', {
        prefix: prefix || 'MOR',
        fy: financialYearLabel(today, Number(fyStartMonth) || 4),
        type: 'HOS',
        sequence: 43,
      });
    } catch (error) {
      return error instanceof Error ? error.message : 'Invalid pattern';
    }
  }, [prefix, pattern, fyStartMonth]);

  useEffect(() => {
    if (company) reset(toFormValues(company));
  }, [company, reset]);

  if (isLoading) {
    return (
      <Panel title="Company profile">
        <SkeletonText lines={6} />
      </Panel>
    );
  }

  return (
    <form onSubmit={handleSubmit((values) => save.mutate(values))} className="space-y-4" noValidate>
      <Panel
        title="Company profile"
        subtitle="Name, registration and contact details that appear on exports."
      >
        <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Company name"
            required
            error={formState.errors.name?.message}
            {...register('name')}
          />
          <TextField
            label="Legal name"
            hint="As registered, if different."
            error={formState.errors.legalName?.message}
            {...register('legalName')}
          />
          <TextField label="GSTIN" error={formState.errors.gstin?.message} {...register('gstin')} />
          <TextField
            label="Contact email"
            type="email"
            error={formState.errors.email?.message}
            {...register('email')}
          />
          <TextField label="Phone" error={formState.errors.phone?.message} {...register('phone')} />
          <TextField
            label="Address"
            containerClassName="sm:col-span-2"
            error={formState.errors.addressLine1?.message}
            {...register('addressLine1')}
          />
          <TextField label="City" {...register('city')} />
          <TextField label="State" {...register('state')} />
          <TextField label="Country" {...register('country')} />
          <TextField label="Postal code" {...register('postalCode')} />
        </fieldset>
      </Panel>

      <Panel
        title="Financial year & currency"
        subtitle="The financial year drives the FY label inside every project code."
      >
        <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-3">
          <SelectField
            label="Financial year starts"
            required
            error={formState.errors.fyStartMonth?.message}
            options={MONTHS.map((month, index) => ({
              value: String(index + 1),
              label: month,
            }))}
            {...register('fyStartMonth')}
          />
          <TextField
            label="Currency code"
            required
            hint="ISO 4217, e.g. INR"
            error={formState.errors.currency?.message}
            {...register('currency')}
          />
          <TextField
            label="Currency symbol"
            required
            error={formState.errors.currencySymbol?.message}
            {...register('currencySymbol')}
          />
        </fieldset>
      </Panel>

      <Panel
        title="Project code format"
        subtitle="Codes already issued keep their original format — this only affects new ones."
      >
        <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Code prefix"
            required
            hint="2–10 letters or numbers."
            error={formState.errors.codePrefix?.message}
            {...register('codePrefix')}
          />
          <TextField
            label="Pattern"
            required
            error={formState.errors.projectCodePattern?.message}
            {...register('projectCodePattern')}
          />
        </fieldset>

        <div className="mt-4 rounded-card border border-line bg-surface-2 p-3.5">
          <p className="text-micro font-heavy uppercase text-muted">Next code will look like</p>
          <p className="mt-2 font-mono text-title font-heavy text-ink">{preview}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[
              ['{PREFIX}', 'Company prefix'],
              ['{FY}', 'Financial year'],
              ['{TYPE}', 'Project type code'],
              ['{SEQ4}', 'Sequence, 4 digits'],
            ].map(([token, meaning]) => (
              <Pill key={token} tone="blue" dot={false}>
                <span className="font-mono">{token}</span>
                <span className="font-normal opacity-70">{meaning}</span>
              </Pill>
            ))}
          </div>
        </div>
      </Panel>

      {canEdit && (
        <div className="sticky bottom-0 flex items-center justify-end gap-2 rounded-panel border border-line bg-surface/95 px-4 py-3 backdrop-blur-xl">
          {formState.isDirty && <p className="mr-auto text-sub text-muted">Unsaved changes</p>}
          <Button
            variant="ghost"
            onClick={() => company && reset(toFormValues(company))}
            disabled={!formState.isDirty || save.isPending}
          >
            Discard
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={save.isPending}
            disabled={!formState.isDirty}
          >
            Save changes
          </Button>
        </div>
      )}
    </form>
  );
}

function toFormValues(company: Company): UpdateCompanyInput {
  return {
    name: company.name,
    legalName: company.legalName,
    codePrefix: company.codePrefix,
    projectCodePattern: company.projectCodePattern,
    fyStartMonth: company.fyStartMonth,
    currency: company.currency,
    currencySymbol: company.currencySymbol,
    gstin: company.gstin,
    addressLine1: company.addressLine1,
    addressLine2: company.addressLine2,
    city: company.city,
    state: company.state,
    country: company.country,
    postalCode: company.postalCode,
    phone: company.phone,
    email: company.email,
  };
}
