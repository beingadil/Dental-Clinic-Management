/**
 * Optional Groq backchannel for the assistant.
 *
 * NEVER ships a key. The user pastes it into Settings; it lives in a dedicated
 * localStorage entry — not UserPreferences, never in git or the installer.
 * Removing it (Settings → Voice Assistant → Clear) kills Groq immediately.
 */
const KEY = 'ds.voice.groq.key';
const ENABLED = 'ds.voice.groq.enabled';

export const groqKeyPresent = (): boolean => Boolean(localStorage.getItem(KEY));

/** Key for audio upload — still requires the caller to enforce voice_cloud_transcription. */
export const getGroqKeyForAudio = (): string | null => {
  const key = localStorage.getItem(KEY);
  return key && localStorage.getItem(ENABLED) === 'true' ? key : null;
};
export const groqEnabled = (): boolean => groqKeyPresent() && localStorage.getItem(ENABLED) === 'true';
export const setGroqKey = (key: string): void => {
  const trimmed = key.trim();
  if (trimmed) { localStorage.setItem(KEY, trimmed); localStorage.setItem(ENABLED, 'true'); }
};
export const clearGroqKey = (): void => { localStorage.removeItem(KEY); localStorage.removeItem(ENABLED); };
export const setGroqEnabled = (on: boolean): void => { localStorage.setItem(ENABLED, on ? 'true' : 'false'); };

export interface GroqChatMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; name?: string }

/** Tool-calling variant returning the raw assistant message (may include tool_calls). */
export async function groqChatTools(
  messages: GroqChatMessage[],
  tools: { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }[],
  opts?: { maxTokens?: number; timeoutMs?: number; tool_choice?: 'auto' | 'none' | 'any'; temperature?: number },
): Promise<{ content: string | null; tool_calls?: { id: string; type?: string; function: { name: string; arguments: string } }[] } | null> {
  const key = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
  if (!key || localStorage.getItem(ENABLED) !== 'true') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 15000);
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        temperature: opts?.temperature ?? 0.1,
        max_tokens: opts?.maxTokens ?? 400,
        messages,
        tools: tools.length ? tools : undefined,
        tool_choice: opts?.tool_choice ?? 'auto',
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    const choice = data?.choices?.[0]?.message;
    if (!choice) return null;
    return {
      content: choice.content ?? null,
      tool_calls: choice.tool_calls,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function groqChat(messages: GroqChatMessage[], opts?: { maxTokens?: number; timeoutMs?: number }): Promise<string | null> {
  const key = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
  if (!key || localStorage.getItem(ENABLED) !== 'true') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 12000);
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        temperature: 0.1,
        max_tokens: opts?.maxTokens ?? 300,
        messages,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
