# OPSVERA – Phase 1 Master Build Prompt

You are a senior full-stack engineer and product designer. Build **Phase 1 of OPSVERA**, a production-grade, multi-company Business Operations web app, exactly as specified below. Work step by step in the build order given at the end. After each step, run it, test it, and summarise what was done before moving on. Do not add features outside this scope.

Reference files (place them in `/docs` of the repo and read them before starting):
- `OPSVERA_Fully_Openable_Interactive_Product.html` – **primary visual reference** (layout, colours, components, tone).
- `OPSVERA_UI_UX_Blueprint.docx` – screen structure, principles and module intent.
- `OPSVERA_Phase1_Scope_of_Work.pdf` – the agreed scope (this prompt follows it).
- `/docs/screens/*.png` – screenshots of key prototype screens.

**Scope warning:** the prototype and blueprint show the full future product (Leads, Proposals, Invoices, Payroll, Screenshots, AI COO, etc.). Build **only the Phase 1 modules in this prompt**. Use the reference files for look, feel and layout, not for scope.

---

## 1. Product context

The client is an engineering consultancy (BIM / MEP projects) with offices in Nagpur, Nashik, Mumbai and Riyadh. They currently use Workstatus (time tracking), Petpooja / Attendo (attendance) and Zoho (billing). OPSVERA replaces them with one connected system.

**Phase 1 goal:** take a project from booking to live cost.

Core flow that must work end to end:

1. **Project booking** – a project is booked for a client with the client's confirmation attached: the confirmation email, or a verbal confirmation note if there is no email.
2. **Project code** – confirming the booking auto-generates a unique project code.
3. **Project created** – the project is created automatically from the booking (client, value, budget carried over).
4. **Project scheduled** – dates, milestones, team and tasks are planned.
5. **Attendance** – employees clock in from mobile (GPS + selfie + geofence) or from office network (IP / WiFi).
6. **Work** – employees run a timer on a project task or add time manually.
7. **Approval** – Team Lead / PM approves weekly timesheets; expenses go through Manager then Finance approval.
8. **Project cost** – approved hours × employee cost rate, plus approved expenses, post to the project cost ledger.
9. **Dashboard** – budget vs actual, cost and margin update live.

---

## 2. Tech stack (fixed)

| Layer | Technology |
| --- | --- |
| Monorepo | pnpm workspaces + Turborepo: `apps/api`, `apps/web`, `packages/shared` |
| Backend | Node.js 20, TypeScript, **NestJS** (modular), REST API, OpenAPI/Swagger docs |
| Database | **MySQL 8** (InnoDB, utf8mb4) with **Prisma ORM** and migrations |
| Validation | **Zod** schemas in `packages/shared`, used by both API and web |
| Auth | JWT access token (15 min) + refresh token (httpOnly cookie), bcrypt passwords |
| Jobs | Redis + BullMQ (reminders, notifications, budget alerts) |
| Files | S3-compatible storage (AWS S3 / DigitalOcean Spaces / MinIO locally), presigned uploads |
| Email | Nodemailer with SMTP, templated emails |
| Frontend | React 18 + TypeScript + Vite, React Router, **TanStack Query**, **TanStack Table**, React Hook Form + Zod, Tailwind CSS, Recharts, lucide-react icons |
| PWA | vite-plugin-pwa (installable on phone home screen) |
| Local dev (Windows + Laragon) | Laragon MySQL 8 and Laragon Redis. Files on local disk in development (same storage interface, S3 driver in production). Emails to a log / Mailpit in development. No Docker required. |
| Quality | ESLint, Prettier, Jest (API unit + e2e), Vitest + Testing Library (web) |

Rules:
- Money: `Decimal(15,2)` in DB, never float. Use a decimal library in code.
- Time: store everything in **UTC**; display and calculate attendance in the **office's time zone**.
- Every API input validated with Zod; every list endpoint paginated, sortable and filterable.

---

## 3. Multi-company (multi-tenant) foundation

- Single database. **Every business table has `companyId`.**
- A Prisma client extension automatically adds `companyId` to every read/write based on the logged-in user. No query may bypass it.
- Settings, roles, offices, project types, files (S3 path `company/{companyId}/...`) are all per company.
- Seed one company for the client.

---

## 4. Roles & permissions (RBAC)

Three levels, all enforced in the **backend** (guards + query filters). Frontend only hides what the user cannot use.

