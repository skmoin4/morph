import { useMemo, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../lib/cn';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';

/** Per-column styling, set through a column's `meta`. */
export interface ColumnMeta {
  className?: string;
}

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  loading?: boolean;
  /** Rendered in place of the table body when there is nothing to show. */
  empty?: ReactNode;
  /** Makes rows clickable — typically opens a detail drawer or 360 page. */
  onRowClick?: (row: T) => void;
  /** Server-side sorting: the table only reports intent, it never re-sorts. */
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  getRowId?: (row: T, index: number) => string;
  /** Minimum width before the table scrolls horizontally. */
  minWidth?: number;
  className?: string;
  /** Rows to show while loading. */
  skeletonRows?: number;
}

export function DataTable<T>({
  data,
  columns,
  loading = false,
  empty,
  onRowClick,
  sorting,
  onSortingChange,
  getRowId,
  minWidth = 720,
  className,
  skeletonRows = 6,
}: DataTableProps<T>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
    state: sorting ? { sorting } : undefined,
    onSortingChange,
    manualSorting: true,
    enableSortingRemoval: false,
  });

  const columnCount = columns.length;
  const skeleton = useMemo(() => Array.from({ length: skeletonRows }, (_, i) => i), [skeletonRows]);

  if (!loading && data.length === 0) {
    return (
      <div className="px-4 py-10">
        {empty ?? <EmptyState title="Nothing here yet" description="No records match this view." />}
      </div>
    );
  }

  return (
    <div className={cn('scroll-slim overflow-auto', className)}>
      <table className="w-full border-collapse" style={{ minWidth }}>
        <thead className="sticky top-0 z-10 bg-surface">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sortable = header.column.getCanSort();
                const direction = header.column.getIsSorted();

                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={
                      direction === 'asc'
                        ? 'ascending'
                        : direction === 'desc'
                          ? 'descending'
                          : sortable
                            ? 'none'
                            : undefined
                    }
                    className={cn(
                      'whitespace-nowrap border-b border-line px-2 py-2.5 text-left text-micro font-heavy uppercase text-[#7d8a9f]',
                      (header.column.columnDef.meta as ColumnMeta | undefined)?.className,
                    )}
                  >
                    {header.isPlaceholder ? null : sortable ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 rounded transition-colors hover:text-ink-2"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {direction === 'asc' ? (
                          <ArrowUp aria-hidden className="size-3" />
                        ) : direction === 'desc' ? (
                          <ArrowDown aria-hidden className="size-3" />
                        ) : (
                          <ChevronsUpDown aria-hidden className="size-3 opacity-40" />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>

        <tbody>
          {loading
            ? skeleton.map((i) => (
                <tr key={i}>
                  {Array.from({ length: columnCount }, (_, c) => (
                    <td key={c} className="border-b border-line-soft px-2 py-3">
                      <Skeleton className="h-3.5 w-full max-w-[140px]" />
                    </td>
                  ))}
                </tr>
              ))
            : table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  // Clickable rows need to be reachable without a mouse.
                  tabIndex={onRowClick ? 0 : undefined}
                  role={onRowClick ? 'button' : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onRowClick(row.original);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    'border-b border-line-soft last:border-b-0',
                    onRowClick &&
                      'cursor-pointer transition-colors hover:bg-[#f8fbff] focus-visible:bg-[#f8fbff]',
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={cn(
                        'px-2 py-3 align-middle text-body',
                        (cell.column.columnDef.meta as ColumnMeta | undefined)?.className,
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

/** The two-line "name over subtitle" cell used throughout the tables. */
export function CellStack({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-body font-heavy text-ink">{title}</div>
      {subtitle && <div className="mt-0.5 truncate text-sub text-muted">{subtitle}</div>}
    </div>
  );
}

/** Right-aligns a numeric column and keeps the digits aligned. */
export function CellNumber({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('whitespace-nowrap text-right font-heavy tabular-nums', className)}>
      {children}
    </div>
  );
}
