# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ERP for «Академия Машрапова», a martial arts gym in Osh, Kyrgyzstan (boxing, MMA, freestyle
wrestling, judo, kickboxing, taekwondo + a fitness zone). ~525 active clients, ~200 new leads a
month, ~15 coaches, one branch (the schema is multi-branch ready).

The engine was forked from Uniqum Sport ERP (a kids' sports centre in Bishkek) and adapted.
**The product focus here is the sales funnel and retention**, not facility operations: chasing
Instagram leads within a 10-minute SLA, converting trials, and keeping existing clients from
churning. There is **no access control of any kind** — no turnstiles, no Face ID, no biometrics, no
door terminals. Those tables and columns were dropped in
`supabase/migrations/20260924000001_drop_access_control.sql`; the earlier migrations that created
them stay only so history replays. Never reintroduce them.

Data is never deleted, only archived — enforced by the `forbid_delete` DB trigger.
Fully bilingual: Russian (ru) and Kyrgyz (ky).

### Documentation map

| Document | What it is |
|---|---|
| `docs/ТЗ_Академия_Машрапова.md` | **The spec.** Single source of business rules. All `§N` references point here |
| `docs/План_адаптации_Машрапова.md` | Adaptation log and current status per spec section, plus open questions to the client |
| `docs/ТЗ_00_Общие_требования.md` | Shared: stack, architecture, data model, security, acceptance |
| `docs/ТЗ_01_Admin.md` | Admin panel |
| `docs/ТЗ_02_Coach.md` | Coach PWA |
| `docs/ТЗ_03_Parent.md` | Parent PWA (spec-wise a v2.0 product; already built) |
| `DEPLOY.md` | Production deploy runbook |

Read `План_адаптации_Машрапова.md` before changing business logic — it records why several rules
deviate from the literal spec text and which decisions the client already confirmed.

## Commands

```bash
# Frontend
cd frontend && npm run dev       # Vite dev server at http://localhost:5173
cd frontend && npm run build     # tsc -b + production build
cd frontend && npm run preview

# Backend (Fastify API)
cd backend && npm run dev        # http://localhost:3001 (reads .env)
cd backend && npm run typecheck
cd backend && npm run build && npm start

# Migrations + spec smoke tests (real Postgres from an npm package, no Docker)
cd supabase/test && npm run migrate   # apply every migration in order
cd supabase/test && npm run smoke     # spec calculations (payroll, refunds, freeze quota, ...)
cd supabase/test && npm run tariffs   # per-tariff lesson share and coach pay
```

There is no unit-test framework. `supabase/test/` is the only automated check — run `npm run migrate`
and `npm run smoke` after touching migrations or money logic.

```bash
# Knowledge graph (see the graphify section at the bottom of this file)
graphify extract . --code-only            # rebuild from scratch: TS + SQL, local AST, ~15s
graphify extract . --backend claude-cli   # also re-read the docs (ТЗ) semantically, ~2 min
graphify update .                         # incremental, after code edits
graphify label . --backend=claude-cli     # refresh community names after a big refactor
```

Two things specific to this repo when querying the graph:
- **Query with symbol names, not Russian prose.** Node labels are code identifiers, so
  `graphify query "compute_coach_payroll v_payroll_attendance"` anchors correctly while
  «как считается зарплата тренера» starts the traversal on unrelated migrations.
- **SQL edges are `reads_from`, not `calls`.** For a view or function use
  `graphify affected "v_payroll_attendance" --relation reads_from`; the default relation set is
  TypeScript-shaped and returns nothing for SQL.

## Architecture

Single React SPA serving three personas; the role comes from the user's `profiles` row after login.

**Entry points:**
- `frontend/src/App.tsx` — root: auth gate, MFA gate, language switch, renders the screen for the role
- `frontend/src/AdminDashboard.tsx` — admin sidebar (permission-filtered) + lazy-loaded page per nav item
- `frontend/src/CoachScreen.tsx` — coach PWA (today, attendance journal, tabel, groups, salary, PT)
- `frontend/src/ParentScreen.tsx` — parent PWA (overview, schedule, card, deposit, attendance, notes)

No router: the active screen is component state. No form library and no client-side zod — forms are
hand-rolled in `shared/ui/forms.tsx`; validation lives in the backend (`backend/src/schemas/`, zod)
and in DB constraints.

**Admin pages** — `frontend/src/admin/`:
`Dashboard`, `Kids`, `Parents`, `Schedule`, `Cards`, `PersonalTrainings`, `Payments`, `Debtors`,
`Freezes`, `Refunds`, `Leads`, `Reports`, `Coaches`, `CoachRates`, `Payroll`, `Sections`, `Groups`,
`Users`, `Archive`, `Settings`, plus `ChildDrawer` / `GroupDrawer` / `GroupTabelModal` and `common.tsx`.

**Shared layer** — `frontend/src/shared/`:
- `api/` — Supabase client, queries, mutations, backend API client, PT queries
- `auth/` — `AuthProvider`, `Login`, `Gate`, `MfaGate`, `rbac.ts` (permission matrix mirroring ТЗ §2.2)
- `offline/` — write queue (`outbox.ts`, `ops.ts`) + `OfflineBar`
- `types/database.ts` — generated Supabase types
- `ui/` — `Shell`, `Modal`, `forms`, `AttendanceGrid`, `toast`, avatars

`frontend/src/data.tsx` holds the `I18N` object (full ru + ky strings) and icon helpers. It is no
longer a mock-data module — live data comes from Supabase.

**Backend** — `backend/src/` (Fastify + TypeScript, `service_role` Supabase client). Handles only
what cannot be trusted to the client: card sales, payments, refunds, deposits, freezes approval,
payroll, bulk schedule operations, notifications dispatch/broadcast, staff management, uploads,
and `POST /v1/lifecycle/refresh` (the §4.5 and §8.3 scheduler entry point). Everything else reads
from Supabase directly under RLS. Idempotency via the `Idempotency-Key` header on money routes.

**Database** — `supabase/migrations/` (95 migrations). Business calculations live in SQL as the
single source of truth: `v_child_card_balance`, `v_payroll_attendance`, `section_price()`,
`manager_kpi()`, `director_dashboard()`, `refresh_card_notices()`, `refresh_lead_sla()`,
`refresh_lifecycle()`, plus report functions. Do not reimplement these on the client.

**Styles** — `frontend/src/styles.css`, CSS custom properties, no preprocessor.

## Invariants — do not break these

- **No deletes.** `forbid_delete` blocks DELETE on accounting tables. Archive instead.
- **Money is `numeric(12,2)`**, never float.
- **Money routes are backend-only** and idempotent; the idempotency key is created when an operation
  is *queued* (offline outbox), not when it is sent.
- **Freeze quota** is enforced by a DB trigger (`fn_check_freeze_quota`), not in the backend —
  freezes can be created by three different paths.
- **Coach pay fields** are guarded by `forbid_coach_pay_change` (director/manager only).
- **RBAC exists in three places** — Postgres RLS helpers, backend `requireRole`, frontend `rbac.ts`.
  `rbac.ts` also carries `TZ_MATRIX` + `auditRbacAgainstTz()`, which logs drift from ТЗ §2.2 in dev.
  Two deliberate exceptions are recorded in `TZ_EXCEPTIONS` with reasons.
- **Both languages.** Every new user-facing string needs ru and ky.

## Design System

Colors, spacing and typography are CSS custom properties in `styles.css`:
- `--bg`, `--bg-soft`, `--surface`, `--ink`, `--ink-2`, `--muted`, `--line` — neutrals
- Brand: `--blue-*`, `--yellow-*`, `--red-*`, `--green-*` (oklch)
- Fonts: `--font-sans` (Manrope), `--font-display` (Unbounded), `--font-mono` (JetBrains Mono)
- Radius: `--r-xs` (8px) → `--r-xl` (24px)

Note: `--dir-*` and `--sec-*` section tints are leftovers from the Uniqum section set (ЛФК,
gymnastics) and are no longer referenced from TSX — do not build new UI on them.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
