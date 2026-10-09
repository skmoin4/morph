import { api } from '../../lib/api';
import type { Paginated } from '../settings/useSettings';
import type { EmployeeListItem, PeopleFilters } from './usePeople';

export const ATTENDANCE_METHOD_LABEL: Record<string, string> = {
  MOBILE: 'Mobile',
  OFFICE: 'Office',
  BOTH: 'Mobile + Office',
};

/**
 * Columns that carry sensitive figures. They are only ever emitted when the
 * caller holds the matching permission — and even then the value can only come
 * from the API payload, which the server has already masked.
 */
const SENSITIVE_HEADERS = ['Hourly Cost Rate', 'Monthly Salary'] as const;

export interface CsvOptions {
  /** `cost.view` — adds the hourly rate column. */
  includeCost: boolean;
  /** `salary.view` — adds the monthly salary column. */
  includeSalary: boolean;
}

/**
 * Builds the People CSV.
 *
 * Both protections are inherited rather than reimplemented:
 *
 *   * **Data scope** — the rows are exactly what `GET /employees` returned, and
 *     that list is already filtered to the caller's scope by the server. The
 *     export never fetches anything wider.
 *   * **Field masking** — the sensitive columns are gated on the same
 *     permissions the server uses, and the values can only come from fields the
 *     server chose to send. A masked field is absent from the payload, so even
 *     a mistake in the gate below could only ever produce a blank cell, never a
 *     real figure.
 */
export function buildPeopleCsv(rows: EmployeeListItem[], options: CsvOptions): string {
  const headers = [
    'Employee Code',
    'Name',
    'Work Email',
    'Office',
    'Department',
    'Designation',
    'Reports To',
    'Attendance',
    'Joined',
    ...(options.includeCost ? ['Hourly Cost Rate'] : []),
    ...(options.includeSalary ? ['Monthly Salary'] : []),
    'Login',
    'Status',
  ];

  const lines = rows.map((row) =>
    [
      row.employeeCode,
      row.fullName,
      row.workEmail ?? '',
      row.office.name,
      row.department?.name ?? '',
      row.designation?.name ?? '',
      row.manager ? `${row.manager.firstName} ${row.manager.lastName}` : '',
      ATTENDANCE_METHOD_LABEL[row.attendanceMethod] ?? row.attendanceMethod,
      row.joiningDate.slice(0, 10),
      ...(options.includeCost ? [row.hourlyRate ?? ''] : []),
      ...(options.includeSalary ? [row.monthlyAmount ?? ''] : []),
      row.user ? row.user.status : 'No login',
      row.status,
    ]
      .map(escapeCsvCell)
      .join(','),
  );

  return [headers.join(','), ...lines].join('\n');
}

/** Returns the sensitive headers a given options set would emit. */
export function sensitiveHeadersFor(options: CsvOptions): string[] {
  return SENSITIVE_HEADERS.filter(
    (header) =>
      (header === 'Hourly Cost Rate' && options.includeCost) ||
      (header === 'Monthly Salary' && options.includeSalary),
  );
}

/**
 * Quotes a cell when it contains a comma, quote or newline.
 *
 * The leading apostrophe guards against CSV injection: a cell starting with
 * =, +, - or @ is executed as a formula when the file is opened in Excel.
 */
export function escapeCsvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadCsv(filename: string, contents: string): void {
  // The BOM makes Excel open UTF-8 correctly, which matters for the ₹ sign.
  const blob = new Blob([`\uFEFF${contents}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** The API caps a page at 200, so a full export pages through. */
const MAX_PAGE_SIZE = 200;
/** A safety stop; 20 pages is 4,000 people. */
const MAX_PAGES = 20;

/**
 * Fetches every row matching the current filters, not just the page on screen.
 *
 * Each page comes from the same scoped, masked endpoint the table uses, so a
 * full export can never reach wider than the list it was started from.
 */
export async function fetchAllForExport(filters: PeopleFilters): Promise<EmployeeListItem[]> {
  const all: EmployeeListItem[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await api.get<Paginated<EmployeeListItem>>('/employees', {
      q: filters.q,
      officeId: filters.officeId,
      departmentId: filters.departmentId,
      status: filters.status,
      sort: filters.sort,
      page,
      pageSize: MAX_PAGE_SIZE,
    });

    all.push(...response.data);
    if (page >= response.meta.totalPages) break;
  }

  return all;
}
