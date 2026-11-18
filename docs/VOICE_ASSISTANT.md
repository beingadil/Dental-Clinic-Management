# Voice Assistant (RAG + voice shell) — design

Status: Phases 0–8 landed. Planner layer + voice CSV exports + print/notification/closeMonth tools wired; offline mode degrades to deterministic registry + clarification questions.

## Product posture

- Offline-first desktop (Tauri 2 / WebView2). Voice Assistant is OFF by default and must be enabled per user in Settings.
- Groq is an opt-in channel: never baked into the bundle with a key, never sent patient clinical detail, never required for financial correctness.
- The local engine (ledger, statement, account position) is the source of truth for every figure the assistant speaks.
- Irreversible/money-out actions (void, delete, paid-bulk, reopen, wipe, restore, module password) are never voice-issued. Writes in v1: record payment, record advance deposit — ConfirmDialog required, `canPost` re-checked at execution, `source=voice` on the audit row.

## Layers

1. Voice shell: push-to-talk (Ctrl+Shift+V + mic button), overlay states idle/listening/thinking/needs-clarification/confirming/acting/locked; mounted in App.tsx; `no-print`; respects LockScreen and ModuleAccessGate.
2. Speech in: browser `SpeechRecognition` feature-detected; desktop experimental native WinRT/Vosk (`VOICE_NATIVE_STT` flag); optional Groq Whisper only with explicit consent + key.
3. Speech out: `speechSynthesis`, tiered phrases, never reads clinical notes by default.
4. Clarification state machine: per-intent slot tables, missing-slot questions, ambiguity listing, cancel token, 8s silence timeout, always echo before acting.
5. Intent router: deterministic fast-path → Groq LLM (strict JSON tool schema) → offline template fallback. Every returned tool call is validated against the allow-list and re-authorized at execution.
6. RAG: tracked-corpus FTS4 index with JS-side BM25 (`scripts/build-rag-index.mjs`), chunked by heading/symbol, schema `{path, module, type, symbol, heading_path, content, sha, source, token_count}`, BM25 + filters, citations `path:symbol`.
7. Deterministic tool layer: read-only services for balances/ledger/statements/advance wallet/overdues; write tools for payment/advance only.
8. Narration: Groq LLM with retrieved context + tool JSON; refuses invented numbers; cites ground truth; falls back offline.

## Security/privacy invariants

- Money answers are fetched, never invented.
- No patient name, teeth, shade, procedure, notes, photos in prompt by default; Super-Admin-only `voice_read_clinical_detail` stays off unless deliberately set.
- `source=voice` audit note (or `audit_events.source` migration when added) for every voice action.
- Typed-phrase dialogs are never satisfied by voice.
- Locked modules are never read aloud.

## Settings (additive `voice_*` keys; no migration)

`voice_enabled`, `voice_locale`, `voice_tts_voice_uri`, `voice_tts_rate`, `voice_confirmation_mode`, `voice_read_clinical_detail`, `voice_groq_enabled`, `voice_cloud_transcription`. Groq key is NOT stored in preferences JSON; it is kept in a dedicated local entry (`ds.voice.groq.key`) — never in bundle, never in git.

## Natural voice

- System-voice picker (`voice_tts_voice_uri`) populated from `speechSynthesis.getVoices()`; default = OS voice.
- Locale + speech rate tunable (`voice_locale`, `voice_tts_rate`, 0.5–2.0).
- Utterances always pass through `voiceRedaction.ts` first.

## Local memory ("learns from us")

- Every answer pair is redacted and stored locally (`ds.voice.memory`, capped 50 entries).
- Memory is never sent to Groq; only a short redacted digest (≤ 12 Q/A pairs) is appended to the routing prompt when Groq routing is enabled.
- Clearable from Settings → Application Defaults → Voice Assistant → Local memory.

## Test matrix

- Mocked router/redaction/slot/audit/RBAC tests in CI (no network).
- `tests/voice/live.groq.test.ts` runs only when `GROQ_API_KEY` is set; skipped otherwise; covers "Mir Dental balance" ambiguity, statement resolution, no-PII check, offline fallback.
- On-device desktop: mic path verified on clean Windows before enabling native STT.

## Build order

0 Foundations (this doc, audit-wipe fix) → 1 voice shell + speechSynthesis → 2 RAG indexer + FTS API → 3 business tool layer → 4 Groq router + offline fallback → 5 clarification state machine → 6 speech-in paths → 7 payments/advance write path → 8 hardening + release.

