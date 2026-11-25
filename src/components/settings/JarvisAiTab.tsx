/**
 * Settings → Jarvis AI — provider keys, failover order and connection tests.
 *
 * Keys live in localStorage only (never in git or the installer). Every field
 * saves immediately; the voice assistant picks the highest-priority enabled
 * provider that has a key and fails over on 429/5xx automatically.
 */
import React, { useMemo, useState } from 'react';
import {
  Bot, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, PlugZap,
  ShieldCheck, Sparkles, TriangleAlert, Zap,
} from 'lucide-react';
import {
  getProviders, setProviderKey, setProviderEnabled, setProviderModel,
  setProviderBaseUrl, testProvider,
  type AiProviderId, type AiChatResult,
} from '../../services/voiceAiRouter';

const META: Record<AiProviderId, { tagline: string; hint: string; accent: string }> = {
  groq: {
    tagline: 'Fastest tool-calling — recommended primary',
    hint: 'Free tier is rate-limited (≈8,000 tokens/min). Add OpenRouter below as a fallback.',
    accent: 'from-orange-500/10 to-amber-500/5 border-orange-200',
  },
  openrouter: {
    tagline: 'Free + paid models, automatic failover',
    hint: 'Create a key at openrouter.ai/keys. Free models end with “:free”.',
    accent: 'from-indigo-500/10 to-violet-500/5 border-indigo-200',
  },
  custom: {
    tagline: 'Any OpenAI-compatible endpoint',
    hint: 'Local Ollama, LM Studio, Azure OpenAI or your own gateway.',
    accent: 'from-slate-500/10 to-slate-400/5 border-slate-200',
  },
};

const ERROR_TEXT: Record<NonNullable<AiChatResult['error']>, string> = {
  rate_limited: 'Rate limited — try again in a minute or enable another provider.',
  invalid_key: 'Key rejected or missing — check the key and try again.',
  network_error: 'Could not reach the provider — check the URL and connection.',
  insufficient_credit: 'Account out of credit — top it up or pick another provider.',
  invalid_model: 'This model is not available — pick another model name.',
  server_error: 'The provider is having trouble — try again shortly.',
};

