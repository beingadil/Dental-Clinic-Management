# Project: Jarvis AI Assistant (Tauri v2 + React + TypeScript)

## Architecture Rules

**No Hardcoded Phrases:** Never use regex, `.includes()`, or keyword matching to parse user commands. All intent resolution must happen via LLM Tool Calling (Function Calling).

**Backend (Rust - `src-tauri`):**
- Keep all LLM API calls and API keys strictly inside Rust commands (`#[tauri::command]`). Never expose LLM keys in React (`VITE_` env vars).
- Define tool schemas in Rust and pass them to the LLM provider.
- When the LLM returns a UI tool call (e.g., `navigate_to`, `fill_form`), emit a Tauri event (`app_handle.emit("jarvis-ui-action", payload)`) to the frontend rather than trying to manipulate the DOM from Rust.

**Frontend (React - `src`):**
- Listen for `"jarvis-ui-action"` events globally inside a `JarvisProvider` component using `@tauri-apps/api/event`.
- Pass current app context (active route, selected record ID) into every Tauri `ask_jarvis` command call so the AI knows what screen the user is currently viewing.
- For data entry, populate React form state and let the user review/confirm before committing destructive or financial writes.

**Confirmation Gates (from billing/voice work):**
- Amber confirmation for writes — spoken "confirm" OK.
- Red gate + typed token (`DELETE` / `PURGE`) for destructive actions.
- Spoken "confirm" never auto-mutates.

**Voice:**
- Floating orb / bubble (bottom corner).
- Always-on mic — user talks while working, asking for things.
- Groq Whisper for transcription when key configured; offline fallback to deterministic registry + clarification.
- Groq routing online-only; API key stored in localStorage only, never committed.

**Rollout:** Build one module at a time (cases → billing → ledger → catalog → settings). No big-bang release. Respect existing role-based permissions. Audit-log every AI action (who, what, before/after values).

## Relevant Files

- `src/components/voice/VoiceShell.tsx` — existing voice shell (orb, mic, TTS, confirmation)
- `src/services/voiceGroq.ts` — Groq chat + STT client (localStorage key, never shipped)
- `src/services/voiceAgent.ts` — existing agentic loop (Groq tool calling → invokeApprovedTool)
- `src/services/voiceRegistry.ts` — existing tool registry
- `src/context/AppContext.tsx` — app state, userPreferences, route context
- `src/main.tsx` — app boot, Tauri integration
