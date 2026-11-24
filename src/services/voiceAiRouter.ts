/**
 * Multi-provider AI router for Jarvis.
 *
 * Supports Groq, OpenRouter, and custom OpenAI-compatible endpoints.
 * Tries providers in priority order; on 429 (rate limit) skips that provider
 * and tries the next. Returns the first successful result with provider info.
 *
 * API keys live in localStorage only — never in git or the installer.
 * Per-provider enable toggles let the user choose which channels are active.
 */
import type { GroqChatMessage } from './voiceGroq';

export type AiProviderId = 'groq' | 'openrouter' | 'custom';

export interface AiProviderConfig {
  id: AiProviderId;
  name: string;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  enabled: boolean;
  priority: number;
  /** Extra headers (OpenRouter needs HTTP-Referer + X-Title). */
  extraHeaders: Record<string, string>;
}

export interface AiChatResult {
  content: string | null;
  tool_calls?: { id: string; type?: string; function: { name: string; arguments: string } }[] | null;
  provider: AiProviderId;
  providerName: string;
  error: string | null; // 'rate_limited' | 'invalid_key' | 'network_error' | null
}

const DEFAULT_PROVIDERS: AiProviderConfig[] = [
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: null,
    model: 'openai/gpt-oss-120b',
    enabled: true,
    priority: 1,
    extraHeaders: {},
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: null,
    model: 'meta-llama/llama-3.1-8b-instruct:free',
    enabled: false,
    priority: 2,
    extraHeaders: {
      'HTTP-Referer': 'https://dental-clinic.local',
      'X-Title': 'Dental Solutions Jarvis',
    },
  },
  {
    id: 'custom',
    name: 'Custom Endpoint',
    baseUrl: 'https://api.example.com/v1',
    apiKey: null,
    model: '',
    enabled: false,
    priority: 3,
    extraHeaders: {},
  },
];

let providers: AiProviderConfig[] = [...DEFAULT_PROVIDERS];
let lastError: AiChatResult['error'] = null;

export const getProviders = (): AiProviderConfig[] => [...providers];

export const setProviderConfig = (configs: AiProviderConfig[]) => {
  providers = configs;
  lastError = null;
};

export const setProviderEnabled = (id: AiProviderId, enabled: boolean) => {
  const p = providers.find((p) => p.id === id);
  if (p) p.enabled = enabled;
};

export const setProviderKey = (id: AiProviderId, key: string) => {
  const p = providers.find((p) => p.id === id);
  if (p) p.apiKey = key || null;
};

export const setProviderModel = (id: AiProviderId, model: string) => {
  const p = providers.find((p) => p.id === id);
  if (p) p.model = model;
};

export const setProviderBaseUrl = (id: AiProviderId, baseUrl: string) => {
  const p = providers.find((p) => p.id === id);
  if (p) p.baseUrl = baseUrl;
};

export const getLastError = (): AiChatResult['error'] => lastError;

export const resetLastError = () => { lastError = null; };

/** Classify an HTTP response status into an error category. */
const classifyError = (status: number): AiChatResult['error'] => {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'invalid_key';
  return 'network_error';
};

/** Call a single provider. Returns null on transient errors (so router tries next),
 *  or a result with error set on hard failures. */
const callProvider = async (
  p: AiProviderConfig,
  messages: GroqChatMessage[],
  tools: { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }[],
  opts: { maxTokens?: number; timeoutMs?: number; temperature?: number; tool_choice?: 'auto' | 'none' | 'any' },
): Promise<{ result: AiChatResult | null; shouldTryNext: boolean }> => {
  if (!p.apiKey || !p.enabled) {
    return { result: null, shouldTryNext: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 15000);

  try {
    const response = await fetch(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${p.apiKey}`,
        ...p.extraHeaders,
      },
      body: JSON.stringify({
        model: p.model,
        temperature: opts?.temperature ?? 0.1,
        max_tokens: opts?.maxTokens ?? 400,
        messages,
        tools: tools.length ? tools : undefined,
        tool_choice: opts?.tool_choice ?? 'auto',
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const err = classifyError(response.status);
      lastError = err;
      // On rate limit or invalid key, try next provider; on network error, try next too
      return { result: null, shouldTryNext: true };
    }

    const data = await response.json();
    const choice = data?.choices?.[0]?.message;
    if (!choice) {
      lastError = 'network_error';
      return { result: null, shouldTryNext: true };
    }

    lastError = null;
    return {
      result: {
        content: choice.content ?? null,
        tool_calls: choice.tool_calls,
        provider: p.id,
        providerName: p.name,
        error: null,
      },
      shouldTryNext: false,
    };
  } catch {
    lastError = 'network_error';
    return { result: null, shouldTryNext: true };
  } finally {
    clearTimeout(timer);
  }
};

/** Try all enabled providers in priority order. Returns first success. */
export const aiChatTools = async (
  messages: GroqChatMessage[],
  tools: { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }[],
  opts?: { maxTokens?: number; timeoutMs?: number; temperature?: number; tool_choice?: 'auto' | 'none' | 'any' },
): Promise<AiChatResult | null> => {
  lastError = null;

  const ordered = [...providers]
    .filter((p) => p.enabled && !!p.apiKey)
    .sort((a, b) => a.priority - b.priority);

  if (ordered.length === 0) {
    lastError = 'invalid_key';
    return { content: null, tool_calls: null, provider: 'groq', providerName: 'Groq', error: 'invalid_key' };
  }

  for (const p of ordered) {
    const { result, shouldTryNext } = await callProvider(p, messages, tools, opts ?? {});
    if (result) return result;
    if (!shouldTryNext) break;
  }

  // All providers failed — return the last error
  return {
    content: null,
    tool_calls: null,
    provider: ordered[0]?.id ?? 'groq',
    providerName: ordered[0]?.name ?? 'Groq',
    error: lastError ?? 'network_error',
  };
};

/** Simple chat (no tools) — same multi-provider logic. */
export const aiChat = async (
  messages: GroqChatMessage[],
  opts?: { maxTokens?: number; timeoutMs?: number; temperature?: number },
): Promise<string | null> => {
  lastError = null;

  const ordered = [...providers]
    .filter((p) => p.enabled && !!p.apiKey)
    .sort((a, b) => a.priority - b.priority);

  if (ordered.length === 0) {
    lastError = 'invalid_key';
    return null;
  }

  for (const p of ordered) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 15000);
    try {
      const response = await fetch(`${p.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${p.apiKey}`,
          ...p.extraHeaders,
        },
        body: JSON.stringify({
          model: p.model,
          temperature: opts?.temperature ?? 0.1,
          max_tokens: opts?.maxTokens ?? 300,
          messages,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        lastError = classifyError(response.status);
        clearTimeout(timer);
        continue;
      }

      const data = await response.json();
      lastError = null;
      clearTimeout(timer);
      return data?.choices?.[0]?.message?.content ?? null;
    } catch {
      lastError = 'network_error';
      clearTimeout(timer);
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
};
