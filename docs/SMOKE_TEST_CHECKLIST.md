# Smoke Test Checklist — Dental Solutions Desktop

Run this checklist on the clinic PC for **every new installer release**.
Tick each box; stop and report any failure before using the system for real
clinic data.

Installer under test: ____________________  Date: ______________
Tested by: ____________________  Windows version: ______________

---

## 1. Install

- [ ] Download `Dental.Solutions_x.y.z_x64-setup.exe` from the GitHub Releases page
- [ ] Verify checksum against `SHA256SUMS.txt`:
      `certutil -hashfile "Dental.Solutions_x.y.z_x64-setup.exe" SHA256`
- [ ] Run the installer; window shows the Dental Solutions icon and name
- [ ] Choose per-user or all-users install; complete the wizard
- [ ] Desktop / Start-menu shortcuts exist with the correct icon

## 2. First Launch & Login

- [ ] App opens with the "Initializing local database…" splash, then login screen
- [ ] Login works with the documented bootstrap credentials
- [ ] **Change each bootstrap password** (Settings → My Account & Security)

## 3. Core Module Walkthrough (all offline)

- [ ] Dashboard shows real zeros / empty states (no fake numbers)
- [ ] Add a clinic, a doctor, a patient
- [ ] Create a case via the job form (priority auto-sets the delivery date)
- [ ] Case appears in Dental Workstation / lab tracking
- [ ] Create an invoice for the case; add 2 partial payments with screenshots
- [ ] Balance, status, and Ledger entries reflect the payments correctly
- [ ] Notifications panel opens; Settings open; global search finds the patient

## 4. Restart Persistence

- [ ] Close the app completely and reopen it
- [ ] Login again; the case, invoice, and payments are still there
- [ ] Data file exists: `%APPDATA%\pk.dentalsolutions.app\dental_solutions.sqlite`

## 5. Offline Proof

- [ ] Disconnect Wi-Fi/Ethernet (or airplane-mode the adapter)
- [ ] Restart the app — login, dashboard, cases, billing all still work
- [ ] Take a `.dentalbackup` while offline; it succeeds

## 6. Backup / Restore

- [ ] Settings → Backup: save `test-backup.dentalbackup`
- [ ] Settings → Restore: pick the file; confirm the safety-snapshot prompt
- [ ] After reload, the case/invoice/payment data is intact
- [ ] Try a corrupted file (rename a `.txt` to `.dentalbackup`) — it must be
      rejected safely with a clear message

## 7. Printing (if a printer is available)

- [ ] Invoice prints with correct clinic branding, patient, items, totals
- [ ] Payment receipt prints with the correct amount and reference
- [ ] Job slip / lab card prints with correct case data

## 8. Uninstall Check (optional, last)

- [ ] Uninstall leaves the data folder (`%APPDATA%\pk.dentalsolutions.app`)
      intact — reinstalling recovers the same data

---

**Result:** PASS / FAIL (circle one) — failures go to the project issues page.