1. **Module access** – which menus/screens a role can open.
2. **Action access** – permission keys per module: `view`, `create`, `edit`, `delete`, `approve`, `export`. Format: `module.action` (e.g. `booking.confirm`, `timesheet.approve`, `salary.view`).
3. **Data scope** – `OWN`, `TEAM`, `PROJECT`, `OFFICE`, `ALL`, applied as query filters.

Sensitive fields (salary, cost rate, project value, margin) are removed from API responses unless the user has the matching permission (`salary.view`, `cost.view`, `margin.view`).

Default roles (seeded, editable): CEO / Director (ALL), HR / Admin, Project Manager, Finance, Team Lead, Employee. Admin can create custom roles (e.g. Sales, Booking Manager) via a **permission matrix screen** (modules × actions checkboxes + data scope dropdown).

Audit log: who, what, when, before/after values for booking confirmation, salary / cost rate change, approvals, rejections, deletes, permission changes.

---

## 5. Data model (Prisma – minimum entities)

Company, Office (timezone, weeklyOffDays, lat/lng, geofenceRadiusM, allowedIPs), Department, Designation, Holiday (officeId), ProjectType (name, shortCode), Role, Permission, RolePermission (dataScope), User (auth), Employee (officeId, departmentId, designationId, managerId, attendanceMethod, status), EmployeeCostRate (amount, effectiveFrom – **history table**), EmployeeSalary (monthly, effectiveFrom), Document, Client, ClientContact, Booking, BookingConfirmation, ProjectCodeSequence, Project, ProjectMember, Milestone, Task, TaskComment, Attachment, Shift, ShiftAssignment, AttendancePolicy, AttendanceRecord, Punch, RegularisationRequest, LeaveType, LeaveBalance, LeaveRequest, TimeEntry, Timesheet (weekly), TimesheetApproval, ExpenseCategory, Expense, ExpenseApproval, CostLedgerEntry, Notification, AuditLog.

All tables: `id` (cuid/uuid), `companyId`, `createdAt`, `updatedAt`, `createdById`, soft delete where needed.

---

## 6. Modules and features

### 6.1 Login, Roles & Permissions
- Login, logout, forgot / reset password via email, invite-based first login.
- Permission matrix screen, custom roles, audit log screen with filters.

### 6.2 Company & Office Setup
- Company profile, logo, financial year start month, currency.
- Offices / job sites: address, map pin, geofence radius, **time zone, weekly off days, holiday calendar, allowed office IPs**.
- Departments, designations.
- Project types with short code (HOS, DC, PHA, SOL…).
- Attendance policy per office/shift: grace minutes, late mark, half-day threshold, minimum full-day hours, overtime trigger.
- Leave types and approval flow (Team Lead → Manager, or single level).
- Project code format setting (see 6.4).

### 6.3 Employees
- List with search, filters (office, department, status), column chooser, export.
- Profile: personal details, joining date, department, designation, reporting manager, office, attendance method (mobile / office / both).
- Monthly salary and hourly cost rate with **effective-date history**.
- Documents upload. Bulk import from Excel with row-level error report.
- Activate / deactivate, send login invite.
- **Employee 360** page: profile, attendance summary, leave balance, current projects, timesheet hours.

### 6.4 Clients & Project Booking
- Clients with contacts.
- **New booking form:** client, project name, project type, office, booking date, project value, budget hours, billing type (fixed / hourly / milestone – stored only), expected start/end, scope description.
- **Client confirmation (required to confirm):**
  - `EMAIL` – upload the confirmation email (PDF / image / .eml / .msg).
  - `VERBAL` – confirmed by (name), date, mode (call / meeting), summary of what was agreed.
- PO / work order upload – optional.
- Verbal booking shows badge **"Email pending"** until an email is attached later.
- Status: `DRAFT → CONFIRMED → PROJECT_CREATED`, or `CANCELLED`.
- **Confirm booking** (permission `booking.confirm`) in one DB transaction: lock sequence → generate project code → create project → mark booking `PROJECT_CREATED` → audit log → notify PM.
- **Project code:** configurable pattern, default `{PREFIX}-{FY}-{TYPE}-{SEQ4}` → e.g. `MOR-26-27-HOS-0043`. Sequence per company per financial year, generated with row lock, unique index, never reused (even if cancelled).
- Booking register with filters, and link booking ↔ project.

