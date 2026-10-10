import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, Paperclip } from 'lucide-react';
import { CellStack, DataTable } from '../../components/ui/DataTable';
import { Pill, StatusPill } from '../../components/ui/Pill';
import { formatDisplayDate } from '../../lib/format';
import { EXPENSE_STATUS_LABEL, formatRupees, type ExpenseRow } from './useExpenses';

export function ExpenseStatusPills({ row }: { row: ExpenseRow }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <StatusPill status={row.status} label={EXPENSE_STATUS_LABEL[row.status]} />
      {row.status === 'APPROVED' && row.reimbursementStatus === 'REIMBURSED' && (
        <Pill tone="green">Paid</Pill>
      )}
      {row.status === 'APPROVED' && row.reimbursementStatus === 'PENDING' && (
        <Pill tone="amber">To pay</Pill>
      )}
    </div>
  );
}

/** Claims as a table. Each screen chooses the leading column and the actions. */
export function ExpenseTable({
  rows,
  loading,
  empty,
  showEmployee,
  select,
  actions,
  onOpen,
}: {
  rows: ExpenseRow[];
  loading: boolean;
  empty: React.ReactNode;
  showEmployee: boolean;
  /** An extra first column, for selection checkboxes. */
  select?: ColumnDef<ExpenseRow, unknown>;
  actions?: (row: ExpenseRow) => React.ReactNode;
  onOpen: (row: ExpenseRow) => void;
}) {
  const columns = useMemo<ColumnDef<ExpenseRow, unknown>[]>(
    () => [
      ...(select ? [select] : []),
      ...(showEmployee
        ? [
            {
              header: 'Employee',
              id: 'employee',
              enableSorting: false,
              meta: { className: 'w-[18%] max-w-0' },
              cell: ({ row }) => (
                <CellStack
                  title={
                    row.original.isMine
                      ? `${row.original.employee.fullName} (you)`
                      : row.original.employee.fullName
                  }
                  subtitle={`${row.original.employee.employeeCode} · ${row.original.employee.office}`}
                />
              ),
            } satisfies ColumnDef<ExpenseRow, unknown>,
          ]
        : []),
      {
        header: 'Date',
        id: 'date',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{formatDisplayDate(row.original.expenseDate)}</span>
        ),
      },
      {
        header: 'Expense',
        id: 'expense',
        enableSorting: false,
        meta: { className: 'w-[28%] max-w-0' },
        cell: ({ row }) => (
          <CellStack
            title={row.original.category.name}
            subtitle={
              [row.original.project?.projectCode, row.original.description]
                .filter(Boolean)
                .join(' · ') || undefined
            }
          />
        ),
      },
      {
        header: 'Amount',
        id: 'amount',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="whitespace-nowrap tabular-nums">
            <span className="font-heavy text-ink">{formatRupees(row.original.amount)}</span>
            <div className="mt-0.5 flex items-center gap-1.5 text-micro text-muted">
              {row.original.receipt && <Paperclip aria-label="Has a receipt" className="size-3" />}
              {row.original.isBillable ? 'Billable' : 'Non-billable'}
              {row.original.exceededLimit && (
                <span
                  className="inline-flex items-center gap-0.5 font-heavy text-amber"
                  title="Over a category limit"
                >
                  <AlertTriangle aria-hidden className="size-3" /> Over limit
                </span>
              )}
            </div>
          </div>
        ),
      },
      {
        header: 'Status',
        id: 'status',
        enableSorting: false,
        cell: ({ row }) => <ExpenseStatusPills row={row.original} />,
      },
      ...(actions
        ? [
            {
              header: '',
              id: 'actions',
              enableSorting: false,
              cell: ({ row }) => (
                <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                  {actions(row.original)}
                </div>
              ),
            } satisfies ColumnDef<ExpenseRow, unknown>,
          ]
        : []),
    ],
    // The callers rebuild `select`/`actions` as their state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showEmployee, select, actions],
  );

  return (
    <DataTable
      data={rows}
      columns={columns}
      loading={loading}
      minWidth={showEmployee ? 940 : 780}
      getRowId={(row) => row.id}
      onRowClick={onOpen}
      empty={empty}
    />
  );
}