export const JarvisAiTab: React.FC = () => {
  const [providers, setProviders] = useState(() => getProviders());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<AiProviderId | null>(null);
  const [results, setResults] = useState<Partial<Record<AiProviderId, { ok: boolean; error: AiChatResult['error'] }>>>({});

  const active = useMemo(
    () => providers.filter((p) => p.enabled && !!p.apiKey).sort((a, b) => a.priority - b.priority),
    [providers],
  );

  const refresh = () => setProviders(getProviders());

  const saveKey = (id: AiProviderId) => {
    const key = (drafts[id] ?? '').trim();
    setProviderKey(id, key);
    setDrafts((d) => ({ ...d, [id]: '' }));
    refresh();
  };

  const runTest = async (id: AiProviderId) => {
    setTesting(id);
    setResults((r) => ({ ...r, [id]: undefined }));
    const result = await testProvider(id);
    setResults((r) => ({ ...r, [id]: result }));
    setTesting(null);
  };

  return (
    <div className="space-y-6">
      {/* Summary */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                Jarvis AI providers
                <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">
                  CAG engine
                </span>
              </h2>
              <p className="text-xs text-slate-500 mt-1 max-w-xl">
                Jarvis understands any phrasing through tool calling. Providers are tried in priority order and
                fail over automatically on rate limits, so one free tier running dry never stops the assistant.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <Zap className={`w-4 h-4 ${active.length ? 'text-emerald-600' : 'text-amber-500'}`} />
            {active.length
              ? `${active.length} active · ${active.map((p) => p.name).join(' → ')}`
              : 'No provider configured'}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
          <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="text-slate-600"><strong className="text-slate-900">Keys stay local.</strong> Stored in this browser only — never committed or bundled.</span>
          </div>
          <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <PlugZap className="w-4 h-4 text-indigo-600 shrink-0" />
            <span className="text-slate-600"><strong className="text-slate-900">Priority failover.</strong> 429/5xx moves to the next enabled provider in one request.</span>
          </div>
          <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <Sparkles className="w-4 h-4 text-violet-600 shrink-0" />
            <span className="text-slate-600"><strong className="text-slate-900">No phrase lists.</strong> Intent comes from the model’s tool calls, not keyword matching.</span>
          </div>
        </div>
      </section>

      {/* Provider cards */}
      <div className="grid grid-cols-1 gap-4">
        {providers.map((p) => {
          const meta = META[p.id];
          const configured = !!p.apiKey;
          const result = results[p.id];
          return (
            <section key={p.id} className={`bg-white rounded-2xl border shadow-2xs overflow-hidden ${p.enabled && configured ? 'border-emerald-200' : 'border-slate-200'}`}>
              <div className={`bg-gradient-to-r ${meta.accent} px-5 py-4 border-b border-inherit`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${p.enabled && configured ? 'bg-emerald-500' : configured ? 'bg-amber-400' : 'bg-slate-300'}`} />
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        {p.name}
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 bg-white/70 border border-slate-200 rounded-full px-2 py-0.5">
                          priority {p.priority}
                        </span>
                      </h3>
                      <p className="text-[11px] text-slate-600 truncate">{meta.tagline}</p>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={(e) => { setProviderEnabled(p.id, e.target.checked); refresh(); }}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    Enabled
                  </label>
                </div>
              </div>

              <div className="p-5 space-y-4">
                {/* API key */}
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1.5" htmlFor={`key-${p.id}`}>
                    API key
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                      <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        id={`key-${p.id}`}
                        type={reveal[p.id] ? 'text' : 'password'}
                        value={drafts[p.id] ?? ''}
                        onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                        placeholder={configured ? `Saved ${p.apiKey!.slice(0, 6)}…${p.apiKey!.slice(-4)} — enter a new key to replace` : 'Paste the provider API key'}
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full h-10 pl-9 pr-10 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
                      />
                      <button
                        type="button"
                        onClick={() => setReveal((r) => ({ ...r, [p.id]: !r[p.id] }))}
                        aria-label={reveal[p.id] ? 'Hide key' : 'Show key'}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                      >
                        {reveal[p.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => saveKey(p.id)}
                      disabled={!(drafts[p.id] ?? '').trim()}
                      className="h-10 px-4 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer inline-flex items-center justify-center gap-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Save key
                    </button>
                    {configured && (
                      <button
                        type="button"
                        onClick={() => { setProviderKey(p.id, ''); refresh(); }}
                        className="h-10 px-3 rounded-xl border border-slate-300 text-slate-600 text-xs font-semibold hover:bg-slate-50 cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* Model + base URL */}
                <div className={`grid grid-cols-1 ${p.id === 'custom' ? 'sm:grid-cols-2' : ''} gap-4`}>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1.5" htmlFor={`model-${p.id}`}>
                      Model
                    </label>
                    <input
                      id={`model-${p.id}`}
                      type="text"
                      value={p.model}
                      onChange={(e) => { setProviderModel(p.id, e.target.value); refresh(); }}
                      placeholder="model id"
                      spellCheck={false}
                      className="w-full h-10 px-3 rounded-xl border border-slate-300 bg-white text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
                    />
                  </div>
                  {p.id === 'custom' && (
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1.5" htmlFor={`url-${p.id}`}>
                        Base URL
                      </label>
                      <input
                        id={`url-${p.id}`}
                        type="url"
                        value={p.baseUrl}
                        onChange={(e) => { setProviderBaseUrl(p.id, e.target.value); refresh(); }}
                        placeholder="https://host/v1"
                        spellCheck={false}
                        className="w-full h-10 px-3 rounded-xl border border-slate-300 bg-white text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
                      />
                    </div>
                  )}
                </div>

                {/* Hint + test */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                  <p className="text-[11px] text-slate-500 max-w-xl">{meta.hint}</p>
                  <button
                    type="button"
                    onClick={() => void runTest(p.id)}
                    disabled={!configured || testing === p.id}
                    className="h-9 px-3.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer inline-flex items-center gap-1.5 shrink-0"
                  >
                    {testing === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />}
                    {testing === p.id ? 'Testing…' : 'Test connection'}
                  </button>
                </div>

                {result && (
                  <div className={`flex items-start gap-2 rounded-xl border p-3 text-[11px] font-semibold ${
                    result.ok
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-red-200 bg-red-50 text-red-800'
                  }`}>
                    {result.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <TriangleAlert className="w-4 h-4 shrink-0" />}
                    <span>{result.ok ? 'Connected — the model answered.' : ERROR_TEXT[result.error ?? 'network_error']}</span>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-500">
        Voice input uses Groq Whisper when a Groq key is set. Without it, the assistant falls back to on-device speech
        recognition where available. Nothing here is sent anywhere except the provider you enable.
      </p>
    </div>
  );
};
