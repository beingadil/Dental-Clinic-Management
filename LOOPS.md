# Project loops

Saved loops for this project. Each entry records the loop name, a one-sentence
explanation, the exact prompt, and the save date.

---

## Post-Release Verify & Settle

One-sentence: after a `v*` tag push finishes CI, verify the release actually
served (manifest version, asset checksum, release state) and repair the
smallest mismatch so end-user installs cannot loop or 404.

**Exact prompt:**

```
The v<VERSION> release just finished building on CI. Verify the release
actually served end-to-end:

1. CI run for the tag: conclusion must be success.
2. gh-pages update-manifest.json must report version <VERSION> and a
   payload_checksum that matches the SHA-256 of the uploaded installer asset.
3. Releases API latest must be v<VERSION> with the NSIS setup exe attached,
   and the release must not be a draft.
4. Download the asset and hash it; compare against the manifest checksum.

If everything matches: report a clean no-op with the checked values.
If anything mismatches: diagnose against the commit the tag points at,
apply the smallest repair (re-tag, re-run publish step, fix the workflow),
then re-verify. If a check needs the installed app or GitHub auth, stop and
report it as blocked with the exact command I should run. Never report a
failed verification as success.
```

**Save date:** 2026-09-29

**Origin:** born from the v2.12.0 update-loop incident (stale `APP_VERSION`
duplicate made updated installs re-download forever); would have caught it in
one cycle instead of 14 install attempts. Companion automation: the
`verify-release` CI job (same checks, runs automatically on every tag).
