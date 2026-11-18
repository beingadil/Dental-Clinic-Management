/**
 * Deterministic redaction for anything the assistant SAYS aloud.
 *
 * The voice channel is a loudspeaker in a clinic — other patients can hear it.
 * By default, nothing that identifies a patient (name, clinical findings,
 * contact details) may leave the app through speech.
 */
export type VoiceRedactionClass = 'contact' | 'identifier' | 'clinical';

export interface VoiceRedactionFinding {
  kind: VoiceRedactionClass;
  match: string;
  start: number;
  end: number;
}

export interface VoiceRedactionResult {
  text: string;
  findings: VoiceRedactionFinding[];
  blocked: boolean;
}

const CONTACT_PATTERNS: RegExp[] = [
  /(?:\+92[-\s]?)?(?:0?3\d{2}[-\s]?\d{7})/g, // Pakistan mobile
  /\b[\w.+-]{2,}@[\w.-]+\.[A-Za-z]{2,}\b/g,         // e-mail
];

const IDENTIFIER_PATTERNS: RegExp[] = [
  /\b\d{13}\b/g, // CNIC without dashes
  /\b\d{5}[-\s]?\d{7}[-\s]?\d{1}\b/g, // CNIC with dashes
];

const CLINICAL_TERMS = [
  'shade', 'teeth', 'tooth', 'incisor', 'molar', 'premolar', 'canine',
  'caries', 'extraction', 'scaling', 'crown', 'veneer', 'bridge', 'implant',
  'rct', 'root canal', 'fracture', 'polish', 'zirconia', 'e.max', 'emax',
  'pfm', 'composite', 'amalgam',
];

/** Word-boundary scan for clinical terms (kept literal, no fuzzy guessing). */
export const containsClinicalDetail = (input: string): boolean =>
  new RegExp(`(?:^|\\b)(${CLINICAL_TERMS.join('|')})(?:\\b|$)`, 'i').test(input);

export const redactVoiceText = (
  input: string,
  opts: { allowClinicalDetail?: boolean } = {},
): VoiceRedactionResult => {
  let text = input || '';
  const findings: VoiceRedactionFinding[] = [];

  const mask = (pattern: RegExp, kind: VoiceRedactionClass) => {
    text = text.replace(pattern, (match, ...rest) => {
      const offset = rest[rest.length - 2] as number;
      findings.push({ kind, match, start: offset, end: offset + match.length });
      return '█'.repeat(Math.min(match.length, 16));
    });
  };

  // Money amounts and amounts (PKR 1,234 / 50,000) pass through unchanged —
  // clinic totals are what the assistant exists to speak.
  CONTACT_PATTERNS.forEach((p) => mask(p, 'contact'));
  IDENTIFIER_PATTERNS.forEach((p) => mask(p, 'identifier'));

  if (!opts.allowClinicalDetail && containsClinicalDetail(text)) {
    const cleaned = text.replace(
      new RegExp(`\\b(${CLINICAL_TERMS.join('|')})\\b`, 'gi'),
      () => '█',
    );
    // Rebuild one finding per masked clinical term (offsets beyond first are
    // indicative — the strip itself is what must happen).
    findings.push({ kind: 'clinical', match: 'clinical detail', start: 0, end: Math.min(cleaned.length, 20) });
    text = cleaned;
  }

  return { text, findings, blocked: findings.some((f) => f.kind === 'clinical') };
};
