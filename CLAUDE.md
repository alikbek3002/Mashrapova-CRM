# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ERP for «Академия Машрапова», a martial arts gym in Osh (boxing, MMA, freestyle wrestling, judo, kickboxing, taekwondo + fitness zone). The engine is forked from Uniqum Sport ERP and is being adapted. Spec: `docs/ТЗ_Академия_Машрапова.md`; adaptation plan and status: `docs/План_адаптации_Машрапова.md` (the `docs/ТЗ_00…03` files describe the Uniqum engine and are reference only). Multi-role PWA with three personas: **Admin** (desktop), **Coach** (PWA), **Parent** (PWA). Fully bilingual: Russian (ru) and Kyrgyz (ky). Data is never deleted, only archived (DB trigger `forbid_delete`).

## Commands

```bash
# Development
cd frontend && npm run dev       # Dev server at http://localhost:5173

# Build
cd frontend && npm run build     # TypeScript check + Vite production build

# Preview production build
cd frontend && npm run preview

# Backend (Claude usage tracking)
node Back/server.js              # API at http://localhost:3001
```

No test framework is configured.

## Architecture

The entire application is a single-page React app. Role and language state live in `App.tsx` and are passed down. `localStorage` persists the active role, language, and card style.

**Entry points:**
- [frontend/src/App.tsx](frontend/src/App.tsx) — root component; contains the role switcher (Admin/Coach/Parent), language switcher (RU/КЫ), settings panel (gear icon for card style), and renders the correct screen per role
- [frontend/src/AdminDashboard.tsx](frontend/src/AdminDashboard.tsx) — wraps the admin sidebar nav and routes to the correct admin page component
- [frontend/src/CoachScreen.tsx](frontend/src/CoachScreen.tsx) — coach PWA screen (attendance marking, group tabs)
- [frontend/src/ParentScreen.tsx](frontend/src/ParentScreen.tsx) — parent PWA screen (schedule, payments)
- [frontend/src/IOSFrame.tsx](frontend/src/IOSFrame.tsx) — renders the iOS device frame wrapper used for PWA previews

**Admin pages** live in [frontend/src/admin/](frontend/src/admin/):
`Dashboard`, `Kids`, `Parents`, `Schedule`, `Cards`, `Freezes`, `Payments`, `Leads`, `Churn`, `Coaches`, `Sections`, `Settings`, `ClaudeUsage`, `common`

**Shared data layer** — [frontend/src/data.tsx](frontend/src/data.tsx) is the single source for:
- All TypeScript types (`Lang`, `Role`, `CardStyle`, `SectionId`, `AttStatus`, `LeadStage`, `Bilingual`, etc.)
- Mock data (students, coaches, schedules, payments, leads)
- The `I18N` object: complete Russian + Kyrgyz translation strings for every role
- SVG icon components

**Styles** — [frontend/src/styles.css](frontend/src/styles.css) defines the design system via CSS custom properties. No CSS preprocessor.

## Key Types

```ts
type Lang = "ru" | "ky"
type Role = "admin" | "coach" | "parent"
type CardStyle = "default" | "flat" | "bordered"
type SectionId = "sg" | "rg" | "ag" | "eg" | "ka" | "ed"  // six sports sections
type AttStatus = "present" | "absent" | "excused" | "late" | "makeup"
type LeadStage = "new" | "trial" | "waiting"
type Bilingual = { ru: string; ky: string }
```

## Design System

Colors, spacing, and typography are CSS custom properties in `styles.css`. Key tokens:
- `--bg`, `--surface`, `--ink`, `--muted`, `--line` — neutrals
- Brand colors: `--blue-*`, `--yellow-*`, `--red-*`, `--green-*` (oklch color space)
- Section tints: each of the 6 `SectionId` values has a unique hue variable
- Fonts: `--font-sans` (Manrope), `--font-display` (Unbounded), `--font-mono` (JetBrains Mono)
- Border radius: `--r-xs` (8px) → `--r-xl` (24px)

## Backend

[Back/server.js](Back/server.js) is a minimal Node.js HTTP server (port 3001) with one endpoint:
- `GET /api/claude-usage` — reads Claude CLI JSONL logs from `~/.claude/projects/`, computes token costs per model, and returns usage metrics. Consumed by the `ClaudeUsage` admin page.

Vite proxies `/api` → `http://localhost:3001` during development.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
