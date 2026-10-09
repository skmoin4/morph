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
- **Next: Step 4** – Company & Office Setup, Settings; replace the stubbed user in `App.tsx` with `GET /auth/me`.

Approved schema / design deviations:
- Ledger unique key `(sourceType, sourceId, projectId, postingVersion, isReversal)`; append-only, reopen writes a negative reversal row.
- `rateBreakdown` JSON on every labour posting (segments per contiguous rate); `rateApplied` only when one rate covers the posting.
- Running timer enforced by stored generated column `runningKey = IF(source='TIMER' AND endedAt IS NULL, employeeId, NULL)` + `UNIQUE(companyId, runningKey)`; `time_entries.employeeId` is ON DELETE RESTRICT; no `isRunning` column.
- `users.email` globally unique; `companies.codePrefix` globally unique.
- Type scale floor 11px (prototype's 8–10px fails WCAG AA); distinct lucide icons per menu; Phase 1 sidebar only (14 items).

## 6. Open items

- **MySQL keeps stopping** during sessions – check the `.err` log in the datadir and find the cause before step 4. Do not change MySQL config without asking.
- **To confirm with client** (keep these configurable until then): who can create / confirm bookings and whether booking needs approval; exact project code format and project type list; whether a verbal booking must later get an email; what happens to a project if a booking is cancelled; whether "schedule" means milestones only or a Gantt.
- Payroll depth, Zoho accounting scope, desktop monitoring and biometric device are later-phase questions.

## 7. Working rules

- Build only Phase 1. Reference files show the full future product; use them for look and layout, not scope.
- Stop at review gates and summarise before moving on.
- Business rules live in the database where possible, with tests.
