# OPSVERA — Business Operations OS (Phase 1)

One connected system that takes an engineering project **from booking to live cost**:
booking → confirmation → project code → project → schedule → attendance → time →
approval → project cost → dashboard.

## Repository layout

```
apps/
  api/                NestJS 10 REST API, Prisma, MySQL 8
    prisma/           schema.prisma, migrations, seed
    src/              modules, guards, jobs
  web/                React 18 + Vite + Tailwind PWA
packages/
  shared/             Zod schemas, enums, permission catalogue, money/date utils
docs/                 Client reference material (prototype, scope, screenshots)
```

`packages/shared` is the contract between the two apps — every enum, permission key
and validation rule lives there once and is imported by both.

## Prerequisites (Windows + Laragon)

| Service  | Where               | Notes                        |
| -------- | ------------------- | ---------------------------- |
| Node 20+ | —                   | Verified on Node 24          |
| pnpm 9   | —                   | `npm i -g pnpm`              |
| MySQL 8  | Laragon → Start All | Database `opsvera`, utf8mb4  |
| Redis    | Laragon → Start All | Port 6379, used by BullMQ    |
| Mailpit  | Laragon             | SMTP on 1025, web UI on 8025 |

No Docker required.

## First-time setup

```bash
pnpm install
cp .env.example .env          # already done; adjust DATABASE_URL if MySQL has a password
```

Create the database once (Laragon ships MySQL with a password-less `root`):

```bash
mysql -u root -e "CREATE DATABASE IF NOT EXISTS opsvera CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

Then:

```bash
pnpm db:migrate               # apply Prisma migrations
pnpm db:seed                  # company, offices, roles, demo data
pnpm dev                      # API on :4000, web on :5173
```

- API: http://localhost:4000/api/v1
- Swagger: http://localhost:4000/api/docs
- Web: http://localhost:5173

## Scripts

| Command           | What it does                            |
| ----------------- | --------------------------------------- |
| `pnpm dev`        | Runs API and web together via Turborepo |
| `pnpm build`      | Builds every package                    |
| `pnpm lint`       | ESLint across the monorepo              |
| `pnpm typecheck`  | `tsc --noEmit` everywhere               |
| `pnpm test`       | Jest (API) + Vitest (web, shared)       |
| `pnpm db:migrate` | `prisma migrate dev`                    |
| `pnpm db:seed`    | Seeds demo data                         |
| `pnpm db:studio`  | Prisma Studio                           |

All Prisma scripts read the single root `.env` through `dotenv-cli`.

## Non-negotiable conventions

- **Money** is `Decimal(15,2)` in MySQL and `decimal.js` in code. Never a float.
  It crosses JSON as a 2-dp **string**.
- **Time** is stored in UTC. Attendance days, timesheet weeks and holidays are
  evaluated in the **office's** time zone, which is why office-local calendar
  values are `@db.Date` columns and shift times are `"HH:mm"` strings.
- **Tenancy**: every business table carries `companyId`, and a Prisma client
  extension injects it into every read and write. No query may bypass it.
- **Validation**: every API input is parsed by a Zod schema from
  `packages/shared`. The same schema drives the form on the web side.
- **Lists** are always paginated (`?page=&pageSize=`), sortable (`?sort=field:asc`)
  and filterable.
- **Errors** use one shape: `{ code, message, details? }`.

## Build progress

| Step | Scope                                                       | Status |
| ---- | ----------------------------------------------------------- | ------ |
| 1    | Monorepo, env, Prisma schema, shared Zod package, lint/test | Done   |
| 2    | Auth, tenancy extension, RBAC, audit log                    | Done   |
| 3    | App shell + `/ui-kit` (review gate)                         | Done   |
| 4    | Company & office setup, settings, real auth                 | Done   |
| 5    | Employees, Employee 360, cost-rate history, Excel import    | Done   |
| 6    | Clients, bookings, project code generation                  | Done   |
| 7    | Projects, schedule, tasks, Kanban, Project 360              | Next   |
| 8    | Shifts, attendance (mobile + office punch, rule engine)     | —      |
| 9    | Leave                                                       | —      |
| 10   | Timer & timesheets with approvals                           | —      |
| 11   | Expenses, two-step approval                                 | —      |
| 12   | Cost ledger posting, budget alerts                          | —      |
| 13   | Dashboards and reports                                      | —      |
| 14   | Notifications and reminders                                 | —      |
| 15   | PWA, responsive polish, accessibility                       | —      |
| 16   | Test pass (unit + e2e core flow)                            | —      |

## Signing in (seeded accounts)

Every seeded account uses the password `Opsvera@2026`.

| Email                               | Role            | Sees                                 |
| ----------------------------------- | --------------- | ------------------------------------ |
| `rajesh.deshmukh@morengineering.in` | CEO / Director  | Everything, all offices              |
| `priya.kulkarni@morengineering.in`  | HR / Admin      | People, attendance, leave, setup     |
| `anil.joshi@morengineering.in`      | Finance         | Expenses, cost ledger, money reports |
| `sameer.patil@morengineering.in`    | Project Manager | His projects                         |
| `vikram.rane@morengineering.in`     | Team Lead       | His team                             |
| `amit.chavan@morengineering.in`     | Employee        | His own work only                    |

## How tenancy works

Every business table carries `companyId`, and a Prisma client extension injects
it into every read and write. The company comes from an AsyncLocalStorage scope
that the request-context middleware opens and the JWT guard fills in once the
token is verified.

- Application code uses `prisma.scoped` — automatically company-filtered.
- Infrastructure that genuinely spans companies (the seeder, login before the
  company is known, nightly jobs) wraps its work in `runUnscoped()`.
- A scoped query with neither throws rather than returning another company's
  rows. There is no way to "forget" the filter.

## Permissions

Three levels, all enforced in the backend:

1. **Module access** — which menus a role can open.
2. **Action access** — `module.action` keys (`booking.confirm`,
   `timesheet.approve`), checked by a global guard from `@RequirePermissions()`.
3. **Data scope** — `OWN | TEAM | PROJECT | OFFICE | ALL`, applied as a query
   filter by `DataScopeService`.

On top of that, **field masking** strips salary, cost rate, project value and
margin from every response unless the caller holds `salary.view`, `cost.view`,
`project.value.view` or `margin.view`. It runs as a global interceptor, so a new
endpoint is protected by default rather than by remembering to narrow its
`select`.

## Screenshots while developing

`tools/shot.mjs` drives headless Chrome over the DevTools Protocol using Node's
built-in WebSocket — no Playwright or Puppeteer download, nothing in the
lockfile. It can sign in and capture an authenticated screen:

```bash
node tools/shot.mjs --url http://localhost:5173/login --out shot.png   --type "input[type=email]::rajesh.deshmukh@morengineering.in"   --type "input[type=password]::Opsvera@2026"   --click "button[type=submit]" --wait 3000   --goto "http://localhost:5173/settings?tab=offices" --wait 2000
```

Steps run in the order given. `--type` splits on `::`, because a CSS selector
such as `input[type=email]` already contains `=`.

## Testing

```bash
pnpm test                       # unit + integration (all packages)
pnpm --filter @opsvera/api test:e2e
```

API tests run against a **separate database** — the development one with a
`_test` suffix — which is created and migrated automatically before each run.
