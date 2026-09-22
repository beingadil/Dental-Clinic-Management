# QC module — what shipped vs. what was designed

Four radically different designs were produced for the QC interface (see the other
files in this folder), then compared. The implementation is a deliberate synthesis —
small command surface, append-only facts, dominant path first — recorded here so the
trade-offs are traceable.

## Shipped interface

```ts
// useApp()
qcInspections: QcInspection[];
recordQcCase(command: QcCommand): QcReceipt;   // the ONLY write path
getQcState(caseId: string): QcCaseState;       // derived, never stored
getQcMetrics(): QcMetrics;                     // derived, em-dash-safe when empty
```

```ts
// one call for the 90% case — no ceremony, nothing mandatory
recordQcCase({ action: 'record', case_id, result: 'pass' })
recordQcCase({ action: 'record', case_id, result: 'fail', reason_code: 'occlusion', notes: '...' })

// a mistake is amended, never mutated
recordQcCase({ action: 'correct', id: inspectionId, result: 'pass' })
```

## Which design contributed what

| Element | Source design | Why it won |
|---|---|---|
| Append-only `qc_inspections` with `UNIQUE(dedupe_key)` | Design 4 (append-only stream) | Idempotent under retry and the syncCore DELETE+INSERT rebuild; audit trail is free; corrections replace mutation. |
| `record` / `correct` union command (one write entry point) | Design 1 (minimal surface) | Rules, derivation, notifications and status moves all hide behind one call. |
| One-click `Pass QC` + reason-code `Fail QC` | Design 3 (common case first) | The bench flow needs zero mandatory text; failure reasons stay structured for analytics. |
| Derived `QcCaseState` / `QcMetrics` (nothing cached) | Design 4 + Design 1 | No dual-write drift; KPIs always agree with the stream. |
| Gate inside `updateCase` (refuse `ready`/`delivered`) | Design 3 + brief R3 | The rule lives in the single case-writer, so no caller can bypass it. |
| Per-case history list + inspector tally | Design 2 (max flexibility) | Traceability, without adopting the full checklist-template machinery yet. |

## Refused (for now)

- Configurable inspection checklists per restoration type, quorum approvals and
  waiver workflows (Design 2) — real value, but they change *what* QC means per case
  type; deferred until the catalog has a quality-spec concept.
- Per-tooth findings — the case already carries per-tooth clinical detail; a QC finding
  can reference it later via `reason_text`/attachments without a new table.
- Storing derived state — always cheaper to recompute from a few hundred rows than to
  keep two truths.

## Verification (executed, not assumed)

- `npm run lint` (`tsc --noEmit`, strict): **passes**.
- `tests/services/qc.test.ts` — 15/15 pass; `tests/db/qc.test.ts` — 8/8 pass
  (executed against the real engine/repos via a CommonJS compile + node, because the
  esbuild native binary hangs in this sandbox, which also blocks `vitest`/`vite`).
- 18/18 end-to-end checks against a migrated in-memory database: migration 005 applied
  and idempotent, insert/read-back, duplicate `dedupe_key` refused, CHECK rejection,
  FK cascade delete, correction superseding, gate/metric derivation.
- Two defects were found and fixed by that evidence: corrections were dropped instead of
  amending the row, and `computeQcMetrics` scoped case counts but not event tallies.

## Known limits / next decisions for the owner

1. `npm test` and `npm run build` could not be executed here (esbuild binary hangs →
   vitest/vite cannot boot). Run them on a machine where CI passes before release.
2. A QC pass can currently be overwritten by a later failure (new inspection), but a
   `correction` is restricted to Super-Admin-level judgement only by policy, not by code.
3. Legacy cases imported as `delivered`/`ready` have no QC record; the gate only
   applies when a status *transition* is attempted, so historical data is untouched.
