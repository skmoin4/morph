import { useState, type ReactNode } from 'react';
import { useForm, type DefaultValues, type FieldValues, type Path } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import type { ZodType, ZodTypeDef } from 'zod';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { QueryKey } from '@tanstack/react-query';
import { Panel } from '../../components/ui/Panel';
import { Button, IconButton } from '../../components/ui/Button';
import { DataTable } from '../../components/ui/DataTable';
import { Dialog, ConfirmDialog } from '../../components/ui/Dialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pill } from '../../components/ui/Pill';
import { api } from '../../lib/api';
import { useSettingsMutation } from './useSettings';

export interface ReferenceRow {
  id: string;
  name: string;
  isActive: boolean;
}

export interface ReferenceTableProps<TRow extends ReferenceRow, TForm extends FieldValues> {
  title: string;
  subtitle: string;
  /** Singular noun for buttons and messages, e.g. "department". */
  noun: string;
  endpoint: string;
  queryKey: QueryKey;
  rows: TRow[];
  loading: boolean;
  canEdit: boolean;
  columns: ColumnDef<TRow, unknown>[];
  /** Input and output types differ for schemas that coerce, e.g. money. */
  schema: ZodType<TForm, ZodTypeDef, unknown>;
  emptyIcon?: ReactNode;
  defaultValues: DefaultValues<TForm>;
  toFormValues: (row: TRow) => DefaultValues<TForm>;
  /** The form body. Receives the react-hook-form instance. */
  fields: (form: ReturnType<typeof useForm<TForm>>) => ReactNode;
  /** Why a row cannot be deleted, if it cannot. Returning null allows it. */
  deleteBlockedReason?: (row: TRow) => string | null;
  minWidth?: number;
}

/**
 * The shared editor for the small reference tables in Settings — departments,
 * designations, project types, expense categories.
 *
 * They differ only in their columns and their form fields, so those are the
 * props; everything else (list, dialog, create/update, delete confirmation,
 * toasts, cache invalidation) is the same and lives here once.
 */
export function ReferenceTable<TRow extends ReferenceRow, TForm extends FieldValues>({
  title,
  subtitle,
  noun,
  endpoint,
  queryKey,
  rows,
  loading,
  canEdit,
  columns,
  schema,
  emptyIcon,
  defaultValues,
  toFormValues,
  fields,
  deleteBlockedReason,
  minWidth = 720,
}: ReferenceTableProps<TRow, TForm>) {
  const [editing, setEditing] = useState<TRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TRow | null>(null);

  const remove = useSettingsMutation({
    mutationFn: (row: TRow) => api.delete(`${endpoint}/${row.id}`),
    invalidate: [queryKey],
    successMessage: `${capitalise(noun)} deleted`,
    onSuccess: () => setDeleting(null),
  });

  const actionColumn: ColumnDef<TRow, unknown> = {
    id: 'actions',
    header: '',
    meta: { className: 'w-0' },
    cell: ({ row }) => (
      <div className="flex justify-end gap-1">
        <IconButton
          label={`Edit ${row.original.name}`}
          size="sm"
          onClick={() => setEditing(row.original)}
        >
          <Pencil />
        </IconButton>
        <IconButton
          label={`Delete ${row.original.name}`}
          size="sm"
          onClick={() => setDeleting(row.original)}
        >
          <Trash2 />
        </IconButton>
      </div>
    ),
  };

  const blockedReason = deleting && deleteBlockedReason ? deleteBlockedReason(deleting) : null;

  return (
    <>
      <Panel
        title={title}
        subtitle={subtitle}
        action={
          canEdit && (
            <Button
              size="sm"
              variant="primary"
              leadingIcon={<Plus />}
              onClick={() => setCreating(true)}
            >
              Add {noun}
            </Button>
          )
        }
        flush
      >
        <DataTable
          data={rows}
          columns={canEdit ? [...columns, actionColumn] : columns}
          loading={loading}
          minWidth={minWidth}
          getRowId={(row) => row.id}
          empty={
            <EmptyState
              icon={emptyIcon}
              title={`No ${noun}s yet`}
              description={subtitle}
              action={
                canEdit && (
                  <Button
                    size="sm"
                    variant="primary"
                    leadingIcon={<Plus />}
                    onClick={() => setCreating(true)}
                  >
                    Add {noun}
                  </Button>
                )
              }
            />
          }
        />
      </Panel>

      {(creating || editing) && (
        <ReferenceDialog
          noun={noun}
          endpoint={endpoint}
          queryKey={queryKey}
          schema={schema}
          row={editing}
          defaultValues={editing ? toFormValues(editing) : defaultValues}
          fields={fields}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && !blockedReason && remove.mutate(deleting)}
        title={blockedReason ? `Cannot delete ${deleting?.name}` : `Delete ${deleting?.name}?`}
        description={blockedReason ?? `This ${noun} will no longer be available to choose.`}
        confirmLabel={blockedReason ? 'Close' : `Delete ${noun}`}
        cancelLabel={blockedReason ? 'Cancel' : 'Keep it'}
        destructive={!blockedReason}
        loading={remove.isPending}
      />
    </>
  );
}

function ReferenceDialog<TRow extends ReferenceRow, TForm extends FieldValues>({
  noun,
  endpoint,
  queryKey,
  schema,
  row,
  defaultValues,
  fields,
  onClose,
}: {
  noun: string;
  endpoint: string;
  queryKey: QueryKey;
  /** Input and output types differ for schemas that coerce, e.g. money. */
  schema: ZodType<TForm, ZodTypeDef, unknown>;
  row: TRow | null;
  defaultValues: DefaultValues<TForm>;
  fields: ReferenceTableProps<TRow, TForm>['fields'];
  onClose: () => void;
}) {
  const isEdit = Boolean(row);
  const form = useForm<TForm>({ resolver: zodResolver(schema), defaultValues });

  const save = useSettingsMutation({
    mutationFn: (values: TForm) =>
      isEdit ? api.patch(`${endpoint}/${row!.id}`, values) : api.post(endpoint, values),
    invalidate: [queryKey],
    successMessage: isEdit ? `${capitalise(noun)} updated` : `${capitalise(noun)} added`,
    onSuccess: onClose,
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEdit ? `Edit ${row!.name}` : `Add ${noun}`}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={form.handleSubmit((values) => save.mutate(values))}
          >
            {isEdit ? 'Save changes' : `Add ${noun}`}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        noValidate
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
      >
        {fields(form)}
        <label className="flex items-center gap-2 pt-1 text-sub">
          <input
            type="checkbox"
            className="size-4 rounded border-line text-blue"
            {...form.register('isActive' as Path<TForm>)}
          />
          Active
        </label>
      </form>
    </Dialog>
  );
}

/** A consistent active/inactive cell for every reference table. */
export function activeColumn<TRow extends ReferenceRow>(): ColumnDef<TRow, unknown> {
  return {
    header: 'Status',
    accessorKey: 'isActive',
    cell: ({ row }) => (
      <Pill tone={row.original.isActive ? 'green' : 'gray'}>
        {row.original.isActive ? 'Active' : 'Inactive'}
      </Pill>
    ),
  };
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
