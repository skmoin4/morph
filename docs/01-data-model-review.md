# Data model — review before migration

**Status:** approved and migrated on 06 Oct 2026. Four changes were made on
sign-off; they are marked **[approved change]** below.
**Schema:** [apps/api/prisma/schema.prisma](../apps/api/prisma/schema.prisma) — 44 models, `prisma validate` passes.

All 43 entities named in the scope are present. One table was added: `RefreshToken`,
needed because the refresh token lives in an httpOnly cookie and has to be
revocable and rotatable.

## Conventions applied to every table

- `id` — `cuid()`, `VARCHAR(191)` primary key.
- `companyId` — on every business table. A Prisma client extension injects it
  into every read and write (built in step 2); nothing may bypass it.
- `createdAt` / `updatedAt` — `DATETIME(3)`, auto-maintained.
- `createdById` — holds a `User.id` but is **deliberately not a foreign key**.
  A back-relation on `User` for all 40-odd tables adds nothing and makes the
  model unreadable. Indexed where it is actually queried.
- `deletedAt` — soft delete, only on tables a user can remove while history
  still points at them (clients, employees, projects, tasks, time entries…).
  Approval and ledger tables are never soft-deleted.
- Money — `DECIMAL(15,2)`. Hours — `DECIMAL(12,2)` for totals, `DECIMAL(6,2)`
  per entry. Leave days — `DECIMAL(6,2)`.
- Instants — `DATETIME(3)` in **UTC**. Office-local calendar values
  (`attendanceDate`, `weekStartDate`, `effectiveFrom`, `bookingDate`) are
  `DATE`, because "the 6th of October in Riyadh" is a calendar fact, not an
  instant. Shift times are `VARCHAR(5)` `"HH:mm"` wall clock so they survive DST.
- Table names are snake_case plural via `@@map`; model names stay PascalCase.

---

## 1. Tenancy and org structure

| Table | Key columns | Relations |
| --- | --- | --- |
| `companies` | `name`, **`codePrefix`** (unique, e.g. `MOR`), `projectCodePattern` (default `{PREFIX}-{FY}-{TYPE}-{SEQ4}`), `fyStartMonth` (4 = April), `currency`, `currencySymbol`, `logoDocumentId` | parent of everything |
| `offices` | `name`, `shortCode`, **`timezone`** (IANA), `latitude`/`longitude` `DECIMAL(10,7)`, `geofenceRadiusM`, **`weeklyOffDays`** JSON `[0..6]`, **`allowedIPs`** JSON, `requiresGps` | → company; ← employees, holidays, bookings, projects, punches, attendance |
| `departments` | `name` (unique per company), `shortCode`, `headEmployeeId` | → company; ← employees, designations, shift assignments |
| `designations` | `name` (unique per company), `level` | → company, department? |
| `holidays` | `name`, `date` DATE, `isOptional`, **`officeId` nullable = applies company-wide** | → company, office? |
| `project_types` | `name`, **`shortCode`** (`HOS`/`DC`/`PHA`/`SOL`, unique per company), `colorToken` | ← bookings, projects |

> Riyadh is modelled purely as data: `timezone = Asia/Riyadh`, `weeklyOffDays = [5,6]`.
> Mumbai client site sets `requiresGps = true`.

## 2. RBAC and audit

| Table | Key columns | Relations |
| --- | --- | --- |
| `permissions` | **`key`** globally unique (`booking.confirm`, `timesheet.approve`, `salary.view`), `module`, `action`, `label`, `isSensitive` | ← role_permissions |
| `roles` | `name` (unique per company), `systemKey` (set for the 6 seeded roles), `isSystem` | → company; ← role_permissions, users |
| `role_permissions` | **`dataScope`** enum `OWN\|TEAM\|PROJECT\|OFFICE\|ALL`, unique on (`roleId`,`permissionId`) | → role, permission |
| `users` | **`email` globally unique** [approved change], `passwordHash`, `roleId`, `status` `INVITED\|ACTIVE\|SUSPENDED`, `inviteTokenHash`, `resetTokenHash`, `failedLoginCount`, `lockedUntil` | → company, role; ← employee (1:1), refresh tokens |
| `refresh_tokens` | `tokenHash` unique, `revokedAt`, `expiresAt`, `userAgent`, `ipAddress` | → user |
| `audit_logs` | `action`, `entityType`, `entityId`, `summary`, **`beforeData`/`afterData` JSON**, `reason`, `ipAddress`, `requestId` | → company, user? |

