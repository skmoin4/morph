# OPSVERA – Project Context & Decisions (handoff)

Read this first. It summarises every decision taken with the client and during planning, before and during the build. The master prompt (`docs/OPSVERA_Phase1_Master_Prompt.md`) and the Phase 1 SOW PDF remain the detailed spec; this file records the *why* and the current state.

## 1. Client and goal

- Client: engineering consultancy (BIM / MEP – hospitals, data centres, pharma, solar). Offices: Nagpur HQ, Nashik, Mumbai (client site), Riyadh.
- Today they use Workstatus (time / activity tracking), Petpooja Payroll / Attendo (attendance, payroll) and Zoho (quotes, invoices, accounts). OPSVERA replaces all three with one connected system.
- The client plans to **sell OPSVERA as SaaS later** → the system is multi-company from day one.
- Heart of the product: every approved hour and expense becomes project cost → live margin on the CEO dashboard.

## 2. Client's real booking process (from client voice note)

1. Initial project booking.
2. Attach the client's confirmation **email**; if there is no email, record a **verbal confirmation note** (who, when, mode, what was agreed).
3. Confirming the booking creates the project (with project code).
4. Then the project is scheduled (dates, milestones, team, tasks) and work starts.

PO / work order is **optional**, not mandatory. A verbal booking shows "Email pending" until the email is attached later.

## 3. Phasing (agreed)

- **Phase 1 (now):** Login, roles & permissions; company & office setup; employees; clients & project booking + project code; projects, scheduling & tasks; attendance (mobile GPS + selfie + geofence, office IP); shifts; leave; timer & timesheets; expenses; project cost ledger; dashboards & reports; notifications & Ctrl+K search.
- **Later phases (do NOT build now):** invoices, quotes, receivables, payroll, native mobile app, desktop agent (screenshots / apps / idle – client does want this eventually), leads / opportunities / proposals, resource planner, deliverables, biometric machine integration, banking, vendor bills, client portal, AI COO.

## 4. Key decisions

| Topic | Decision |
| --- | --- |
| Stack | Node.js 20 + TypeScript + NestJS, MySQL 8 + Prisma, React + TS + Vite + Tailwind, pnpm + Turborepo monorepo. Not Laravel, not MongoDB. |
| Local dev | Windows + Laragon (MySQL 8.4 datadir `C:/laragon/data/mysql-8.4`, Redis 6379). No Docker. |
| Mobile | Phase 1 = PWA (same web app, installable). Native app later only if needed (iPhone push, background location, Play Store presence). |
| Biometric | Petpooja fingerprint machine is not integrated in Phase 1. Later: integrate a push-capable device (ZKTeco / eSSL) or CSV import. Phone fingerprint cannot identify employees. |
| Offices | One company, four offices. Time zone, weekly offs, holidays, geofence and office IPs are **per office**. Riyadh = Asia/Riyadh, Fri–Sat off. |
| Multi-tenancy | Single DB, `companyId` on every business table, Prisma extension + AsyncLocalStorage enforces it. |
| Permissions | Three levels: module access, action access (`module.action`), data scope (OWN / TEAM / PROJECT / OFFICE / ALL). Sensitive fields (salary, cost rate, value, margin) masked by permission. Custom roles via permission matrix. Enforced in backend. |
| Project code | Configurable, default `{PREFIX}-{FY}-{TYPE}-{SEQ4}`, e.g. `MOR-26-27-HOS-0043`. Sequence per company per FY, shared across types, never reused. |
| Design | Visual source of truth = `docs/OPSVERA_Fully_Openable_Interactive_Product.html` (dark navy sidebar, blue `#3366ff`). The client's original file had a JS quote bug that left pages blank; the copy in `/docs` is fixed. Old prototypes are not references. |

## 5. Build progress

- **Step 1 – done.** Monorepo, Prisma schema (45 tables), seed, tests.
- **Step 2 – done.** Auth (JWT + rotating refresh tokens with theft detection), tenancy, RBAC, audit log, rate limit.
- **Step 3 – done, approved.** App shell + `/ui-kit`.
- **Step 4 – done, approved.** Company & Office Setup, Settings screens; `GET /auth/me` replaces the stub user.
- **Step 5 – done, approved.** People + Employee 360, cost-rate history, Excel import, scoped/masked CSV export.
- **Step 6 – done, approved.** Clients and bookings API: confirmation rules, project code generation, configurable booking policy.
- **Step 6b – done, approved.** Booking screens and a temporary Home page (see below).
- **Step 7 – done, awaiting review.** Projects, Project 360, team, milestones, tasks, Kanban (see below).
- **Step 8 – done, awaiting review.** Shifts, punching, live board, register, regularisation, Excel export (see below).
- **Next: Step 9** – Leave.

### Step 8 – what exists

