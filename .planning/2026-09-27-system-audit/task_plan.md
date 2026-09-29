# Task Plan — Complete System Audit (Dental-Clinic-Management)

## Goal
Evidence-based audit of the entire app (React+Vite+Tauri, SQLite/sql.js) producing a full diagnosis.
NO CODE MODIFICATIONS during audit. Deliverable: audit report + prioritized remediation roadmap awaiting user approval.

## Constraints (from master prompt)
- Inspect first, verify from source, trace UI→validation→state→service→DB→UI.
- No fixes during audit. No rewrite. Preserve existing business rules.
- Financial modules = high-risk, extra scrutiny (invoices, payments, ledger).

## Phases
1. [complete] Phase 0 — Planning files + repo structure map
2. [complete] Phase 1 — Frontend/backend/IPC/DB surface discovery (Tauri commands, CSP, entry points)
3. [complete] Phase 2 — DB & persistence audit (migrations, repos, syncCore, persistence, legacy service)
4. [complete] Phase 3 — Services & business-logic audit (financeDomain, backup, update, QC, SLA)
5. [complete] Phase 4 — State/auth/authorization audit (AppContext, hooks, roles, sessions)
6. [complete] Phase 5 — UI surface audit (views, forms, tabs, tables, nav, settings)
7. [complete] Phase 6 — Runtime probes (console, sync errors, update-check spam) + tests inventory
8. [complete] Phase 7 — Write audit report (docs/audit/), grade SPEC/DESIGN/CORRECTNESS/QUALITY, roadmap
9. [complete] Phase 8 — Deliver report, await approval before any implementation phase

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| (none yet) | | |

## Result
Report delivered: docs/audit/2026-09-27-system-audit.md. Scores SPEC 7 / DESIGN 4 / CORRECTNESS 6 / QUALITY 6. Top recommendation: wire invoice journals + extract recordPayment domain layer (P0.1). Awaiting user approval before implementation.