Permission keys are generated from 16 modules × 6 actions, plus 10 keys that do
not fit the grid: `booking.confirm`, `timesheet.reopen`, `expense.reimburse`,
`attendance.regularise`, `salary.view`, `salary.edit`, `cost.view`, `cost.edit`,
`margin.view`, `project.value.view`. The last four mask response **fields**
rather than gate a route.

## 3. Files

| Table | Key columns | Relations |
| --- | --- | --- |
| `documents` | `ownerType`/`ownerId` (polymorphic), `category`, `fileName`, `mimeType`, `sizeBytes`, **`storageKey`** always `company/{companyId}/…`, `storageDriver`, `checksum` | → company; ← confirmation email, PO, receipts, selfies |
| `attachments` | join row: `documentId` + one of `taskId`/`projectId`/`milestoneId` | → document, task?, project?, milestone? |

One `documents` table serves every module; `attachments` exists only so a task
can carry many files without putting a nullable FK on `documents` per module.

## 4. People

| Table | Key columns | Relations |
| --- | --- | --- |
| `employees` | `employeeCode` (unique per company), names, `joiningDate`, `exitDate`, `officeId`, `departmentId`, `designationId`, **`managerId`** (self-relation), **`attendanceMethod`** `MOBILE\|OFFICE\|BOTH`, `status` | → user? (1:1), office, department?, designation?, manager?; ← everything people-shaped |
| `employee_cost_rates` | `hourlyRate` `DECIMAL(15,2)`, **`effectiveFrom`** DATE (unique per employee), `effectiveTo` | → employee |
| `employee_salaries` | `monthlyAmount`, `effectiveFrom` (unique per employee), `effectiveTo` | → employee |

Rate rows are **never updated in place** — costing needs the rate that was
effective on the work date, so a change inserts a new row and closes the old one.

## 5. Clients and booking

| Table | Key columns | Relations |
| --- | --- | --- |
| `clients` | `name` (unique per company), `clientCode`, `gstin`, address | ← contacts, bookings, projects |
| `client_contacts` | `name`, `designation`, `email`, `phone`, `isPrimary` | → client |
| `bookings` | `bookingNumber` (unique per company), `projectName`, `projectValue` `DEC(15,2)`, `budgetHours`, `billingType`, `expectedStartDate`/`EndDate`, **`status`** `DRAFT→CONFIRMED→PROJECT_CREATED \| CANCELLED`, `confirmedAt`/`confirmedById`, `cancelReason`, `generatedProjectCode` | → client, contact?, projectType, office; ← confirmation (1:1), project (1:1) |
| `booking_confirmations` | **1:1 with booking**, `type` `EMAIL\|VERBAL`; EMAIL → `emailDocumentId`, `emailReceivedAt`; VERBAL → `confirmedByName`, `confirmedOn`, `verbalMode` `CALL\|MEETING`, `verbalSummary`; optional `poDocumentId`, `poNumber` | → booking, documents |
| `project_code_sequences` | **unique (`companyId`,`fyStartYear`)**, `fyLabel` (`26-27`), `lastSequence` | → company |

**How the two booking rules are enforced:**

- *No confirmation, no confirm.* `booking_confirmations` is 1:1 and required
  before `status` may leave `DRAFT`. A `VERBAL` row with `emailDocumentId = NULL`
  is exactly the "Email pending" badge — no extra flag column needed.
- *Codes are unique and never reused.* One counter row per company per FY,
  incremented under `SELECT … FOR UPDATE` inside the confirmation transaction,
  with `UNIQUE(companyId, projectCode)` on `projects` as the backstop. A
  cancelled booking's number is not returned to the pool.

## 6. Projects, schedule and tasks