- **Rule engine** (`packages/shared/src/attendance/engine.ts`, pure and unit-tested): turns punches plus shift, weekly off, holiday, approved leave and policy into a day status (Present, Half day, Absent, Late, Leave, Holiday, Weekly off, Not in yet). Night shifts are attributed to the day the shift started; a day is settled 4 hours after the shift ends. Breaks are deducted after 5 hours; late marks convert to a half-day deduction at the policy's rate.
- **Punching:** mobile (GPS + selfie + geofence per office, `geofenceMode` FLAG or REJECT) and office network (IP allow-list). Double taps are guarded and punches take a row lock. Selfies are served only to users with attendance scope.
- **Screens:** Attendance (clock card, Today board, monthly Register with Excel export, Corrections), Shifts (weekly roster, templates with assignments), an Attendance tab on Employee 360, and the clock card on Home. Data scope applies everywhere (Team Lead sees only their team; out-of-scope is a 404).
- **Regularisation:** employee asks within 31 days; approver with `attendance.regularise` decides; approval writes an audited override.
- **Env vars:** `TRUST_PROXY` (number of trusted proxies, default 0 — office-IP punching trusts `X-Forwarded-For` only when a real proxy is set) and `JOBS_ENABLED` (BullMQ day-settling job, off in tests).
- **Policy wording:** the setting is now labelled "Half day from" (hours worked below this and above zero = half day; below full-day minimum is handled per policy).
- **Seed note:** demo data is anchored to Oct 2026, so days after that show as absent in demos.
- **To confirm with the client:** half-day tiers; a forgotten clock-out is held as a half day; the night shift has no policy in the seed; default geofence mode.

### Step 7 – what exists

- **Projects register** (`/projects`): KPI row, filters, sortable columns, task-progress and hours-burn bars; cost and margin columns only for `cost.view` / `margin.view`. Rows open **Project 360** (`/projects/:id`), a full page rather than the prototype's drawer so the board has room.
- **Project 360 tabs:** Overview, Booking & confirmation, Schedule (timeline + milestones), Team, Tasks (Kanban board and list). Time, Expenses and Cost ledger are placeholders until steps 10–12; the burn chart arrives with the ledger.
- **Rules enforced by the API:** a project outside the caller's data scope is a 404; a task can only be assigned to someone on the project team (or its PM); a milestone must fall inside the project dates; a team member with open tasks cannot be removed (they are given a `leftOn`, never deleted); tasks on a cancelled or completed project are read-only; a task with logged time cannot be deleted; an `OWN`-scoped role (Employee) may update only tasks assigned to them and cannot reassign.
- **Status changes** go through `POST /projects/:id/status` with an allowed-transition table; cancelling needs a reason and is audited. Cancelling a project leaves the booking record unchanged and the code reserved.
- **Kanban:** native drag-and-drop, optimistic with rollback; every card also has a status menu for keyboard use. Order is a clean 0..n per column, renumbered in a transaction on each drop.
- **Task files:** drawings, models, documents, sheets and images up to 25 MB; executables and scripts refused; always served as downloads.
- "Scheduled" (the last lifecycle stage) means the project has at least one milestone or task **and** at least one active team member.

### Step 6b – what exists

- **Clients:** list, add/edit drawer, detail drawer (contacts, recent bookings).
- **Bookings register:** KPI row, filters (status, client, office, type, confirmation, date range), sortable columns, "Email pending" and "Email overdue" badges. `GET /bookings/summary` feeds the KPIs and Home; `GET /bookings/lookups` supplies offices/project types to roles without `settings.view`.
- **Booking flow:** new booking drawer → booking drawer (lifecycle stepper, terms, proof, actions) → confirmation drawer (email upload or verbal note, optional PO) → confirm dialog with the project-code preview. Approval, attach-email-later and cancel (blocked once a project exists, pointing at the project) are dialogs on the booking drawer.
- **Home (temporary, `/`):** greeting, role, counts the user may see (employees, active bookings, projects, emails pending), a "Needs attention" list, and quick links to permitted modules. Unbuilt modules show "Coming in a later step". Replaced by the real dashboards in step 13.
- The code shown in the confirm dialog is a forecast, not a reservation: the number is taken at the moment of confirmation, so a concurrent confirmation can shift it by one.

Approved schema / design deviations:
- Ledger unique key `(sourceType, sourceId, projectId, postingVersion, isReversal)`; append-only, reopen writes a negative reversal row.
- `rateBreakdown` JSON on every labour posting (segments per contiguous rate); `rateApplied` only when one rate covers the posting.
- Running timer enforced by stored generated column `runningKey = IF(source='TIMER' AND endedAt IS NULL, employeeId, NULL)` + `UNIQUE(companyId, runningKey)`; `time_entries.employeeId` is ON DELETE RESTRICT; no `isRunning` column.
- `users.email` globally unique; `companies.codePrefix` globally unique.
- Type scale floor 11px (prototype's 8–10px fails WCAG AA); distinct lucide icons per menu; Phase 1 sidebar only (14 items).

## 6. Open items

- **MySQL keeps stopping** during sessions – check the `.err` log in the datadir and find the cause. Do not change MySQL config without asking.
- **Booking rules not yet confirmed by the client** – all are stored on `companies` and enforced by the API, with permissive defaults: `bookingCreateRoleIds`, `bookingConfirmRoleIds` (empty = the permission alone decides), `bookingRequiresApproval` (off), `verbalEmailGraceDays` (reminder only, never blocking). They are edited in **Settings → Bookings** (`GET/PUT /settings/booking-policy`).
- **Still to confirm with the client:** exact project code format and project type list; whether "schedule" means milestones only or a Gantt.
- Payroll depth, Zoho accounting scope, desktop monitoring and biometric device are later-phase questions.

## 7. Working rules

- Build only Phase 1. Reference files show the full future product; use them for look and layout, not scope.
- Stop at review gates and summarise before moving on.
- Business rules live in the database where possible, with tests.
