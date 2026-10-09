import type { ColumnDef } from '@tanstack/react-table';
import { Briefcase, Building2, IdCard, Receipt } from 'lucide-react';
import {
  departmentSchema,
  designationSchema,
  expenseCategorySchema,
  projectTypeSchema,
  type DepartmentInput,
  type DesignationInput,
  type ExpenseCategoryInput,
  type ProjectTypeInput,
} from '@opsvera/shared';
import { CellStack } from '../../components/ui/DataTable';
import { Pill } from '../../components/ui/Pill';
import { SelectField, TextField } from '../../components/ui/Field';
import { formatCurrency } from '../../lib/format';
import { ReferenceTable, activeColumn } from './ReferenceTable';
import {
  settingsKeys,
  useDepartments,
  useDesignations,
  useExpenseCategories,
  useProjectTypes,
  type Department,
  type Designation,
  type ExpenseCategory,
  type ProjectType,
} from './useSettings';

const COLOR_OPTIONS = [
  { value: 'blue', label: 'Blue' },
  { value: 'cyan', label: 'Cyan' },
  { value: 'green', label: 'Green' },
  { value: 'amber', label: 'Amber' },
  { value: 'red', label: 'Red' },
  { value: 'violet', label: 'Violet' },
];

export function DepartmentsTab({ canEdit }: { canEdit: boolean }) {
  const { data, isLoading } = useDepartments();

  const columns: ColumnDef<Department, unknown>[] = [
    {
      header: 'Department',
      accessorKey: 'name',
      cell: ({ row }) => (
        <CellStack title={row.original.name} subtitle={row.original.shortCode ?? undefined} />
      ),
    },
    {
      header: 'People',
      accessorKey: 'id',
      cell: ({ row }) => <span className="tabular-nums">{row.original._count.employees}</span>,
    },
    {
      header: 'Designations',
      id: 'designations',
      cell: ({ row }) => <span className="tabular-nums">{row.original._count.designations}</span>,
    },
    activeColumn<Department>(),
  ];

  return (
    <ReferenceTable<Department, DepartmentInput>
      title="Departments"
      subtitle="The teams employees belong to."
      noun="department"
      endpoint="/settings/departments"
      queryKey={settingsKeys.departments}
      rows={data?.data ?? []}
      loading={isLoading}
      canEdit={canEdit}
      columns={columns}
      schema={departmentSchema}
      emptyIcon={<Building2 />}
      defaultValues={{ name: '', shortCode: '', isActive: true }}
      toFormValues={(row) => ({
        name: row.name,
        shortCode: row.shortCode ?? '',
        isActive: row.isActive,
      })}
      deleteBlockedReason={(row) =>
        row._count.employees > 0
          ? `${row._count.employees} employees are in this department. Move them first, or deactivate it instead.`
          : null
      }
      fields={(form) => (
        <>
          <TextField
            label="Name"
            required
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />
          <TextField
            label="Short code"
            hint="Optional, used in compact views."
            error={form.formState.errors.shortCode?.message}
            {...form.register('shortCode')}
          />
        </>
      )}
    />
  );
}

