/**
 * Canonical enum values. These mirror the Prisma enums 1:1 — if you change one,
 * change the other. Kept as const objects (not TS enums) so they are usable as
 * plain data in Zod schemas and in the browser bundle.
 */

export const DataScope = {
  OWN: 'OWN',
  TEAM: 'TEAM',
  PROJECT: 'PROJECT',
  OFFICE: 'OFFICE',
  ALL: 'ALL',
} as const;
export type DataScope = (typeof DataScope)[keyof typeof DataScope];

export const UserStatus = {
  INVITED: 'INVITED',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const EmployeeStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  NOTICE_PERIOD: 'NOTICE_PERIOD',
  EXITED: 'EXITED',
} as const;
export type EmployeeStatus = (typeof EmployeeStatus)[keyof typeof EmployeeStatus];

export const AttendanceMethod = {
  MOBILE: 'MOBILE',
  OFFICE: 'OFFICE',
  BOTH: 'BOTH',
} as const;
export type AttendanceMethod = (typeof AttendanceMethod)[keyof typeof AttendanceMethod];

export const BillingType = {
  FIXED: 'FIXED',
  HOURLY: 'HOURLY',
  MILESTONE: 'MILESTONE',
} as const;
export type BillingType = (typeof BillingType)[keyof typeof BillingType];

export const BookingStatus = {
  DRAFT: 'DRAFT',
  CONFIRMED: 'CONFIRMED',
  PROJECT_CREATED: 'PROJECT_CREATED',
  CANCELLED: 'CANCELLED',
} as const;
export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

export const ConfirmationType = {
  EMAIL: 'EMAIL',
  VERBAL: 'VERBAL',
} as const;
export type ConfirmationType = (typeof ConfirmationType)[keyof typeof ConfirmationType];

export const VerbalMode = {
  CALL: 'CALL',
  MEETING: 'MEETING',
} as const;
export type VerbalMode = (typeof VerbalMode)[keyof typeof VerbalMode];

export const ProjectStatus = {
  ACTIVE: 'ACTIVE',
  ON_HOLD: 'ON_HOLD',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export const ProjectHealth = {
  HEALTHY: 'HEALTHY',
  AT_RISK: 'AT_RISK',
  CRITICAL: 'CRITICAL',
} as const;
export type ProjectHealth = (typeof ProjectHealth)[keyof typeof ProjectHealth];

export const MilestoneStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
} as const;
export type MilestoneStatus = (typeof MilestoneStatus)[keyof typeof MilestoneStatus];

export const TaskStatus = {
  TODO: 'TODO',
  IN_PROGRESS: 'IN_PROGRESS',
  REVIEW: 'REVIEW',
  DONE: 'DONE',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TaskPriority = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;
export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority];

export const PunchType = {
  IN: 'IN',
  OUT: 'OUT',
} as const;
export type PunchType = (typeof PunchType)[keyof typeof PunchType];

export const PunchSource = {
  MOBILE_GPS: 'MOBILE_GPS',
  OFFICE_IP: 'OFFICE_IP',
  MANUAL: 'MANUAL',
  REGULARISED: 'REGULARISED',
} as const;
export type PunchSource = (typeof PunchSource)[keyof typeof PunchSource];

export const AttendanceStatus = {
  PRESENT: 'PRESENT',
  LATE: 'LATE',
  HALF_DAY: 'HALF_DAY',
  ABSENT: 'ABSENT',
  ON_LEAVE: 'ON_LEAVE',
  HOLIDAY: 'HOLIDAY',
  WEEKLY_OFF: 'WEEKLY_OFF',
} as const;
export type AttendanceStatus = (typeof AttendanceStatus)[keyof typeof AttendanceStatus];

export const ApprovalStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const LeaveDayPart = {
  FULL_DAY: 'FULL_DAY',
  FIRST_HALF: 'FIRST_HALF',
  SECOND_HALF: 'SECOND_HALF',
} as const;
export type LeaveDayPart = (typeof LeaveDayPart)[keyof typeof LeaveDayPart];