### 6.5 Projects, Scheduling & Tasks
- Project created only from a confirmed booking.
- PM, members, start/end dates, milestones with due dates.
- Tasks: assignee, due date, estimated hours, priority, status (`TODO, IN_PROGRESS, REVIEW, DONE`). Kanban (drag and drop) + list view. Comments and attachments.
- Project status: Active, On Hold, Completed, Cancelled.
- **Project 360**: header with code, client, status, health pill; tabs – Overview (budget vs actual hours and cost, margin, burn chart), Booking & confirmation, Schedule, Team, Tasks, Time, Expenses, Cost ledger.

### 6.6 Attendance
- **Mobile punch:** browser geolocation + front-camera selfie + geofence distance check against office/site; reject or flag outside radius.
- **Office punch:** allowed only if request IP is in office allowed IPs.
- Rule engine computes per day: present, late, early exit, half-day, absent, overtime, on leave, holiday, weekly off — using office time zone, shift and policy. Run on punch and via nightly job.
- Live attendance board (cards + table) with office filter. Monthly register (calendar grid per employee). Regularisation request → manager approval. Export to Excel.

### 6.7 Shifts
- Shift templates (start, end, grace, break), assign to employees/departments with weekly offs, weekly roster view.

### 6.8 Leave
- Types with yearly quota and carry forward; balances; apply full/half day; approve/reject; team leave calendar; approved leave writes attendance status automatically.

### 6.9 Timer & Timesheets
- Global timer in top bar: must select **project + task** to start; only one running timer per user; survives page reload.
- Manual time entry; billable / non-billable flag.
- Weekly timesheet grid (days × tasks), submit week.
- Approval queue for Team Lead / PM: approve / reject with comment, bulk approve.
- Reminder job for unsubmitted timesheets.

### 6.10 Expenses
- Entry: date, amount, category, project, billable, receipt photo (camera on mobile).
- Category limits with warning.
- Two-step approval: Manager → Finance. Reimbursement status: pending / reimbursed.

### 6.11 Project Cost & Dashboards
- **Cost ledger:** on timesheet approval post `hours × cost rate effective on work date`; on expense final approval post its amount. Posting is **idempotent** (unique key on source type + source id).
- Budget alerts at 80% and 100% (notification + dashboard).
- **CEO dashboard:** bookings this month, active projects, over-budget projects, today's attendance, pending approvals, cost by project chart, utilization; office filter.
- **Manager dashboard:** team attendance, pending approvals, my projects status.
- **Employee "My Day":** clock-in card, running timer, today's tasks, leave balance, pending items.
- Reports (filter + Excel export): bookings, attendance, leave, timesheets, project cost, expenses.

### 6.12 Notifications & Search
- In-app notification bell + email for approvals, rejections, booking confirmations, budget alerts.
- **Ctrl + K command palette:** search projects, employees, clients, bookings; quick actions (New booking, Start timer, Apply leave).

---

## 7. Business rules (must be enforced in backend + covered by tests)

1. A project can be created only from a confirmed booking.
2. A booking cannot be confirmed without an EMAIL attachment or a complete VERBAL note.
3. Project codes are unique and never reused.
4. An approved timesheet is locked; its cost posts exactly once. Correction = reopen with reason + audit record, which reverses and reposts the ledger entry.
5. Cost rate used = employee's rate effective on the work date.
6. Approved leave marks attendance automatically; holidays and weekly offs follow the employee's office calendar.
7. Users see data only within their data scope; companies never see each other's data.
8. Money in `Decimal(15,2)`; times stored in UTC, shown in office local time.

---

## 8. UI / UX – match the client's interactive prototype

Use the **latest interactive prototype** as the visual source of truth. The UI must feel premium, calm and fast — like a modern SaaS (Linear / Stripe quality).

**Design tokens (from the prototype):**
```
--ink:#0b1220; --ink2:#14213d; --muted:#6b7890; --muted2:#8b98ab;
--blue:#3366ff; --blue2:#5b8cff; --cyan:#15b8d6; --green:#16a36a;
--amber:#f59e0b; --red:#e5484d; --violet:#7c5cfc;
--bg:#f5f7fb; --surface:#ffffff; --surface2:#f8fafd; --line:#e5eaf1;
--nav:#0d1526; --nav2:#111b31;
--shadow:0 8px 28px rgba(15,23,42,.07); --shadow2:0 20px 60px rgba(15,23,42,.18);
radius: 10px (buttons/inputs), 14px (cards), 18–22px (large panels)
font: Inter, system-ui fallback
```
Put these in Tailwind theme config; no hard-coded colours in components.

