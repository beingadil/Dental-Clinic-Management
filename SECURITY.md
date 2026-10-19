# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.**

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/beingadil/Dental-Clinic-Management/security/advisories/new)
on this repository, or by email to **adilmaher990@gmail.com**.

Please include:

- what an attacker can do, and what they need in order to do it
- the affected file, component or version
- reproduction steps, if you have them
- whether any real patient or clinic data is involved

You will get an acknowledgement within 72 hours and a status update at least
every 7 days until it is resolved. If a report turns out to be a non-issue, you
will get an explanation rather than a dismissal.

## What this project already does

These are the controls that are in place today, so you can judge where a
vulnerability would fit.

| Area | Control |
|---|---|
| Accounts | The app ships with **zero accounts**. The operator's administrator is created through a first-run setup screen — there is no default, hardcoded or documented credential. |
| Passwords | PBKDF2-SHA256 with a per-user salt. Plaintext is never stored, logged or returned. |
| Sessions | Tokens generated with WebCrypto, not `Math.random()`. Login backoff after repeated failures. |
| SQL | Parameterised queries throughout. Table names are validated against an allow-list. |
| Database | Foreign keys enforced on every connection. `CHECK` constraints on all enums and money. `UNIQUE` on every document number. |
| Transport | Strict Content-Security-Policy — no remote scripts, no frames, no form posts, `object-src 'none'`. The same policy ships in the web build and the desktop shell. |
| Network | Zero runtime third-party requests after load. The SQLite engine and fonts are bundled locally. Patient data never leaves the machine. |
| Files | Attachment validation (MIME allow-list, 8 MB per file, 32 MB per entity). Desktop file access is path-guarded. |
| Supply chain | Native binaries are verified against the SHA-256 published in the official npm tarball. `npm audit` and `cargo audit` both gate the release. |
| Data hygiene | `.gitignore` excludes every database, backup, `.dentalbackup`, `.dentalupdate` and `.env` variant. No real patient or payment record is committed. |
| Backups | Export packages are versioned and carry a SHA-256 manifest. Restore validates the package before it replaces anything, and takes a safety snapshot first. |
| Updates | Desktop updates are verified against a published checksum and fail closed. The staged installer is re-hashed at the moment of install. |

## Out of scope

- Vulnerabilities in third-party dependencies with no reachable path through this
  code — please report those upstream, though you are welcome to tell us if you
  believe a path exists here
- Findings from a build that was modified from the published source
- Denial of service by exhausting the operator's own machine
- Missing hardening headers on a locally-served file

## Disclosure

We are a solo-maintained project. We will credit you in the release notes and
`CHANGELOG.md` unless you would rather stay anonymous, and we aim to publish a
fix within 14 days of a confirmed report. Please give us that time before
disclosing publicly.
