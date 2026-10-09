import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { updateProjectSchema, type UpdateProjectInput } from '@opsvera/shared';
import { Drawer } from '../../components/ui/Drawer';
import { Button } from '../../components/ui/Button';
import { SelectField, TextAreaField, TextField } from '../../components/ui/Field';
import { blankAsNull, mapApiErrorToFields } from '../../lib/forms';
import { HEALTH_LABEL, useTeamLookup, useUpdateProject, type ProjectDetail } from './useProjects';

/** Dates, manager, health and the description. Commercial terms stay on the booking. */
export function EditProjectDrawer({
  project,
  onClose,
}: {
  project: ProjectDetail;
  onClose: () => void;
}) {
  const update = useUpdateProject();
  const { data: lookups } = useTeamLookup(true);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<UpdateProjectInput>({
    resolver: blankAsNull<UpdateProjectInput>(zodResolver(updateProjectSchema), [
      'projectManagerId',
      'startDate',
      'endDate',
      'description',
    ]),
    defaultValues: {
      name: project.name,
      description: project.description ?? '',
      startDate: project.startDate?.slice(0, 10) ?? '',
      endDate: project.endDate?.slice(0, 10) ?? '',
      projectManagerId: project.projectManagerId ?? '',
      health: project.health,
    },
  });

  async function onSubmit(values: UpdateProjectInput) {
    try {
      await update.mutateAsync({ id: project.id, input: values });
      toast.success('Project updated');
      onClose();
    } catch (error) {
      const { fields, message } = mapApiErrorToFields(error);
      for (const [path, text] of Object.entries(fields)) {
        setError(path as keyof UpdateProjectInput, { message: text });
      }
      if (message) toast.error(message);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Edit project"
      subtitle={`${project.projectCode} — value and budget stay as booked`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={isSubmitting} onClick={handleSubmit(onSubmit)}>
            Save changes
          </Button>
        </>
      }
    >
      <form className="grid gap-3 sm:grid-cols-2" noValidate onSubmit={handleSubmit(onSubmit)}>
        <TextField
          label="Project name"
          required
          containerClassName="sm:col-span-2"
          error={errors.name?.message}
          {...register('name')}
        />
        <TextField
          label="Start date"
          type="date"
          error={errors.startDate?.message}
          {...register('startDate')}
        />
        <TextField
          label="End date"
          type="date"
          error={errors.endDate?.message}
          {...register('endDate')}
        />
        <SelectField
          label="Project manager"
          placeholder="Not assigned"
          error={errors.projectManagerId?.message}
          options={(lookups?.employees ?? []).map((e) => ({
            value: e.id,
            label: `${e.fullName} (${e.employeeCode})`,
          }))}
          {...register('projectManagerId')}
        />
        <SelectField
          label="Health"
          hint="Your own call on how delivery is going."
          error={errors.health?.message}
          options={Object.entries(HEALTH_LABEL).map(([value, label]) => ({ value, label }))}
          {...register('health')}
        />
        <TextAreaField
          label="Description"
          rows={5}
          containerClassName="sm:col-span-2"
          error={errors.description?.message}
          {...register('description')}
        />
      </form>
    </Drawer>
  );
}
