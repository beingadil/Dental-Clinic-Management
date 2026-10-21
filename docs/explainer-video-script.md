# Dental Solutions — Explainer Video Script & Storyboard

**Rendered video:** `brag-output/brag.mp4` (4:05, 1920×1080, 30 fps)
**Title:** "Run your lab end to end."
**Target length:** 4:05 (245 s)
**Format:** 16:9, 1080p. Motion-graphics explainer built from the live product's design system.
**Audience:** Lab owners / solo operators evaluating the software; also usable as onboarding for new staff.
**Tone:** Calm, practical, premium. Show, don't tell.

> **This script is synced to the rendered video.** Scene timecodes below match the cuts in `brag.mp4` exactly. Record one scene at a time and drop each take in at its timecode — the on-screen visuals already carry the message, so your narration should add context, not repeat the captions.

---

## Production notes

- **Word count target:** ~520 words of narration ≈ 4:00 at 130 wpm. The current script is ~640 words ≈ 5:00; trim Scenes 6, 10, 12 if you need to land shorter.
- **Music bed** is already in the render at low volume. When you add narration, duck the music to ~0.12 under your voice and return it to 0.5 in the gaps.
- **Chapter markers** are already burned into the top-right of the video (Overview, The workflow, Dashboard, Case intake, …) and a progress bar runs along the bottom — use them for YouTube chapters.
- **On-screen text** is a caption, not a subtitle. Your narration should add the *why*, never read the caption aloud.

---

## Scene-by-scene

### Scene 1 — Hero — 0:00 – 0:08
**On screen:** "Run your lab end to end." · "One machine. One operator. Every case, invoice, and payment — in one place." · pills: Offline / White-label / Double-entry ledger
**Narration:**
> This is Dental Solutions. It runs a dental laboratory end to end on a single machine — one person doing bench work, front desk, and the books, in one session.

---

### Scene 2 — The workflow — 0:08 – 0:28
**On screen:** "No second system to keep in sync." · 5-step vertical flow: Receive case → Chart teeth & shade → Production & SLA → Print job slip → Invoice the clinic
**Narration:**
> The whole path is here. Receive a case from a clinic, chart it, produce it, print the slip, and bill the clinic. Nothing gets re-entered into a second system and nothing has to be reconciled by hand.

---

### Scene 3 — Dashboard — 0:28 – 0:48
**On screen:** "What needs me right now?" · tiles: Late 3, Due today 7, Receivable PKR 46.5k · three case rows
**Narration:**
> Everything starts on the dashboard, because the first question is always the same: what needs me right now, and what is late? Late cases, today's deliveries, and what the clinics owe you — all without leaving the screen.

---

### Scene 4 — Case intake — 0:48 – 1:13
**On screen:** "A case's identity is its charted teeth and shade." · full 32-tooth FDI odontogram, charted teeth lit
**Narration:**
> Receiving a case is where this product is genuinely different. A case's identity is its charted teeth and shade — not a free-text note. You chart teeth on the FDI odontogram, pick the shade once and it applies to the whole selection, and choose the restoration type and material. Pricing multiplies by charted units automatically.

---

### Scene 5 — Product types — 1:13 – 1:28
**On screen:** "Some products have no teeth." · Crown (per-tooth) vs Retainer (no teeth)
**Narration:**
> Some products have no teeth at all. A retainer is not charted. It appears on no slip and no invoice as teeth — and it is still priced correctly.

---

### Scene 6 — Production — 1:28 – 1:48
**On screen:** "received → in production → QC → ready → dispatched" · vertical stepper with dates
**Narration:**
> Once registered, a case moves through a fixed production workflow: received, in production, quality check, ready, dispatched. Every case carries a priority and a global SLA turnaround, so the countdown is the same for every case of that priority. Notes, QC results, and attachments live on the case itself.

---

### Scene 7 — Printing — 1:48 – 2:08
**On screen:** "The slip prints the teeth." · job slip with clinic, material, shade A2, teeth 11·12·13, priority, SLA, due date
**Narration:**
> The job slip is a first-class deliverable, not an export. It prints the teeth, the shade, and the material — the same chart that drives the pricing. You control which sections print, your choices are saved, and you can batch-print a whole queue of slips for a busy morning. The technician at the bench reads the slip, not the screen.

---

### Scene 8 — Billing — 2:08 – 2:28
**On screen:** "Invoiced at registration." · invoice #1042 with line items, tooth numbers, PKR amounts, total PKR 46,500, "Auto-raised" badge
**Narration:**
> Invoicing is not a separate step. The moment a case is registered, an invoice is raised for it, priced from that clinic's agreed rate for that material, and it stays bound to the case for life. Payments are recorded against it, partial payments included, and you can attach a payment-proof image. Receivable balances update as money lands.