| Table | Key columns | Relations |
| --- | --- | --- |
| `projects` | **`projectCode`** unique per company, **`bookingId` unique** (a project exists only because a booking was confirmed), `projectValue`, `budgetHours`, `status`, `health`, denormalised `actualHours`, `actualLabourCost`, `actualExpenseCost`, `actualTotalCost`, `budgetAlertLevel` (0/80/100) | → booking, client, projectType, office, projectManager?; ← members, milestones, tasks, time, expenses, ledger |
| `project_members` | unique (`projectId`,`employeeId`), `roleOnProject`, `allocationPercent`, `joinedOn`/`leftOn` | → project, employee |
| `milestones` | `name`, `dueDate`, `status`, `sortOrder`, `value?` | → project; ← tasks |
| `tasks` | `title`, `assigneeId`, `status` `TODO\|IN_PROGRESS\|REVIEW\|DONE`, `priority`, `dueDate`, `estimatedHours`, `loggedHours`, **`sortOrder`** (Kanban position) | → project, milestone?, assignee?; ← comments, time entries, attachments |
| `task_comments` | `body` TEXT | → task, employee? |

`bookingId` being **unique** on `projects` is what makes "one project per
confirmed booking" a database guarantee rather than a service convention.
The four `actual*` columns are maintained inside the same transaction as the
ledger entry, so the dashboard never has to sum the ledger live.

## 7. Shifts and attendance

| Table | Key columns | Relations |
| --- | --- | --- |
| `shifts` | `name`, `startTime`/`endTime` `"HH:mm"`, `crossesMidnight`, `breakMinutes`, `graceMinutes`, `isDefault` | ← assignments, policies, attendance |
| `shift_assignments` | `shiftId` + **either** `employeeId` **or** `departmentId`, `effectiveFrom`/`To`, optional `weeklyOffDays` override | → shift, employee?, department? |
| `attendance_policies` | `graceMinutes`, `lateMarkAfterMinutes`, `halfDayBelowHours`, `fullDayMinimumHours`, `overtimeAfterHours`, `earlyExitBeforeMinutes`, `lateMarksPerHalfDay`; resolved per office, optionally per shift | → company, office?, shift? |
| `attendance_records` | **unique (`employeeId`,`attendanceDate`)**, `status` (7 values), `firstInAt`/`lastOutAt` UTC, `workedMinutes`, `lateMinutes`, `earlyExitMinutes`, `overtimeMinutes`, `isFlagged`/`flagReason`, `isRegularised`, `leaveRequestId`, `holidayId`, **`dayValue`** `DEC(3,2)` (1.00/0.50/0.00) | → employee, office, shift?; ← punches |
| `punches` | `type` `IN\|OUT`, `source` `MOBILE_GPS\|OFFICE_IP\|MANUAL\|REGULARISED`, `punchedAt` UTC, `attendanceDate` DATE; GPS evidence `latitude`/`longitude`/`accuracyM`/**`distanceM`**/`withinGeofence`/`selfieDocumentId`; network evidence `ipAddress`/`ipAllowed`; `isFlagged`/`flagReason` | → employee, attendanceRecord?, office?, selfie document? |
| `regularisation_requests` | `attendanceDate`, `requestedInTime`/`OutTime`, `reason`, `status`, `approverId`, `decidedAt` | → employee |

Punches store the **evidence** (distance, selfie, IP, allowed-or-not) rather
than just a verdict, so a flagged day can be audited after the fact.
Employee-level shift assignments win over department-level ones for the same date.

## 8. Leave

| Table | Key columns | Relations |
| --- | --- | --- |
| `leave_types` | `name`/`shortCode` unique per company, `yearlyQuota`, `carryForward`, `maxCarryForward`, `allowHalfDay`, `isPaid`, **`approvalFlow`** `SINGLE_LEVEL\|TEAM_LEAD_THEN_MANAGER` | ← balances, requests |
| `leave_balances` | **unique (`employeeId`,`leaveTypeId`,`year`)**, `opening`, `accrued`, `carriedForward`, `used`, **`pending`** | → employee, leaveType |
| `leave_requests` | `fromDate`/`toDate`, `dayPart` `FULL_DAY\|FIRST_HALF\|SECOND_HALF`, `totalDays` (working days only), `status`, `level1*`/`level2*` approver columns, **`attendanceApplied`** | → employee, leaveType |

