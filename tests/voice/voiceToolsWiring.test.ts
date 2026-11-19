/**
 * Voice wiring consistency — static source scan.
 *
 * The voice registry (src/services/voiceRegistry.ts) is the single source of
 * truth for what voice can do. The confirmation shell
 * (src/components/voice/VoiceShell.tsx) and the strict write parser
 * (src/services/voiceWrite.ts) must stay consistent with it: every registry
 * tool id must exist, every shell-confirmable kind must have a branch and a
 * WriteCommand union member, and the help/fallback surface must stay useful.
 *
 * These tests read the sources as text (deterministic, no module execution)
 * and fail with a descriptive message naming the missing id/kind.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const readSrc = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../src/${rel}`, import.meta.url)), 'utf8');

const registry = readSrc('services/voiceRegistry.ts');
const shell = readSrc('components/voice/VoiceShell.tsx');
const write = readSrc('services/voiceWrite.ts');
const assistant = readSrc('services/voiceAssistant.ts');

/** Tool ids the registry must declare (id: '<id>'). */
const REGISTRY_TOOL_IDS = [
  'cashCollected',
  'overdueCases',
  'standings',
  'monthClose',
  'clinicBalance',
  'statement',
  'ledger',
  'outstanding',
  'advanceWallet',
  'invoiceSearch',
  'narrate',
  'briefing',
  'navigate',
  'recordPayment',
  'recordAdvance',
  'createClinic',
  'setCaseStatus',
  'updateClinicField',
  'updateClinicDoctor',
  'addCaseNote',
  'recordQc',
  'archiveCase',
  'printSettingsSave',
  'printSectionsSave',
  'notificationConfigSave',
  'closeMonth',
  'addClinicContact',
  'addClinicAddress',
  'addPricingOverride',
  'help',
];

/**
 * WriteCommand kinds the shell must branch on. Every kind listed here also
 * needs a member in the WriteCommand union (see tests below).
 *
 * Note on 'advance': the shell handles the advance-deposit confirmation in an
 * `else` branch of the `pending.kind === 'payment'` block (it calls
 * recordAdvanceDepositV2), so there is deliberately no literal
 * `kind === 'advance'` comparison. The assertion below checks that fallback
 * branch instead of a strict equality.
 */
const SHELL_BRANCH_KINDS = [
  'createClinic',
  'setCaseStatus',
  'updateClinicDoctor',
  'addCaseNote',
  'recordQc',
  'archiveCase',
  'updateClinicField',
  'printSettingsSave',
  'printSectionsSave',
  'notificationConfigSave',
  'closeMonth',
  'addClinicContact',
  'addClinicAddress',
  'addPricingOverride',
  'createCase',
  'payment',
  'advance',
];

/** Distinct capabilities the help tool should mention (case-insensitive substrings). */
const HELP_CAPABILITY_PROBES = [
  'briefing',
  'statement',
  'ledger',
  'outstanding',
  'advance wallet',
  'balance',
  'standings',
  'overdue',
  'cash collected',
  'month close',
  'export',
  'pricing override',
  'notification',
  'print settings',
  'payment',
  'advance deposit',
  'add clinic',
  'case',
  'archive',
  'qc',
  'doctor',
  'note',
  'code',
  'open any screen',
];

describe('voice registry tool ids', () => {
  it('declares every required tool id', () => {
    const missing = REGISTRY_TOOL_IDS.filter((id) => !registry.includes(`id: '${id}'`));
    expect(
      missing,
      `voiceRegistry.ts is missing required tool id(s): ${missing.join(', ')}`,
    ).toEqual([]);
  });
});

describe('VoiceShell confirmation branches', () => {
  it('branches on every required WriteCommand kind', () => {
    const missing: string[] = [];
    for (const kind of SHELL_BRANCH_KINDS) {
      if (kind === 'advance') {
        // 'advance' is the else-branch of the payment confirmation block:
        // it must call recordAdvanceDepositV2 after the payment branch.
        const hasAdvanceBranch =
          shell.includes("kind === 'advance'")
          || /pending\.kind === 'payment'[\s\S]{0,4000}?recordAdvanceDepositV2/.test(shell);
        if (!hasAdvanceBranch) missing.push('advance (expected an advance-deposit branch calling recordAdvanceDepositV2 after the payment branch)');
        continue;
      }
      if (!shell.includes(`kind === '${kind}'`)) {
        missing.push(kind);
      }
    }
    expect(
      missing,
      `VoiceShell.tsx is missing a confirmation branch for kind(s): ${missing.join(', ')}`,
    ).toEqual([]);
  });
});

describe('voiceWrite WriteCommand union', () => {
  const ifaceStart = write.indexOf('export interface WriteCommand');
  const unionMatch = ifaceStart === -1
    ? null
    : write.slice(ifaceStart).match(/kind:\s*([^;]+);/);
  const kindUnion = unionMatch ? unionMatch[1] : '';

  it('exposes a kind union on WriteCommand', () => {
    expect(
      kindUnion.length > 0,
      'voiceWrite.ts: could not locate the `kind:` union inside `export interface WriteCommand`',
    ).toBe(true);
  });

  it('includes every kind the shell branches on', () => {
    const missing = SHELL_BRANCH_KINDS.filter((kind) => !kindUnion.includes(`'${kind}'`));
    expect(
      missing,
      `voiceWrite.ts WriteCommand union is missing kind(s): ${missing.join(', ')} (union found: ${kindUnion.trim()})`,
    ).toEqual([]);
  });
});

describe('voice help + fallback surface', () => {
  const helpStart = registry.indexOf("id: 'help'");
  const nextTool = helpStart === -1 ? -1 : registry.indexOf("id: '", helpStart + 1);
  const helpBlock = helpStart === -1
    ? ''
    : registry.slice(helpStart, nextTool === -1 ? undefined : nextTool);

  it('help tool block can be located in the registry', () => {
    expect(
      helpBlock.length > 0,
      "voiceRegistry.ts: could not locate the `id: 'help'` tool block",
    ).toBe(true);
  });

  it('help tool mentions at least 8 distinct capabilities', () => {
    const lower = helpBlock.toLowerCase();
    const found = HELP_CAPABILITY_PROBES.filter((probe) => lower.includes(probe));
    expect(
      found.length >= 8,
      `voiceRegistry.ts help tool mentions only ${found.length} known capability probe(s) (${found.join(', ') || 'none'}); expected at least 8 distinct capabilities. Probes checked: ${HELP_CAPABILITY_PROBES.join(', ')}`,
    ).toBe(true);
  });

  it('assistant fallback uses buildClarification', () => {
    expect(
      assistant.includes('buildClarification'),
      'voiceAssistant.ts no longer references buildClarification; the LLM/no-match fallback must route through it',
    ).toBe(true);
  });
});
