import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { toOfficeTimeString, type RegisterQuery } from '@opsvera/shared';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AttendanceService } from './attendance.service';

/** One-letter codes for the register grid, as HR sheets conventionally use. */
const CODE: Record<string, string> = {
  PRESENT: 'P',
  LATE: 'L',
  HALF_DAY: 'H',
  ABSENT: 'A',
  ON_LEAVE: 'LV',
  HOLIDAY: 'HO',
  WEEKLY_OFF: 'WO',
  NOT_IN: '',
};

const FILL: Record<string, string> = {
  P: 'FFEAF8F1',
  L: 'FFFFF4E7',
  H: 'FFFFF4E7',
  A: 'FFFDEBEC',
  LV: 'FFEEF3FF',
  HO: 'FFEEF1F5',
  WO: 'FFEEF1F5',
};

/**
 * The register as a workbook. Built from the same payload the screen shows, so
 * the export cannot disagree with it — and it inherits the screen's data scope,
 * because it asks the same service for the rows.
 */
@Injectable()
export class AttendanceExportService {
  constructor(private readonly attendance: AttendanceService) {}

  async build(query: RegisterQuery, user: AuthenticatedUser) {
    // Every page of the filtered set, not just the one on screen.
    const rows: Awaited<ReturnType<AttendanceService['register']>>['data'] = [];
    let days: string[] = [];
    for (let page = 1; ; page += 1) {
      const result = await this.attendance.register({ ...query, page, pageSize: 100 }, user);
      days = result.days;
      rows.push(...result.data);
      if (page >= result.meta.totalPages) break;
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'OPSVERA';
    workbook.created = new Date();

    // --- Register grid -------------------------------------------------------
    const grid = workbook.addWorksheet('Register', {
      views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }],
    });
    grid.columns = [
      { header: 'Code', key: 'code', width: 12 },
      { header: 'Employee', key: 'name', width: 26 },
      { header: 'Office', key: 'office', width: 9 },
      ...days.map((date) => ({ header: String(Number(date.slice(8))), key: date, width: 4.5 })),
      { header: 'Present', key: 'present', width: 9 },
      { header: 'Late', key: 'late', width: 7 },
      { header: 'Half', key: 'half', width: 7 },
      { header: 'Absent', key: 'absent', width: 8 },
      { header: 'Leave', key: 'leave', width: 7 },
      { header: 'Week off', key: 'wo', width: 9 },
      { header: 'Holiday', key: 'ho', width: 8 },
      { header: 'Overtime (h)', key: 'ot', width: 12 },
      { header: 'Credited days', key: 'credit', width: 13 },
    ];
    grid.getRow(1).font = { bold: true };

    for (const row of rows) {
      const record: Record<string, unknown> = {
        code: row.employeeCode,
        name: row.fullName,
        office: row.office.shortCode,
        present: row.totals.present + row.totals.late,
        late: row.totals.late,
        half: row.totals.halfDay,
        absent: row.totals.absent,
        leave: row.totals.onLeave,
        wo: row.totals.weeklyOff,
        ho: row.totals.holiday,
        ot: Math.round((row.totals.overtimeMinutes / 60) * 10) / 10,
        credit: row.totals.creditedDays,
      };
      for (const cell of row.days) record[cell.date] = cell.status ? (CODE[cell.status] ?? '') : '';
      const added = grid.addRow(record);
      for (const cell of row.days) {
        const code = cell.status ? CODE[cell.status] : '';
        const fill = FILL[code];
        if (fill) {
          added.getCell(cell.date).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: fill },
          };
        }
        added.getCell(cell.date).alignment = { horizontal: 'center' };
      }
    }

    grid.addRow([]);
    grid.addRow([
      'P present · L late · H half day · A absent · LV leave · WO weekly off · HO holiday',
    ]);

    // --- Day-by-day detail ---------------------------------------------------
    const detail = workbook.addWorksheet('Daily detail', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    detail.columns = [
      { header: 'Code', key: 'code', width: 12 },
      { header: 'Employee', key: 'name', width: 26 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'In', key: 'in', width: 8 },
      { header: 'Out', key: 'out', width: 8 },
      { header: 'Paid hours', key: 'worked', width: 11 },
      { header: 'Late (min)', key: 'late', width: 10 },
      { header: 'Overtime (min)', key: 'ot', width: 14 },
      { header: 'Day credit', key: 'credit', width: 10 },
      { header: 'Regularised', key: 'reg', width: 12 },
      { header: 'Flagged', key: 'flag', width: 8 },
    ];
    detail.getRow(1).font = { bold: true };

    for (const row of rows) {
      const tz = row.office.timezone;
      for (const cell of row.days) {
        if (!cell.status) continue;
        detail.addRow({
          code: row.employeeCode,
          name: row.fullName,
          date: cell.date,
          status: cell.status.replace('_', ' ').toLowerCase(),
          in: cell.firstInAt ? toOfficeTimeString(cell.firstInAt, tz) : '',
          out: cell.lastOutAt ? toOfficeTimeString(cell.lastOutAt, tz) : '',
          worked:
            cell.workedMinutes === undefined
              ? ''
              : Math.round((cell.workedMinutes / 60) * 100) / 100,
          late: cell.isLate ? cell.lateMinutes : '',
          ot: cell.overtimeMinutes || '',
          credit: cell.final ? cell.dayValue : '',
          reg: cell.regularised ? 'yes' : '',
          flag: cell.flagged ? 'yes' : '',
        });
      }
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { buffer, fileName: `attendance-${query.month}.xlsx` };
  }
}