export function DesignationsTab({ canEdit }: { canEdit: boolean }) {
  const { data, isLoading } = useDesignations();
  const { data: departments } = useDepartments();

  const columns: ColumnDef<Designation, unknown>[] = [
    {
      header: 'Designation',
      accessorKey: 'name',
      cell: ({ row }) => (
        <CellStack
          title={row.original.name}
          subtitle={row.original.department?.name ?? 'All departments'}
        />
      ),
    },
    {
      header: 'Level',
      accessorKey: 'level',
      cell: ({ row }) =>
        row.original.level ? (
          <Pill tone="blue" dot={false}>
            L{row.original.level}
          </Pill>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      header: 'People',
      id: 'people',
      cell: ({ row }) => <span className="tabular-nums">{row.original._count.employees}</span>,
    },
    activeColumn<Designation>(),
  ];

  return (
    <ReferenceTable<Designation, DesignationInput>
      title="Designations"
      subtitle="Job titles, optionally scoped to a department."
      noun="designation"
      endpoint="/settings/designations"
      queryKey={settingsKeys.designations}
      rows={data?.data ?? []}
      loading={isLoading}
      canEdit={canEdit}
      columns={columns}
      schema={designationSchema}
      emptyIcon={<IdCard />}
      defaultValues={{ name: '', departmentId: null, level: null, isActive: true }}
      toFormValues={(row) => ({
        name: row.name,
        departmentId: row.departmentId,
        level: row.level,
        isActive: row.isActive,
      })}
      deleteBlockedReason={(row) =>
        row._count.employees > 0
          ? `${row._count.employees} employees hold this designation. Deactivate it instead.`
          : null
      }
      fields={(form) => (
        <>
          <TextField
            label="Name"
            required
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />
          <SelectField
            label="Department"
            placeholder="All departments"
            options={(departments?.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
            error={form.formState.errors.departmentId?.message}
            {...form.register('departmentId')}
          />
          <TextField
            label="Seniority level"
            type="number"
            hint="1 is most senior. Optional."
            error={form.formState.errors.level?.message}
            {...form.register('level')}
          />
        </>
      )}
    />
  );
}

export function ProjectTypesTab({ canEdit }: { canEdit: boolean }) {
  const { data, isLoading } = useProjectTypes();

  const columns: ColumnDef<ProjectType, unknown>[] = [
    {
      header: 'Project type',
      accessorKey: 'name',
      cell: ({ row }) => <CellStack title={row.original.name} />,
    },
    {
      header: 'Short code',
      accessorKey: 'shortCode',
      cell: ({ row }) => (
        <Pill
          tone={(row.original.colorToken as 'blue' | undefined) ?? 'blue'}
          dot={false}
          className="font-mono"
        >
          {row.original.shortCode}
        </Pill>
      ),
    },
    {
      header: 'In use',
      id: 'usage',
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sub text-muted">
          {row.original._count.bookings} bookings · {row.original._count.projects} projects
        </span>
      ),
    },
    activeColumn<ProjectType>(),
  ];

  return (
    <ReferenceTable<ProjectType, ProjectTypeInput>
      title="Project types"
      subtitle="The short code goes straight into every project code, so it is fixed once a project exists."
      noun="project type"
      endpoint="/settings/project-types"
      queryKey={settingsKeys.projectTypes}
      rows={data?.data ?? []}
      loading={isLoading}
      canEdit={canEdit}
      columns={columns}
      schema={projectTypeSchema}
      emptyIcon={<Briefcase />}
      defaultValues={{ name: '', shortCode: '', colorToken: 'blue', isActive: true }}
      toFormValues={(row) => ({
        name: row.name,
        shortCode: row.shortCode,
        colorToken: (row.colorToken as ProjectTypeInput['colorToken']) ?? 'blue',
        isActive: row.isActive,
      })}
      deleteBlockedReason={(row) =>
        row._count.projects > 0 || row._count.bookings > 0
          ? `This type is used by ${row._count.bookings} bookings and ${row._count.projects} projects. Deactivate it instead.`
          : null
      }
      fields={(form) => (
        <>
          <TextField
            label="Name"
            required
            placeholder="Hospital"
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />
          <TextField
            label="Short code"
            required
            placeholder="HOS"
            hint="Appears inside project codes, e.g. MOR-26-27-HOS-0043. It cannot be changed once a project uses it."
            error={form.formState.errors.shortCode?.message}
            {...form.register('shortCode')}
          />
          <SelectField
            label="Colour"
            options={COLOR_OPTIONS}
            error={form.formState.errors.colorToken?.message}
            {...form.register('colorToken')}
          />
        </>
      )}
    />
  );
}

export function ExpenseCategoriesTab({ canEdit }: { canEdit: boolean }) {
  const { data, isLoading } = useExpenseCategories();

  const columns: ColumnDef<ExpenseCategory, unknown>[] = [
    {
      header: 'Category',
      accessorKey: 'name',
      cell: ({ row }) => (
        <CellStack title={row.original.name} subtitle={row.original.shortCode ?? undefined} />
      ),
    },
    {
      header: 'Per claim limit',
      accessorKey: 'perClaimLimit',
      cell: ({ row }) => (
        <span className="whitespace-nowrap tabular-nums">
          {row.original.perClaimLimit ? formatCurrency(row.original.perClaimLimit) : '—'}
        </span>
      ),
    },
    {
      header: 'Receipt',
      accessorKey: 'requiresReceipt',
      cell: ({ row }) => (
        <Pill tone={row.original.requiresReceipt ? 'amber' : 'gray'} dot={false}>
          {row.original.requiresReceipt ? 'Required' : 'Optional'}
        </Pill>
      ),
    },
    {
      header: 'Claims',
      id: 'claims',
      cell: ({ row }) => <span className="tabular-nums">{row.original._count.expenses}</span>,
    },
    activeColumn<ExpenseCategory>(),
  ];

  return (
    <ReferenceTable<ExpenseCategory, ExpenseCategoryInput>
      title="Expense categories"
      subtitle="Limits are a warning, not a block — a claim over the limit is flagged for Finance."
      noun="category"
      endpoint="/settings/expense-categories"
      queryKey={settingsKeys.expenseCategories}
      rows={data?.data ?? []}
      loading={isLoading}
      canEdit={canEdit}
      columns={columns}
      schema={expenseCategorySchema}
      emptyIcon={<Receipt />}
      defaultValues={{
        name: '',
        shortCode: '',
        perClaimLimit: null,
        perMonthLimit: null,
        requiresReceipt: true,
        isActive: true,
      }}
      toFormValues={(row) => ({
        name: row.name,
        shortCode: row.shortCode ?? '',
        perClaimLimit: row.perClaimLimit,
        perMonthLimit: row.perMonthLimit,
        requiresReceipt: row.requiresReceipt,
        isActive: row.isActive,
      })}
      deleteBlockedReason={(row) =>
        row._count.expenses > 0
          ? `${row._count.expenses} expenses use this category. Deactivate it instead.`
          : null
      }
      fields={(form) => (
        <>
          <TextField
            label="Name"
            required
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />
          <TextField label="Short code" {...form.register('shortCode')} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Per claim limit"
              hint="Leave blank for no limit."
              error={form.formState.errors.perClaimLimit?.message}
              {...form.register('perClaimLimit')}
            />
            <TextField
              label="Per month limit"
              error={form.formState.errors.perMonthLimit?.message}
              {...form.register('perMonthLimit')}
            />
          </div>
          <label className="flex items-center gap-2 text-sub">
            <input
              type="checkbox"
              className="size-4 rounded border-line text-blue"
              {...form.register('requiresReceipt')}
            />
            Receipt required
          </label>
        </>
      )}
    />
  );
}
