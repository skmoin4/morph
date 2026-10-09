# App shell & UI kit — review before modules

**Status:** awaiting sign-off. No module screens have been built.
**Live at:** http://localhost:5173/ui-kit (`pnpm dev`)
**Compare with:** `OPSVERA_Fully_Openable_Interactive_Product.html` and `docs/screens/*.png`

Every token is lifted from the prototype's own CSS, not eyeballed from the
screenshots. The values below are quoted from the prototype stylesheet.

## Tokens taken verbatim

| Token | Prototype value | Where it is used |
| --- | --- | --- |
| Sidebar | `linear-gradient(180deg,#0d1526,#111b31)` | `bg-nav-gradient` |
| Active nav item | `linear-gradient(90deg,rgba(51,102,255,.25),rgba(21,184,214,.08))` + `1px rgba(91,140,255,.22)` | `bg-nav-active` |
| Nav hover | `#16233a` | `bg-nav-hover` |
| Nav text / labels | `#a8b5ca` / `#667c9d` | `text-nav-text`, `text-nav-label` |
| Brand mark | 36px, radius 11px, `linear-gradient(135deg,#3366ff,#15b8d6)`, `0 8px 24px rgba(51,102,255,.33)` | `BrandMark` |
| Top bar | 72px, `rgba(255,255,255,.9)`, `backdrop-filter: blur(12px)` | `TopBar` |
| Search box | 40px, `min(470px,40vw)`, radius 11px | `TopBar` |
| Button | 38px, radius 10px, border `#e5eaf1` | `rounded-control` |
| Button hover | `translateY(-1px)`, `0 5px 12px rgba(15,23,42,.08)` | `Button` |
| Primary button | `#3366ff`, `0 8px 18px rgba(51,102,255,.2)` | `shadow-btn-primary` |
| Panel | radius 17px, `0 8px 28px rgba(15,23,42,.07)` | `rounded-panel`, `shadow-card` |
| Card | radius 15px, `0 5px 15px rgba(15,23,42,.035)` | `rounded-card`, `shadow-card-soft` |
| Table header | uppercase, `letter-spacing .07em`, `#7d8a9f` | `DataTable` |
| Row hover | `#f8fbff` | `DataTable` |
| Pills | radius 999px; green `#eaf8f1/#13794f`, amber `#fff4e7/#b6690a`, red `#fdebec/#b83236`, blue `#eef3ff/#315cc7`, gray `#eef1f5/#607088` | `pill-*` |
| Progress | 6px, track `#eef1f6`, fill `blue→cyan`, risk `amber→#ff7a45` | `bg-progress-fill` / `-risk` |
| Avatar | 38px, `linear-gradient(135deg,#dce7ff,#caf5fb)`, `#254da9` | `bg-avatar-gradient` |
| Timer | `linear-gradient(135deg,#101b34,#183261)` | `bg-timer-gradient` |

No component contains a hard-coded hex. Everything resolves through
`tailwind.config.ts`.

## What is in the kit

**Layout** — `AppShell`, `Sidebar` (collapsible, drawer on mobile), `TopBar`
(search, running timer, Quick Action, bell with unread badge, avatar menu),
`PageHeader` (eyebrow / title / subtitle / actions), `MobileNav` (bottom bar).

**Components** — `Button` (5 variants × 3 sizes, loading, icons), `IconButton`,
`Pill` / `StatusPill`, `Panel` / `PanelLink` / `Card` / `ListItem`,
`MetricCard` / `MetricRow`, `Progress`, `DataTable` (TanStack, sticky header,
sortable, clickable rows, skeletons), `Drawer`, `Dialog` / `ConfirmDialog`,
`EmptyState`, `Skeleton`, `Tabs`, `Avatar`, `Stepper`, and form fields
(`TextField`, `TextAreaField`, `SelectField`) with inline validation.

**Command palette** — ⌘K / Ctrl+K, searches navigation plus quick actions,
arrow-key navigation with wrap, Enter to run, Escape to close. Only shows what
the user's permissions allow.

## Three deviations that need your call

**1. Type scale lifted.** The prototype runs 8–12px (pills at 8.5px, panel
subtitles at 9px, table cells at 10px). Those are mock sizes and the smallest
fail a readability bar — 8.5px pill text is not legible to most people and would
not pass the WCAG AA line in the brief. The scale is lifted while keeping the
hierarchy and the step between levels:

| Role | Prototype | Here |
| --- | --- | --- |
| Pills, micro labels | 8.5–9px | 11px |
| Panel subtitle, table sub-line | 9px | 12px |
| Table cell, body | 10px | 13px |
| Panel title | 12px | 14px |
| Big metric | 24px | 28px |
| Page title | — | 34px |

Everything is proportionally larger, so the layout reads the same at a glance —
compare the screenshots. **Say the word if you want an exact 1:1 match instead.**

**2. Sidebar icons.** The prototype uses one generic outlined square for every
item (`.nav .ico`). This uses distinct `lucide-react` icons per item, which is
what the brief's stack specifies and makes a 14-item sidebar scannable. The
container size (17px) and opacity (.9) match the prototype.

**3. Phase 1 sidebar only.** 14 items in 6 groups, exactly as scoped. The
prototype's Leads, Opportunities, Proposals, Invoices, Payroll, Screenshots,
Apps & URLs, Resources, Activity and AI COO are **not** built — the prototype
shows the full future product and the brief says to use it for look, not scope.

## Quality bar

- **Keyboard** — drawer and dialog trap focus and restore it on close; Escape
  closes both; clickable table rows are focusable and respond to Enter/Space;
  the palette is a proper `combobox` + `listbox` with `aria-activedescendant`.
- **Screen readers** — icon-only buttons require a `label` prop (it is not
  optional); skeletons are `aria-hidden` with a separate live region;
  `Progress` reports its real value even when over 100%; sort state is on
  `aria-sort`.
- **Focus rings** — visible on `:focus-visible` only, with a dark-surface
  variant so the ring does not read as a white halo on the sidebar.
- **Motion** — everything respects `prefers-reduced-motion`.
- **Responsive** — verified at 1440px and at phone width: sidebar becomes a
  drawer, metrics go 6 → 3 → 2, the bottom nav appears, the Quick Action label
  collapses to its icon.
- **PWA** — installable; the service worker is generated and excludes `/api`.

## Tests

23 component tests covering: loading buttons blocking clicks, the status-tone
map, drawer focus trap and Escape, confirm dialog, progress semantics, sidebar
permission filtering, and the command palette's filtering, permission gating and
keyboard navigation.

```
pnpm --filter @opsvera/web test
```

## Two things to note

1. **The signed-in user is still stubbed.** `App.tsx` hands the shell a fixed
   name and the full permission set. Everything the shell renders already reads
   from that permission set, so swapping the stub for `GET /auth/me` is a
   one-file change — it lands in step 4 with the first real module.
2. **Sidebar items route to placeholders**, each naming the step it arrives in,
   so nothing in the nav is a dead link during the build.
