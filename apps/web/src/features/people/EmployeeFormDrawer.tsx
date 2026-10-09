import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createEmployeeSchema, type CreateEmployeeInput } from '@opsvera/shared';
import { Drawer } from '../../components/ui/Drawer';
import { Button } from '../../components/ui/Button';
import { SelectField, TextField } from '../../components/ui/Field';
import { api, ApiRequestError } from '../../lib/api';
import { useAuth } from '../../providers/AuthProvider';
import { useDepartments, useDesignations, useOffices } from '../settings/useSettings';
import { peopleKeys, useEmployees, type EmployeeDetail } from './usePeople';

export function EmployeeFormDrawer({
  employee,
  onClose,
}: {
  employee: EmployeeDetail | null;
  onClose: () => void;
}) {
  const isEdit = Boolean(employee);
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const { data: offices } = useOffices();
  const { data: departments } = useDepartments();
  const { data: designations } = useDesignations();
  // Any active employee can be a manager.
  const { data: managers } = useEmployees({ status: 'ACTIVE', pageSize: 200 });

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateEmployeeInput>({
    resolver: zodResolver(createEmployeeSchema),
    defaultValues: employee
      ? {
          employeeCode: employee.employeeCode,
          firstName: employee.firstName,
          lastName: employee.lastName,
          workEmail: employee.workEmail ?? '',
          personalEmail: employee.personalEmail ?? '',
          phone: employee.phone ?? '',
          joiningDate: employee.joiningDate.slice(0, 10),
          exitDate: employee.exitDate ? employee.exitDate.slice(0, 10) : null,
          officeId: employee.officeId,
          departmentId: employee.departmentId,
          designationId: employee.designationId,
          managerId: employee.managerId,
          attendanceMethod: employee.attendanceMethod,
          status: employee.status,
          city: employee.city ?? '',
          emergencyName: employee.emergencyName ?? '',
          emergencyPhone: employee.emergencyPhone ?? '',
          sendInvite: false,
        }
      : {
          employeeCode: '',
          firstName: '',
          lastName: '',
          workEmail: '',
          joiningDate: new Date().toISOString().slice(0, 10),
          officeId: '',
          attendanceMethod: 'BOTH',
          status: 'ACTIVE',
          sendInvite: false,
        },
  });

  const sendInvite = watch('sendInvite');

  async function onSubmit(values: CreateEmployeeInput) {
    try {
      const saved = isEdit
        ? await api.patch<EmployeeDetail>(`/employees/${employee!.id}`, values)
        : await api.post<EmployeeDetail>('/employees', values);

      await queryClient.invalidateQueries({ queryKey: ['people'] });
      toast.success(isEdit ? 'Employee updated' : `${saved.fullName} added`);
      onClose();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        // Map the server's field errors back onto the form.
        const fields = error.fieldErrors;
        let mapped = false;
        for (const [path, message] of Object.entries(fields)) {
          setError(path as keyof CreateEmployeeInput, { message });
          mapped = true;
        }
        if (error.details && typeof error.details === 'object' && 'field' in error.details) {
          setError((error.details as { field: string }).field as keyof CreateEmployeeInput, {
            message: error.message,
          });
          mapped = true;
        }
        if (!mapped) toast.error(error.message);
      } else {
        toast.error('Could not save. Try again.');
      }
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={isEdit ? `Edit ${employee!.fullName}` : 'Add employee'}
      subtitle={isEdit ? employee!.employeeCode : 'Profile, reporting line and attendance method'}
      width="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={isSubmitting} onClick={handleSubmit(onSubmit)}>
            {isEdit ? 'Save changes' : 'Add employee'}
          </Button>
        </>
      }
    >
      <form className="space-y-5" noValidate onSubmit={handleSubmit(onSubmit)}>
        <section className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Employee code"
            required
            error={errors.employeeCode?.message}
            {...register('employeeCode')}
          />
          <SelectField
            label="Status"
            required
            error={errors.status?.message}
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'NOTICE_PERIOD', label: 'Notice period' },
              { value: 'INACTIVE', label: 'Inactive' },
              { value: 'EXITED', label: 'Exited' },
            ]}
            {...register('status')}
          />
          <TextField
            label="First name"
            required
            error={errors.firstName?.message}
            {...register('firstName')}
          />
          <TextField
            label="Last name"
            required
            error={errors.lastName?.message}
            {...register('lastName')}
          />
          <TextField
            label="Work email"
            type="email"
            hint="Needed to send a login invitation."
            error={errors.workEmail?.message}
            {...register('workEmail')}
          />
          <TextField label="Phone" error={errors.phone?.message} {...register('phone')} />
        </section>

        <section>
          <h3 className="mb-2.5 text-title font-heavy text-ink">Placement</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Office"
              required
              placeholder="Choose an office"
              hint="Sets the time zone their attendance is judged in."
              error={errors.officeId?.message}
              options={(offices?.data ?? []).map((o) => ({
                value: o.id,
                label: `${o.name} (${o.timezone})`,
              }))}
              {...register('officeId')}
            />
            <SelectField
              label="Department"
              placeholder="None"
              error={errors.departmentId?.message}
              options={(departments?.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
              {...register('departmentId')}
            />
            <SelectField
              label="Designation"
              placeholder="None"
              error={errors.designationId?.message}
              options={(designations?.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
              {...register('designationId')}
            />
            <SelectField
              label="Reports to"
              placeholder="Nobody"
              hint="Drives TEAM data scope and the approval chain."
              error={errors.managerId?.message}
              options={(managers?.data ?? [])
                .filter((m) => m.id !== employee?.id)
                .map((m) => ({ value: m.id, label: `${m.fullName} (${m.employeeCode})` }))}
              {...register('managerId')}
            />
            <TextField
              label="Joining date"
              type="date"
              required
              error={errors.joiningDate?.message}
              {...register('joiningDate')}
            />
            <SelectField
              label="Attendance method"
              required
              hint="Mobile uses GPS and a selfie; Office uses the allowed IP list."
              error={errors.attendanceMethod?.message}
              options={[
                { value: 'BOTH', label: 'Mobile + Office' },
                { value: 'MOBILE', label: 'Mobile only' },
                { value: 'OFFICE', label: 'Office only' },
              ]}
              {...register('attendanceMethod')}
            />
          </div>
        </section>

        {!isEdit && (can('cost.edit') || can('salary.edit')) && (
          <section>
            <h3 className="text-title font-heavy text-ink">Opening pay</h3>
            <p className="mt-1 text-sub text-muted">
              Both are dated from the joining date, so time logged from day one is costable. Later
              changes are added as new rows, never edits.
            </p>
            <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
              {can('cost.edit') && (
                <TextField
                  label="Hourly cost rate"
                  placeholder="650.00"
                  error={errors.hourlyRate?.message}
                  {...register('hourlyRate')}
                />
              )}
              {can('salary.edit') && (
                <TextField
                  label="Monthly salary"
                  placeholder="72000.00"
                  error={errors.monthlySalary?.message}
                  {...register('monthlySalary')}
                />
              )}
            </div>
          </section>
        )}

        <section>
          <h3 className="mb-2.5 text-title font-heavy text-ink">Emergency contact</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Name" {...register('emergencyName')} />
            <TextField label="Phone" {...register('emergencyPhone')} />
          </div>
        </section>

        {!isEdit && (
          <label className="flex items-start gap-2.5 rounded-card border border-line bg-surface-2 p-3">
            <input
              type="checkbox"
              className="mt-0.5 size-4 rounded border-line text-blue"
              {...register('sendInvite')}
            />
            <span className="text-sub">
              <b className="font-heavy text-ink">Send a login invitation now</b>
              <span className="mt-0.5 block text-muted">
                {sendInvite
                  ? 'They will get an email to choose a password. A work email is required.'
                  : 'You can invite them later from their profile.'}
              </span>
            </span>
          </label>
        )}
      </form>
    </Drawer>
  );
}

export { peopleKeys };
