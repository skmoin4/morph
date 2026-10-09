import { describe, expect, it } from 'vitest';
import { buildPeopleCsv, escapeCsvCell, sensitiveHeadersFor } from './exportPeople';
import type { EmployeeListItem } from './usePeople';

function employee(overrides: Partial<EmployeeListItem> = {}): EmployeeListItem {
  return {
    id: 'e1',
    employeeCode: 'MOR-008',
    firstName: 'Amit',
    lastName: 'Chavan',
    fullName: 'Amit Chavan',
    workEmail: 'amit.chavan@morengineering.in',
    phone: '+91 98220 11008',
    joiningDate: '2021-11-01T00:00:00.000Z',
    status: 'ACTIVE',
    attendanceMethod: 'BOTH',
    office: { id: 'o1', name: 'Nagpur HQ', shortCode: 'NGP', timezone: 'Asia/Kolkata' },
    department: { id: 'd1', name: 'BIM Modelling' },
    designation: { id: 'g1', name: 'Senior BIM Engineer' },
    manager: { id: 'm1', firstName: 'Vikram', lastName: 'Rane' },
    user: { id: 'u1', email: 'amit.chavan@morengineering.in', status: 'ACTIVE', lastLoginAt: null },
    ...overrides,
  };
}

/**
 * The export is built from the API payload, so it inherits the server's data
 * scope and field masking rather than reimplementing them. These tests pin
 * that down: the sensitive columns are gated, and a masked payload cannot
 * produce a figure even if the gate were wrong.
 */
describe('People CSV export', () => {
  describe('field masking', () => {
    it('omits the cost and salary columns entirely without the permissions', () => {
      // What a Team Lead receives: the server already stripped these fields.
      const teamLeadRow = employee();
      delete (teamLeadRow as Partial<EmployeeListItem>).hourlyRate;
      delete (teamLeadRow as Partial<EmployeeListItem>).monthlyAmount;

      const csv = buildPeopleCsv([teamLeadRow], { includeCost: false, includeSalary: false });
      const [header, row] = csv.split('\n');

      expect(header).not.toContain('Hourly Cost Rate');
      expect(header).not.toContain('Monthly Salary');
      // Nothing resembling a rate leaks into the row either.
      expect(row).not.toContain('700');
      expect(sensitiveHeadersFor({ includeCost: false, includeSalary: false })).toEqual([]);
    });

    it('includes them for a caller holding both permissions', () => {
      const csv = buildPeopleCsv([employee({ hourlyRate: '700.00', monthlyAmount: '78000.00' })], {
        includeCost: true,
        includeSalary: true,
      });

      expect(csv).toContain('Hourly Cost Rate');
      expect(csv).toContain('700.00');
      expect(csv).toContain('78000.00');
    });

    it('gates the two permissions independently', () => {
      const row = employee({ hourlyRate: '700.00', monthlyAmount: '78000.00' });

      const costOnly = buildPeopleCsv([row], { includeCost: true, includeSalary: false });
      expect(costOnly).toContain('Hourly Cost Rate');
      expect(costOnly).not.toContain('Monthly Salary');
      expect(costOnly).not.toContain('78000.00');

      const salaryOnly = buildPeopleCsv([row], { includeCost: false, includeSalary: true });
      expect(salaryOnly).toContain('Monthly Salary');
      expect(salaryOnly).not.toContain('Hourly Cost Rate');
      expect(salaryOnly).not.toContain('700.00');
    });

    it('emits a blank cell, never a figure, when the server masked the field', () => {
      // Defence in depth: even if the permission gate were wrong, a masked
      // payload has no value to export.
      const masked = employee();
      delete (masked as Partial<EmployeeListItem>).hourlyRate;

      const csv = buildPeopleCsv([masked], { includeCost: true, includeSalary: false });
      const cells = csv.split('\n')[1].split(',');
      const headerCells = csv.split('\n')[0].split(',');
      const rateIndex = headerCells.indexOf('Hourly Cost Rate');

      expect(rateIndex).toBeGreaterThan(-1);
      expect(cells[rateIndex]).toBe('');
    });
  });

  describe('data scope', () => {
    it('exports exactly the rows it is given and never widens them', () => {
      // A Team Lead's list contains only their team; the export cannot add to it.
      const team = [
        employee({ id: 'e1', employeeCode: 'MOR-006', fullName: 'Vikram Rane' }),
        employee({ id: 'e2', employeeCode: 'MOR-008', fullName: 'Amit Chavan' }),
      ];

      const csv = buildPeopleCsv(team, { includeCost: false, includeSalary: false });
      const dataRows = csv.split('\n').slice(1);

      expect(dataRows).toHaveLength(2);
      expect(csv).toContain('MOR-006');
      expect(csv).toContain('MOR-008');
      // Someone outside the scope was never in the payload, so cannot appear.
      expect(csv).not.toContain('MOR-001');
    });

    it('produces a header-only file for an empty list', () => {
      const csv = buildPeopleCsv([], { includeCost: true, includeSalary: true });
      expect(csv.split('\n')).toHaveLength(1);
    });
  });

  describe('cell escaping', () => {
    it('quotes commas, quotes and newlines', () => {
      expect(escapeCsvCell('Patil, Sameer')).toBe('"Patil, Sameer"');
      expect(escapeCsvCell('He said "hi"')).toBe('"He said ""hi"""');
      expect(escapeCsvCell('line\nbreak')).toBe('"line\nbreak"');
      expect(escapeCsvCell('plain')).toBe('plain');
    });

    it('defuses formula injection', () => {
      // A cell starting with =, +, - or @ executes as a formula in Excel.
      expect(escapeCsvCell('=1+1')).toBe("'=1+1");
      expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
      expect(escapeCsvCell('-2+3')).toBe("'-2+3");
      expect(escapeCsvCell('+note')).toBe("'+note");
    });

    it('escapes a name containing a comma inside a built row', () => {
      const csv = buildPeopleCsv([employee({ fullName: 'Rane, Vikram' })], {
        includeCost: false,
        includeSalary: false,
      });
      expect(csv).toContain('"Rane, Vikram"');
    });
  });

  it('writes a readable header row', () => {
    const header = buildPeopleCsv([], { includeCost: false, includeSalary: false }).split('\n')[0];
    expect(header.split(',')).toEqual([
      'Employee Code',
      'Name',
      'Work Email',
      'Office',
      'Department',
      'Designation',
      'Reports To',
      'Attendance',
      'Joined',
      'Login',
      'Status',
    ]);
  });
});