**Layout:**
- Left **dark navy sidebar** (~260px, gradient `--nav → --nav2`), brand mark + "OPSVERA / BUSINESS OPERATIONS OS", grouped nav with small uppercase group labels, active item with blue→cyan gradient highlight. Collapsible; becomes a drawer on mobile.
- **Sticky top bar** (72px, white with blur): search box with ⌘K hint, global timer, "+ Quick Action" primary button, notification bell, avatar menu.
- **Page header pattern:** small eyebrow label, large title, one-line subtitle, actions on the right.
- **Metric card row:** 6 KPI cards (label, big value, small foot text, coloured state: good / warn / bad).
- **Panels:** white cards with title, subtitle and optional action link.
- **Tables:** TanStack Table with sticky header, row hover, status pills, clickable rows opening a **right-side detail drawer** or 360 page.
- **Status pills:** green = healthy / approved / paid, blue = info / sent, amber = pending / review, red = risk / overdue / rejected.
- **Booking lifecycle stepper** on booking and project pages: Booking → Confirmation → Project Code → Project Created → Scheduled.

**Phase 1 sidebar (only these items):**
- Command Center: Executive Dashboard (role-based home)
- Commercial: Clients, Bookings
- People & Work: People, Attendance, Shifts, Leave, Timesheets
- Projects: Projects, Tasks
- Money: Expenses, Project Cost
- Insights & Admin: Reports, Roles & Permissions, Settings

**Quality bar:**
- Skeleton loaders, empty states with a clear next action, toast feedback on every action, confirmation dialogs for destructive actions, inline form validation.
- Optimistic updates for timer, approvals, Kanban moves.
- Keyboard accessible, visible focus rings, WCAG AA contrast.
- **Fully responsive.** On mobile, employee screens (My Day, clock-in, timer, leave, expense) use large touch targets and a bottom navigation bar. Installable as PWA.
- Indian number formatting (₹ 10,50,000; "L" / "Cr" short form on dashboards). Dates as `04 Oct 2026`.

---

## 9. API conventions

- REST under `/api/v1`, resource-based routes, consistent error shape `{ code, message, details }`.
- Pagination `?page=&pageSize=`, sorting `?sort=field:asc`, filters as query params.
- Swagger at `/api/docs`.
- Rate limiting on auth routes, Helmet, CORS allow-list, request logging with request id.

---

## 10. Seed data (realistic, for demo and testing)

- Company with prefix `MOR`, financial year April–March.
- Offices: Nagpur HQ, Nashik, Mumbai client site (GPS required), Riyadh (Asia/Riyadh time zone, Friday–Saturday weekly off).
- Project types: Hospital (HOS), Data Centre (DC), Pharma (PHA), Solar (SOL).
- ~10 employees across roles, 4 clients, 4 bookings (one email-confirmed, one verbal with "Email pending", one draft, one cancelled), 3 active projects with tasks, a week of attendance, time entries and expenses so dashboards show real numbers.

---

## 11. Build order

1. Monorepo, `.env` setup for Laragon MySQL/Redis, Prisma schema + migrations, shared Zod package, lint/test setup. **Show the full table list with key columns and relations for approval before running migrations.**
2. Auth, multi-company extension, RBAC (permissions, data scope, field masking), audit log.
3. App shell UI: design tokens, sidebar, top bar, page header, metric card, panel, table, drawer, pills, Ctrl+K. **Build a `/ui-kit` page showing every component, compare it side by side with the prototype, and stop for review before building modules.**
4. Company & Office Setup, Settings screens.
5. Employees + Employee 360, cost rate history, Excel import.
6. Clients & Project Booking + project code generation.
7. Projects, scheduling, milestones, tasks, Kanban, Project 360.
8. Shifts, Attendance (mobile + office punch, rule engine, board, register, regularisation).
9. Leave.
10. Timer & Timesheets with approvals.
11. Expenses with two-step approval.
12. Cost ledger posting, budget alerts.
13. Dashboards (CEO, Manager, My Day) and Reports with Excel export.
14. Notifications (in-app + email), reminders.
15. PWA, responsive polish, accessibility pass.
16. Test pass: unit tests for rule engine, code generation, cost posting, permissions; e2e for the full core flow (booking → project → time → approval → cost → dashboard).

**Definition of done for Phase 1:** a CEO can confirm a booking, a project with a correct code is created, employees clock in and log time, managers approve, and the CEO dashboard shows correct cost and margin — with every role seeing only what it is allowed to see, on desktop and mobile.
