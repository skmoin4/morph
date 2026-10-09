// Dev helper: writes a sample employee-import .xlsx (valid or deliberately broken rows).
// Usage: node scripts/make-import-sheet.mjs <out.xlsx> <mode>
import ExcelJS from 'exceljs';
const out = process.argv[2];
const mode = process.argv[3];

const wb = new ExcelJS.Workbook();
const sheet = wb.addWorksheet('Employees');
sheet.columns = [
  { header: 'Employee Code *', key: 'employeeCode' },
  { header: 'First Name *', key: 'firstName' },
  { header: 'Last Name *', key: 'lastName' },
  { header: 'Work Email', key: 'workEmail' },
  { header: 'Phone', key: 'phone' },
  { header: 'Joining Date *', key: 'joiningDate' },
  { header: 'Office Code *', key: 'office' },
  { header: 'Department', key: 'department' },
  { header: 'Designation', key: 'designation' },
  { header: 'Manager Code', key: 'managerCode' },
  { header: 'Attendance Method', key: 'attendanceMethod' },
  { header: 'Hourly Cost Rate', key: 'hourlyRate' },
  { header: 'Monthly Salary', key: 'monthlySalary' },
];

const bad = [
  // row 2: duplicate of an existing employee code
  { employeeCode: 'MOR-001', firstName: 'Clash', lastName: 'Person', joiningDate: '2026-10-01', office: 'NGP' },
  // row 3: unknown office, bad date, bad attendance method, non-numeric rate
  { employeeCode: 'MOR-011', firstName: 'Anita', lastName: 'Deshpande', joiningDate: '31/02/2026', office: 'XXX', attendanceMethod: 'CARRIER PIGEON', hourlyRate: 'six hundred' },
  // row 4: missing required names, unknown department, unknown manager
  { employeeCode: 'MOR-012', firstName: '', lastName: '', joiningDate: '2026-10-01', office: 'NGP', department: 'Department of Mystery', managerCode: 'MOR-999' },
  // row 5: duplicated within this same sheet + bad email
  { employeeCode: 'MOR-012', firstName: 'Dupe', lastName: 'Row', joiningDate: '2026-10-01', office: 'NGP', workEmail: 'not-an-email' },
];

const good = [
  // Manager appears LATER in the sheet — must still resolve.
  { employeeCode: 'MOR-011', firstName: 'Anita', lastName: 'Deshpande', workEmail: 'anita.deshpande@morengineering.in',
    joiningDate: '2026-10-01', office: 'NGP', department: 'BIM Modelling', designation: 'BIM Engineer',
    managerCode: 'MOR-013', attendanceMethod: 'BOTH', hourlyRate: '620.00', monthlySalary: '68000.00' },
  { employeeCode: 'MOR-012', firstName: 'Rahul', lastName: 'Kamble', joiningDate: '01/10/2026',
    office: 'NSK', department: 'MEP Design', designation: 'MEP Design Engineer',
    managerCode: 'MOR-007', attendanceMethod: 'OFFICE', hourlyRate: '610.00' },
  { employeeCode: 'MOR-013', firstName: 'Sana', lastName: 'Qureshi', joiningDate: '2026-09-15',
    office: 'RUH', department: 'BIM Modelling', designation: 'Team Lead', attendanceMethod: 'BOTH', hourlyRate: '880.00' },
];

for (const row of (mode === 'bad' ? bad : good)) sheet.addRow(row);
await wb.xlsx.writeFile(out);
console.log(`wrote ${out} (${mode})`);