export const TimesheetStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  REOPENED: 'REOPENED',
} as const;
export type TimesheetStatus = (typeof TimesheetStatus)[keyof typeof TimesheetStatus];

export const TimeEntrySource = {
  TIMER: 'TIMER',
  MANUAL: 'MANUAL',
} as const;
export type TimeEntrySource = (typeof TimeEntrySource)[keyof typeof TimeEntrySource];

export const ExpenseStatus = {
  DRAFT: 'DRAFT',
  PENDING_MANAGER: 'PENDING_MANAGER',
  PENDING_FINANCE: 'PENDING_FINANCE',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type ExpenseStatus = (typeof ExpenseStatus)[keyof typeof ExpenseStatus];

export const ReimbursementStatus = {
  PENDING: 'PENDING',
  REIMBURSED: 'REIMBURSED',
} as const;
export type ReimbursementStatus = (typeof ReimbursementStatus)[keyof typeof ReimbursementStatus];

export const ApprovalStage = {
  MANAGER: 'MANAGER',
  FINANCE: 'FINANCE',
} as const;
export type ApprovalStage = (typeof ApprovalStage)[keyof typeof ApprovalStage];

export const CostSourceType = {
  TIMESHEET: 'TIMESHEET',
  EXPENSE: 'EXPENSE',
  ADJUSTMENT: 'ADJUSTMENT',
} as const;
export type CostSourceType = (typeof CostSourceType)[keyof typeof CostSourceType];

export const NotificationType = {
  BOOKING_CONFIRMED: 'BOOKING_CONFIRMED',
  TIMESHEET_SUBMITTED: 'TIMESHEET_SUBMITTED',
  TIMESHEET_APPROVED: 'TIMESHEET_APPROVED',
  TIMESHEET_REJECTED: 'TIMESHEET_REJECTED',
  TIMESHEET_REMINDER: 'TIMESHEET_REMINDER',
  EXPENSE_SUBMITTED: 'EXPENSE_SUBMITTED',
  EXPENSE_APPROVED: 'EXPENSE_APPROVED',
  EXPENSE_REJECTED: 'EXPENSE_REJECTED',
  LEAVE_SUBMITTED: 'LEAVE_SUBMITTED',
  LEAVE_APPROVED: 'LEAVE_APPROVED',
  LEAVE_REJECTED: 'LEAVE_REJECTED',
  REGULARISATION_SUBMITTED: 'REGULARISATION_SUBMITTED',
  REGULARISATION_DECIDED: 'REGULARISATION_DECIDED',
  BUDGET_ALERT_80: 'BUDGET_ALERT_80',
  BUDGET_ALERT_100: 'BUDGET_ALERT_100',
  PROJECT_ASSIGNED: 'PROJECT_ASSIGNED',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const AuditAction = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  CONFIRM: 'CONFIRM',
  REOPEN: 'REOPEN',
  LOGIN: 'LOGIN',
  PERMISSION_CHANGE: 'PERMISSION_CHANGE',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const LeaveApprovalFlow = {
  SINGLE_LEVEL: 'SINGLE_LEVEL',
  TEAM_LEAD_THEN_MANAGER: 'TEAM_LEAD_THEN_MANAGER',
} as const;
export type LeaveApprovalFlow = (typeof LeaveApprovalFlow)[keyof typeof LeaveApprovalFlow];

export const DocumentOwnerType = {
  EMPLOYEE: 'EMPLOYEE',
  BOOKING: 'BOOKING',
  PROJECT: 'PROJECT',
  TASK: 'TASK',
  EXPENSE: 'EXPENSE',
  PUNCH: 'PUNCH',
  CLIENT: 'CLIENT',
} as const;
export type DocumentOwnerType = (typeof DocumentOwnerType)[keyof typeof DocumentOwnerType];