`pending` reserves the balance while a request is in flight, so two overlapping
requests cannot both be approved against the same days. `attendanceApplied` is
the idempotency flag for writing `ON_LEAVE` attendance rows.

## 9. Time and timesheets

| Table | Key columns | Relations |
| --- | --- | --- |
| `timesheets` | **unique (`employeeId`,`weekStartDate`)**, `weekStartDate` = Monday office-local, `status` `DRAFT\|SUBMITTED\|APPROVED\|REJECTED\|REOPENED`, `totalHours`, `billableHours`, `submittedAt`, `approvedAt`/`approvedById`, `reopenedAt`/`reopenReason`, **`costPostedAt`** | → employee; ← entries, approvals |
| `timesheet_approvals` | `approverId`, `status`, `comment`, `decidedAt` — one row per decision, so re-approval after a reopen keeps the trail | → timesheet |
| `time_entries` | `workDate` DATE, `startedAt`/`endedAt` (timer), **`hours`** `DEC(6,2)`, `isBillable`, **`isRunning`**, `source` `TIMER\|MANUAL`, **`isLocked`** | → employee, project, task?, timesheet? |

`costPostedAt` plus the unique key on the ledger (below) is what makes
"an approved timesheet posts exactly once" true even under a double-click or a
retried job. `isLocked` is set on every entry when its week is approved.

> **Running timer [approved change].** Enforced in the database by a stored
> generated column plus a unique index:
>
> ```sql
> runningKey VARCHAR(191) GENERATED ALWAYS AS
>   (IF(source = 'TIMER' AND endedAt IS NULL, employeeId, NULL)) STORED,
> UNIQUE KEY time_entries_running_timer_key (companyId, runningKey)
> ```
>
> A second start hits duplicate-key 1062, which the service maps to
> `TIMER_ALREADY_RUNNING`. The service-level transaction check stays as the
> first line of defence.
>
> Two deviations from the literal brief, both forced:
>
> 1. The formula is guarded with `source = 'TIMER'`, not just `endedAt IS NULL`.
>    Manual time entries also have `endedAt IS NULL` — without the guard the
>    first manual entry would claim the employee's slot and block every other
>    manual entry *and* the timer. (Verified: 38 seeded manual entries, all with
>    `runningKey = NULL`.)
> 2. `time_entries.employeeId` had to become `ON DELETE RESTRICT ON UPDATE NO ACTION`.
>    MySQL rejects CASCADE / SET NULL referential actions on a base column of a
>    stored generated column (error 1215, verified directly). It is also the
>    behaviour we want: time entries are cost history and must outlive a
>    soft-deleted employee.
>
> The redundant `isRunning` boolean was dropped. With the generated column as
> the database's source of truth, a second mutable copy of the same fact could
> only ever drift out of step.

## 10. Expenses

| Table | Key columns | Relations |
| --- | --- | --- |
| `expense_categories` | `name` unique per company, `perClaimLimit`, `perMonthLimit`, `requiresReceipt` | ← expenses |
| `expenses` | `expenseDate`, `amount` `DEC(15,2)`, `isBillable`, `receiptDocumentId`, **`status`** `DRAFT\|PENDING_MANAGER\|PENDING_FINANCE\|APPROVED\|REJECTED`, `reimbursementStatus` `PENDING\|REIMBURSED`, `exceededLimit`, **`costPostedAt`** | → employee, project?, category, receipt document?; ← approvals |
| `expense_approvals` | **unique (`expenseId`,`stage`)**, `stage` `MANAGER\|FINANCE`, `approverId`, `status`, `comment` | → expense |

Category limits **warn** rather than block; `exceededLimit` records that the
warning was shown and accepted, which is what Finance will want to filter on.

## 11. Cost ledger and notifications

