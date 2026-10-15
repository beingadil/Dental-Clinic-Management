# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The product ships as a Windows desktop installer (Tauri wrapper) and also runs
in a browser against the same code. The design language is `web`: a native
wrapper around a web application does not make that design language native.

## Users

A single operator, usually solo, who does everything: bench work, front desk,
and the books. They are the technician charting teeth and the owner chasing
overdue invoices, in the same session, on the same machine.

Consequences that follow from this and should not be re-derived:

- One person holds every context, so continuity between screens matters more
  than role-based tailoring. There is no "switch to my technician view".
- Switching between modes is itself a tax. Anything that removes a mode switch
  is worth more than anything that adds one.
- There is no second pair of eyes. Nothing important can depend on someone else
  noticing a problem later.

## Product Purpose

Run a dental laboratory end to end on one local machine: receive a case from a
clinic, chart exactly which teeth and which shade, move it through a production
workflow under an SLA, print the job slip the bench works from, and bill the
clinic for it.

Success means the operator can answer "what needs me right now, and what is
late?" without leaving the dashboard, and can raise a correct invoice without
thinking about invoicing.

## Positioning

Invoicing is not a separate authoring step. An invoice is raised for you at the
moment a case is registered, priced from the clinic's agreed rate for that
material, and it stays bound to the case for the rest of its life. A neighboring
case-management or invoicing product would make the user re-enter the case into
a second system and keep the two in sync by hand.

The second structural commitment: a case's identity is its **charted teeth and
shade**, not a free-text description. Pricing multiplies by charted units, the
job slip prints the teeth, the invoice prints the teeth, and the chart is the
thing that drives all three. That is what makes a printed slip trustworthy
against the case it came from.

## Operating Context

- **Small, older screens.** The lab's machines are 1366px-class or smaller.
  Designs that assume 1920px are not usable; horizontal space is the scarcest
  resource on this product.
- **One operator, many hats.** Bench, front desk and management in one session.
- **Local-first.** The database is SQLite in the browser/WASM process. The app
  must be fully usable with no network, and must never make the operator wait
  on a sync to see their own data.
- **Printed output is a first-class deliverable**, not an export. Job slips and
  invoices go to a lab printer and are read by a technician who is not looking
  at the screen.
- **Real dental vocabulary.** FDI tooth numbering, shade selection, restoration
  types, SLA and priority, bench routing. Terminology must not be genericised.
- **Money is real money.** PKR amounts, receivable balances, payment allocation
  across invoices.

## Capabilities and Constraints

Confirmed capabilities:

- Case intake with FDI odontogram charting, per-tooth shade, restoration type and
  material; a shade chosen once applies to the whole selection.
- Per-tooth vs not-per-tooth products. A retainer has no teeth and is not
  charted, appears on no slip and no invoice as teeth.
- Configurable material catalog with operator-managed categories.
- Configurable, global SLA turnarounds per case priority, applied to every case.
- Production workflow: received → in production → QC → ready → dispatched.
- Automatic invoicing on case registration; payments and receivable balances.
- Print subsystem with per-document section toggles, and saved print settings.
- Backups with a verifiable manifest, and a restore drill.

Binding technical constraints that any future design work must respect:

- **Colour tokens are generated, not hand-written.** `--color-ink-*` and
  `--color-ds-*` role primitives are produced by `scripts/role-picker.mjs`, and
  CI (`npm run role:check`) fails the build if they are edited by hand. Hand-edit
  failures are silent: the utility falls through to the raw palette and the
  solved token never paints.
- **Contrast is enforced by CI.** `scripts/contrast-audit.mjs` grades every
  bg>text pairing the app actually renders in both themes and every interaction
  state; a second scan catches ink sitting on an inherited dark bar. New UI that
  fails either is not shippable.
- Dark mode is a working requirement, not a preference.

Open decisions, recorded rather than invented:

- Whether print output should ever be designed as a first-class visual surface
  in its own right, or always remain subordinate to the on-screen design.

## Brand Commitments

**This product is white-label.** Each lab sets its own practice name, logo,
tagline and accent colour, and those values are applied to invoices, job slips
and the app chrome.

The practical consequence, which is the single most important constraint on any
visual work: **no design decision may assume a chosen accent colour.** An
arbitrary colour chosen by an operator will be applied to accent surfaces, so
contrast has to be solved structurally — per-swatch tint sets and semantic
tokens that resolve to safe readings — rather than by selecting pleasant hex
values once.

"Dental Solutions" is the shipped default seed, not a commitment.

## Evidence on Hand

- Real operating data exists in the local database: live cases, clinics,
  invoices and payment records.
- A seeded material catalog with real dental products, prices and SLA values.
- A print corpus (job slips, invoices, statements) with a section-toggle system.
- An installer pipeline that ships and auto-updates over GitHub releases.

State absences future work must not fabricate: there are **no** testimonials, no
customer logos, no published case studies, and no pricing page. Do not invent
them.

## Product Principles

1. **Answer the operator's question before offering them a choice.** The
   dashboard's job is "what needs me now". Every added control competes with
   that answer.
2. **The chart is the truth.** Teeth, shade and material are structured data that
   every downstream surface — slip, invoice, price — derives from. Never let a
   free-text field stand in for something the chart already knows.
3. **Nothing important waits on the network.** Local-first is a correctness
   property here, not a performance preference: the operator's own data is on
   their own machine and must always be readable.
4. **Print must survive the screen.** If a fact matters enough to print, it must
   be unambiguous in monospace on paper, with no reliance on colour alone.
5. **Contrast is a function of the operator's choices, not ours.** Because the
   accent is theirs to pick, readability must be structural.

## Accessibility & Inclusion

Contrast in both themes is a CI-enforced product requirement rather than a
design preference, for the white-label reason above: any accent an operator can
choose must remain readable.

Small-screen legibility is a requirement of the actual hardware, not an
adaptation to be added later.

No further accessibility standard or specific user need has been established
beyond these.