---

### Scene 9 — Ledger — 2:28 – 2:48
**On screen:** "Double-entry ledger. Real money, in PKR." · journal entries table, receivable balance PKR 26,500, collected PKR 20,000
**Narration:**
> Behind the invoices sits a real double-entry ledger. Every payment and adjustment posts a journal entry. You can record manual adjustments, pull a clinic statement, and run billing reports. Money is real money here — PKR amounts, receivable balances, allocation across invoices — and none of it is hidden behind a sync.

---

### Scene 10 — Configuration — 2:48 – 3:03
**On screen:** "Configure once." · material catalog, SLA by priority, branding swatches
**Narration:**
> Clinics and labs are managed in their own screens, and the catalog is yours. Add materials, group them into categories, and set the SLA turnarounds per priority. Configure it once and every new case inherits it. The product is white-label — your practice name, logo, tagline, and accent colour.

---

### Scene 11 — Data safety — 3:03 – 3:23
**On screen:** "Back up. Validate. Restore." · 5-step flow: Export .dentalbackup → Validate SHA-256 → Safety snapshot → Swap engine → Reload
**Narration:**
> Backups are a versioned package — the SQLite file plus a SHA-256 manifest. Restore validates the package first, takes a safety snapshot of your current data, swaps the engine, and reloads. You can import a plain SQL dump too: it is replayed into a throwaway database and reported before anything is replaced, and statements that would escape the sandbox are refused rather than run.

---

### Scene 12 — Updates — 3:23 – 3:38
**On screen:** "Updates, handled." · checklist: Check manifest / Download installer / Verify SHA-256 / Back up database / Restart & apply
**Narration:**
> The desktop app updates itself. It checks the published manifest, streams the download, verifies the checksum while it downloads, and takes a database backup before anything is installed. Then it asks. Only your click closes the app — the staged installer is re-hashed at that moment, because it has been sitting on disk unattended.

---

### Scene 13 — Platform — 3:38 – 3:53
**On screen:** "Offline. White-label. Yours." · three pillars: Offline / White-label / Desktop + Web
**Narration:**
> Core workflows need no network at all — fonts and the SQLite engine are bundled, with no runtime CDN calls. It ships as a Windows desktop installer and the same code runs in a browser. Dark mode is a working requirement, not a preference, and the small 1366-pixel screens these labs actually use are treated as first-class.

---

### Scene 14 — Close — 3:53 – 4:05
**On screen:** "One source of truth for every case, invoice, and payment." · pills: Offline / White-label / v2.28
**Narration:**
> That's Dental Solutions: one machine, one operator, one source of truth for every case, invoice, and payment. Thanks for watching.

---

## Feature coverage checklist

- [x] Dashboard — what's late, what's due, what's owed
- [x] Case intake + FDI odontogram + per-tooth shade
- [x] Per-tooth vs not-per-tooth products (retainer)
- [x] Case templates, QC, notes, attachments
- [x] Material catalog + categories + SLA per priority
- [x] Production workflow with priority + SLA
- [x] Job slip print, section toggles, saved settings, batch print
- [x] Auto-invoicing at registration, clinic rate, bound to the case
- [x] Partial payments + payment-proof images + receivable balances
- [x] Double-entry ledger, journal entries, adjustments
- [x] Clinic statements + billing reports
- [x] Clinics & labs management
- [x] White-label branding (name, logo, tagline, accent)
- [x] Backup (.dentalbackup + SHA-256) + restore + safety snapshot
- [x] Sandboxed SQL dump import
- [x] Desktop updates (5-step)
- [x] Offline operation, Tauri desktop + web, dark mode, small screens

## Recording checklist

1. Log in to a demo account with realistic seed data (clinics, cases in every status, invoices, payments) — the mockups in the video use Acme Dental, Case #1042, PKR amounts.
2. Record each scene as a separate take. Stitch in the editor; it is far easier to re-record one scene than the whole video.
3. Capture audio at 48 kHz, normalise to -3 dB peak, add light compression.
4. Duck the existing music bed to ~0.12 under your narration, then let it return to 0.5.
5. Export H.264, 1080p, 8–12 Mbps, AAC 192 kbps.
6. Use the burned-in chapter labels for YouTube chapter markers.

## Shorter cuts

- **60s teaser:** Scenes 1, 4, 8, 14.
- **90s "how it works":** Scenes 1, 2, 3, 4, 7, 8, 14.
- **Silent / text-only version:** strip the narration track and raise the music to 0.8 — the video reads on its own.