| Table | Key columns | Relations |
| --- | --- | --- |
| `cost_ledger_entries` | **unique (`sourceType`,`sourceId`,`projectId`,`postingVersion`,`isReversal`)** [approved change], `sourceType` `TIMESHEET\|EXPENSE\|ADJUSTMENT`, `sourceId`, **`postingVersion`**, `isReversal`, `postingDate`, `hours`, **`rateApplied`**, `amount`, `reversesId` | → project, employee? |
| `notifications` | `userId`, `type` (16 values), `title`, `body`, `linkUrl`, `entityType`/`entityId`, `readAt`, `emailSentAt` | → company, user |

The ledger is **append-only**. Reopening an approved timesheet writes a negative
`isReversal = true` row carrying the version it cancels, and the next approval
posts `postingVersion + 1`. History is never mutated, and the unique key makes a
repeated posting attempt fail loudly instead of silently double-counting.

So `approve → reopen → approve → reopen → approve` produces five rows
(v1, −v1, v2, −v2, v3) whose net is the last approval alone. This is covered by
`src/modules/cost/cost-posting.logic.spec.ts`.

`projectId` is in the key because a weekly timesheet legitimately spans several
projects and cost has to land on each separately — without it, a multi-project
timesheet could only ever post one row.

**`rateBreakdown` [approved change].** Every labour posting carries the working
behind its amount as JSON, so a number is never unexplained:

```json
[{ "from": "2026-09-28", "to": "2026-09-30", "hours": "24.00",
   "rate": "650.00", "amount": "15600.00" },
 { "from": "2026-10-01", "to": "2026-10-01", "hours": "4.00",
   "rate": "700.00", "amount": "2800.00" }]
```

One segment per contiguous run of work dates sharing a rate, so a single-rate
posting has exactly one segment and the cost ledger tooltip always has something
to show. `rateApplied` is kept for the single-rate case. A reversal row carries
the mirror image: same dates and rates, negated hours and amounts. Expense and
adjustment postings leave it null — they have no hours or rate to explain.

---

## Confirmations requested on sign-off

**Offices hold time zone and weekly off days** — yes. `offices.timezone` (IANA),
`offices.weeklyOffDays` (JSON array of 0–6), plus `latitude`/`longitude`,
`geofenceRadiusM`, `allowedIPs` and `requiresGps`. Riyadh is pure data:
`Asia/Riyadh` with `[5,6]`, so it is off Friday and Saturday and **works
Sunday** — visible in the seeded attendance week.

**Business unique indexes include `companyId`** — yes for every top-level
identifier: employee code, client name, booking number, project code, office
short code, project type short code, role name, department, designation, leave
type, expense category, shift name, holiday.

Child-row keys are scoped through their parent instead, which is strictly
tighter rather than looser, because the parent id already belongs to exactly one
company:

| Table | Key |
| --- | --- |
| `attendance_records` | (`employeeId`, `attendanceDate`) |
| `timesheets` | (`employeeId`, `weekStartDate`) |
| `employee_cost_rates` / `employee_salaries` | (`employeeId`, `effectiveFrom`) |
| `leave_balances` | (`employeeId`, `leaveTypeId`, `year`) |
| `project_members` | (`projectId`, `employeeId`) |
| `expense_approvals` | (`expenseId`, `stage`) |
| `role_permissions` | (`roleId`, `permissionId`) |

Two keys are global on purpose: `companies.codePrefix` (so two companies cannot
mint colliding project codes) and `users.email` (below).

**User login email is unique globally** — it is now. It was per company; changed
on sign-off. Login is email + password with no company selector, so the address
has to resolve to exactly one account.

## Verified in the live database

```
45 tables (44 models + _prisma_migrations)
runningKey          STORED GENERATED, if((source = 'TIMER' and endedAt is null), employeeId, NULL)
cost_ledger_posting_key   UNIQUE (sourceType, sourceId, projectId, postingVersion, isReversal)
users_email_key           UNIQUE (email)
```

A second running timer for the same employee is rejected with
`ERROR 1062 ... for key 'time_entries.time_entries_running_timer_key'`.
