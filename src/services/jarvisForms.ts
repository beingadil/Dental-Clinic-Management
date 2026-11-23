/**
 * JarvisForms — the programmatic form layer.
 *
 * The agent emits `fill_form` (see voiceRegistry). The tool shares this
 * module, so the registry, any Rust-side `jarvis-ui-action`, and this file
 * all talk to the same per-form handlers. Forms register once, when open,
 * and receive a normalized field map. Values are applied via the React
 * setters captured at registration time — no DOM hacks.
 *
 * Safety contract (shared with the registry): every write still goes through
 * the form's own save button. Jarvis fills the fields for review; the
 * operator commits. The registry declares `risk: 'write'`, so the amber
 * panel shows before anything executes.
 */
export type JarvisFormData = Record<string, string | number | boolean | string[] | null | undefined>;

export interface JarvisFormRegistration {
  /** Stable form key — the LLM must use this as `target` in fill_form. */
  target: string;
  /** Apply values. Never commits; only populates fields. */
  apply: (data: JarvisFormData) => void;
}

const registrations = new Map<string, JarvisFormRegistration>();

export const registerJarvisForm = (reg: JarvisFormRegistration): void => {
  if (!reg.target) return;
  registrations.set(reg.target, reg);
};

export const unregisterJarvisForm = (target: string): void => {
  registrations.delete(target);
};

export const jarvisFormTargets = (): string[] => [...registrations.keys()].sort();

/** Returns false when no form is registered for the target. */
export const fillJarvisForm = (target: string, data: JarvisFormData): boolean => {
  const reg = registrations.get(target);
  if (!reg) return false;
  reg.apply(data);
  return true;
};

/**
 * React helper: registers a form while it is open. Forms pass a
 * field-name → handler map; the effect keys off `isOpen`/`target` only so an
 * inline handler map doesn't restart the registration on every render.
 *
 * Two paths converge on the same apply: the voice `fill_form` tool calls
 * `fillJarvisForm` directly, and window `jarvis-fill-form` events (Rust-side
 * jarvis-ui-action, manual dispatches) are bridged here too.
 */
export const useJarvisForm = (
  target: string,
  isOpen: boolean,
  handlers: Record<string, (value: unknown) => void>,
): void => {
  const handlersRef = React.useRef(handlers);
  handlersRef.current = handlers;
  const apply = React.useCallback(
    (data: JarvisFormData) => {
      for (const [key, fn] of Object.entries(handlersRef.current)) {
        if (key in data && typeof fn === 'function') fn(data[key]);
      }
    },
    [],
  );
  React.useEffect(() => {
    if (!isOpen) return;
    registerJarvisForm({ target, apply });
    return () => unregisterJarvisForm(target);
  }, [isOpen, target, apply]);
  React.useEffect(() => {
    const handle = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d && d.target === target) apply(d.data || {});
    };
    window.addEventListener('jarvis-fill-form', handle);
    return () => window.removeEventListener('jarvis-fill-form', handle);
  }, [target, apply]);
};

// Minimal React import — the hook is optional sugar; the service is React-free.
import React from 'react';
