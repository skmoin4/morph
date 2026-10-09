import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  IMPORT_COLUMNS,
  type ImportEmployeesInput,
  type ImportResult,
  type ImportRow,
  type ImportRowError,
} from '@opsvera/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';

const VALID_ATTENDANCE = new Set(['MOBILE', 'OFFICE', 'BOTH']);

/**
 * Bulk employee import.
 *
 * Two deliberate properties:
 *   1. **Dry run first.** The UI validates the whole sheet and shows a
 *      row-level error report before anything is written.
 *   2. **All or nothing.** The real run is a single transaction, so a sheet
 *      that fails halfway does not leave a half-imported org.
 */
@Injectable()
export class EmployeeImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The downloadable template, with headers, an example row and notes. */
  async buildTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'OPSVERA';
    const sheet = workbook.addWorksheet('Employees');

    sheet.columns = IMPORT_COLUMNS.map((column) => ({
      header: column.header + (column.required ? ' *' : ''),
      key: column.key,
      width: Math.max(16, column.header.length + 6),
    }));

    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1526' } };
    header.alignment = { vertical: 'middle' };
    header.height = 22;

    // Deliberately no example row in the data sheet. An example here would have
    // to be skipped on upload, and any heuristic for "is this the example?"
    // silently drops a real employee who happens to match it. The example
    // values live on the Notes sheet instead, where they cannot be imported.

    const notes = workbook.addWorksheet('Notes');
    notes.columns = [
      { header: 'Column', key: 'column', width: 24 },
      { header: 'Required', key: 'required', width: 12 },
      { header: 'Example', key: 'example', width: 26 },
      { header: 'What to enter', key: 'note', width: 72 },
    ];
    notes.getRow(1).font = { bold: true };

    const guidance: Record<string, string> = {
      employeeCode: 'Unique per company. Letters, numbers, dashes and slashes.',
      joiningDate: 'YYYY-MM-DD, e.g. 2026-10-01.',
      office: 'The office SHORT CODE (not its name), e.g. NGP, NSK, MUM, RUH.',
      department: 'Must match an existing department name exactly. Leave blank if none.',
      designation: 'Must match an existing designation name exactly. Leave blank if none.',
      managerCode: "The manager's employee code. They may be elsewhere in this same sheet.",
      attendanceMethod: 'MOBILE, OFFICE or BOTH. Defaults to BOTH when blank.',
      hourlyRate: 'Opening cost rate, effective from the joining date. Numbers only.',
      monthlySalary: 'Opening monthly salary, effective from the joining date.',
      workEmail: 'Needed later to send a login invitation. Must be unique across all companies.',
    };

    for (const column of IMPORT_COLUMNS) {
      notes.addRow({
        column: column.header,
        required: column.required ? 'Yes' : 'No',
        example: column.example,
        note: guidance[column.key] ?? '',
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /** Reads an uploaded sheet into rows, without validating business rules. */
  async parse(file: Buffer): Promise<ImportRow[]> {
    const workbook = new ExcelJS.Workbook();
    // ExcelJS declares its own Buffer alias; Node's Buffer is compatible at
    // runtime but not structurally, hence the cast.
    await workbook.xlsx.load(file as unknown as ExcelJS.Buffer);

    const sheet = workbook.getWorksheet('Employees') ?? workbook.worksheets[0];
    if (!sheet) return [];

    // Map by header text so column order in the uploaded file does not matter.
    const headerRow = sheet.getRow(1);
    const columnByIndex = new Map<number, string>();
    headerRow.eachCell((cell, index) => {
      const text = String(cell.value ?? '')
        .replace(/\*/g, '')
        .trim()
        .toLowerCase();
      const match = IMPORT_COLUMNS.find((c) => c.header.toLowerCase() === text);
      if (match) columnByIndex.set(index, match.key);
    });

    const rows: ImportRow[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const record: Record<string, string> = {};
      columnByIndex.forEach((key, index) => {
        record[key] = cellToString(row.getCell(index).value);
      });

      // Only entirely blank lines are skipped. Never skip by content: a row
      // that looks like a sample is indistinguishable from a real employee,
      // and dropping it silently would lose a person with no error shown.
      const hasData = Object.values(record).some((v) => v !== '');
      if (!hasData) return;

      rows.push({ rowNumber, ...emptyRow(), ...record } as ImportRow);
    });

    return rows;
  }

  /**
   * Validates every row and, unless this is a dry run, writes them all in one
   * transaction.
   */
  async import(input: ImportEmployeesInput, user: AuthenticatedUser): Promise<ImportResult> {
    const errors: ImportRowError[] = [];

    const [offices, departments, designations, existing] = await Promise.all([
      this.prisma.scoped.office.findMany({
        where: { deletedAt: null },
        select: { id: true, shortCode: true, name: true },
      }),
      this.prisma.scoped.department.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true },
      }),
      this.prisma.scoped.designation.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true },
      }),
      this.prisma.scoped.employee.findMany({
        where: { deletedAt: null },
        select: { id: true, employeeCode: true },
      }),
    ]);

    const officeByCode = new Map(offices.map((o) => [o.shortCode.toUpperCase(), o.id]));
    const departmentByName = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]));
    const designationByName = new Map(designations.map((d) => [d.name.toLowerCase(), d.id]));
    const existingCodes = new Map(existing.map((e) => [e.employeeCode.toUpperCase(), e.id]));

    const seenInSheet = new Map<string, number>();
    const prepared: Array<{
      row: ImportRow;
      data: Record<string, unknown>;
      managerCode: string;
      hourlyRate: string;
      monthlySalary: string;
    }> = [];

    for (const row of input.rows) {
      const code = row.employeeCode.toUpperCase();
      const add = (field: string, message: string) =>
        errors.push({ rowNumber: row.rowNumber, employeeCode: row.employeeCode, field, message });

      if (!row.employeeCode) add('employeeCode', 'Employee code is required');
      if (!row.firstName) add('firstName', 'First name is required');
      if (!row.lastName) add('lastName', 'Last name is required');

      if (code && existingCodes.has(code)) {
        add('employeeCode', `${row.employeeCode} already exists`);
      }
      if (code && seenInSheet.has(code)) {
        add('employeeCode', `Duplicated in this sheet (also row ${seenInSheet.get(code)})`);
      }
      if (code) seenInSheet.set(code, row.rowNumber);

      const joiningDate = normaliseDate(row.joiningDate);
      if (!row.joiningDate) add('joiningDate', 'Joining date is required');
      else if (!joiningDate)
        add('joiningDate', `"${row.joiningDate}" is not a date (use YYYY-MM-DD)`);

      const officeId = officeByCode.get(row.office.toUpperCase());
      if (!row.office) add('office', 'Office code is required');
      else if (!officeId) {
        add(
          'office',
          `No office with code "${row.office}". Known codes: ${offices.map((o) => o.shortCode).join(', ')}`,
        );
      }

      let departmentId: string | null = null;
      if (row.department) {
        departmentId = departmentByName.get(row.department.toLowerCase()) ?? null;
        if (!departmentId) add('department', `No department named "${row.department}"`);
      }

      let designationId: string | null = null;
      if (row.designation) {
        designationId = designationByName.get(row.designation.toLowerCase()) ?? null;
        if (!designationId) add('designation', `No designation named "${row.designation}"`);
      }

      const attendanceMethod = row.attendanceMethod ? row.attendanceMethod.toUpperCase() : 'BOTH';
      if (!VALID_ATTENDANCE.has(attendanceMethod)) {
        add('attendanceMethod', `Must be MOBILE, OFFICE or BOTH — got "${row.attendanceMethod}"`);
      }

      if (row.workEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.workEmail)) {
        add('workEmail', `"${row.workEmail}" is not a valid email`);
      }
      if (row.hourlyRate && !isMoney(row.hourlyRate)) {
        add('hourlyRate', `"${row.hourlyRate}" is not a number`);
      }
      if (row.monthlySalary && !isMoney(row.monthlySalary)) {
        add('monthlySalary', `"${row.monthlySalary}" is not a number`);
      }

      prepared.push({
        row,
        managerCode: row.managerCode.toUpperCase(),
        hourlyRate: row.hourlyRate,
        monthlySalary: row.monthlySalary,
        data: {
          employeeCode: code,
          firstName: row.firstName,
          lastName: row.lastName,
          workEmail: row.workEmail || null,
          phone: row.phone || null,
          joiningDate: joiningDate ? new Date(`${joiningDate}T00:00:00.000Z`) : null,
          officeId: officeId ?? null,
          departmentId,
          designationId,
          attendanceMethod,
          status: 'ACTIVE',
          createdById: user.userId,
        },
      });
    }

    // A manager may appear later in the same sheet, so this is checked only
    // after every code in the file is known.
    for (const entry of prepared) {
      if (!entry.managerCode) continue;
      if (!existingCodes.has(entry.managerCode) && !seenInSheet.has(entry.managerCode)) {
        errors.push({
          rowNumber: entry.row.rowNumber,
          employeeCode: entry.row.employeeCode,
          field: 'managerCode',
          message: `No employee with code "${entry.managerCode}" exists or appears in this sheet`,
        });
      }
    }

    const result: ImportResult = {
      dryRun: input.dryRun,
      totalRows: input.rows.length,
      valid: input.rows.length - new Set(errors.map((e) => e.rowNumber)).size,
      created: 0,
      errors: errors.sort((a, b) => a.rowNumber - b.rowNumber),
    };

    // Nothing is written unless the whole sheet is clean.
    if (input.dryRun || errors.length > 0) return result;

    await this.prisma.scoped.$transaction(async (tx) => {
      const idByCode = new Map(existingCodes);

      for (const entry of prepared) {
        const created = await tx.employee.create({ data: entry.data as never });
        idByCode.set(entry.data.employeeCode as string, created.id);

        if (entry.hourlyRate) {
          await tx.employeeCostRate.create({
            data: {
              employeeId: created.id,
              hourlyRate: Number(entry.hourlyRate).toFixed(2),
              effectiveFrom: entry.data.joiningDate as Date,
              note: 'Imported',
              createdById: user.userId,
            } as never,
          });
        }
        if (entry.monthlySalary) {
          await tx.employeeSalary.create({
            data: {
              employeeId: created.id,
              monthlyAmount: Number(entry.monthlySalary).toFixed(2),
              effectiveFrom: entry.data.joiningDate as Date,
              note: 'Imported',
              createdById: user.userId,
            } as never,
          });
        }
      }

      // Second pass for reporting lines, now that every row has an id.
      for (const entry of prepared) {
        if (!entry.managerCode) continue;
        const managerId = idByCode.get(entry.managerCode);
        const employeeId = idByCode.get(entry.data.employeeCode as string);
        if (managerId && employeeId && managerId !== employeeId) {
          await tx.employee.update({ where: { id: employeeId }, data: { managerId } });
        }
      }

      await this.audit.record(
        {
          action: 'CREATE',
          entityType: 'Employee',
          summary: `Imported ${prepared.length} employees from a spreadsheet`,
          after: { codes: prepared.map((p) => p.data.employeeCode) },
          userId: user.userId,
        },
        tx,
      );
    });

    result.created = prepared.length;
    return result;
  }
}

function emptyRow() {
  return {
    employeeCode: '',
    firstName: '',
    lastName: '',
    workEmail: '',
    phone: '',
    joiningDate: '',
    office: '',
    department: '',
    designation: '',
    managerCode: '',
    attendanceMethod: '',
    hourlyRate: '',
    monthlySalary: '',
  };
}

/** Excel cells arrive as strings, numbers, dates, formulas or rich text. */
function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('text' in value) return String(value.text).trim();
    if ('result' in value) return String(value.result ?? '').trim();
    if ('richText' in value) {
      return value.richText
        .map((part) => part.text)
        .join('')
        .trim();
    }
    return '';
  }
  return String(value).trim();
}

/** Accepts YYYY-MM-DD, DD/MM/YYYY and DD-MM-YYYY. */
function normaliseDate(value: string): string | null {
  if (!value) return null;

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return isRealDate(+iso[1], +iso[2], +iso[3]) ? value : null;

  const dmy = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, day, month, year] = dmy;
    if (!isRealDate(+year, +month, +day)) return null;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return null;
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isMoney(value: string): boolean {
  return /^\d{1,13}(\.\d{1,2})?$/.test(value.replace(/,/g, ''));
}
