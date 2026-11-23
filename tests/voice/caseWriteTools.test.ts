/**
 * Tier 2/3 case write tools — registry behavior (pending payload + risk).
 *
 * Runs tools through the registry table (no React): assert the pending
 * WriteCommand shape and that destructive tools surface risk 'destructive'.
 * Tools now take structured args (as Groq would provide), not raw strings.
 */
import { describe, it, expect } from 'vitest';
import { VOICE_TOOLS } from '../../src/services/voiceRegistry';

const cases: any[] = [
  { id: 'c1', case_number: 'DS-0001', patient_name: 'Mateen Ali', case_type_name: 'Zirconia Crown', status: 'ready', priority: 'normal', shade: 'A2', material: 'zirconia', archived_at: null },
  { id: 'c2', case_number: 'DS-0002', patient_name: 'Talal Niazi', case_type_name: 'Emax Bridge', status: 'ready', priority: 'normal', archived_at: null },
];
const ctx: any = { labs: [], invoices: [], advancePayments: [], accountAdjustments: [], cases, user: null };

const run = async (id: string, args: Record<string, unknown>): Promise<any> => {
  const tool = VOICE_TOOLS.find((t) => t.id === id)!;
  expect(tool, `tool ${id} must exist`).toBeTruthy();
  return tool.run(ctx, args);
};

describe('Tier 2 — case write tools', () => {
  it('caseUpdateFields queues fields + amber risk', async () => {
    const r: any = await run('caseUpdateFields', { caseNumber: 'DS-0001', shade: 'A2', priority: 'urgent' });
    expect(r.kind).toBe('action');
    expect(r.risk).toBe('write');
    expect(r.pending.kind).toBe('caseUpdateFields');
    expect(r.pending.caseNumber).toBe('DS-0001');
    expect(r.pending.updateFields.shade).toBe('A2');
    expect(r.pending.updateFields.priority).toBe('urgent');
  });

  it('caseUpdateFields reads material and instructions', async () => {
    const r: any = await run('caseUpdateFields', { caseNumber: 'DS-0001', material: 'zirconia', instructions: 'crown polished' });
    expect(r.kind).toBe('action');
    expect(r.pending.updateFields.material).toBe('zirconia');
    expect(r.pending.updateFields.instructions).toBe('crown polished');
  });

  it('casePriority queues the priority change', async () => {
    const r: any = await run('casePriority', { caseNumber: 'DS-0001', priority: 'high' });
    expect(r.kind).toBe('action');
    expect(r.risk).toBe('write');
    expect(r.pending.kind).toBe('casePriority');
    expect(r.pending.caseNumber).toBe('DS-0001');
    expect(r.pending.priority).toBe('high');
  });

  it('casePriority also accepts urgent', async () => {
    const r: any = await run('casePriority', { caseNumber: 'DS-0001', priority: 'urgent' });
    expect(r.kind).toBe('action');
    expect(r.pending.priority).toBe('urgent');
  });

  it('bulkCaseStatus queues every listed case', async () => {
    const r: any = await run('bulkCaseStatus', { caseNumbers: ['DS-0001', 'DS-0002'], targetStatus: 'ready' });
    expect(r.kind).toBe('action');
    expect(r.risk).toBe('write');
    expect(r.pending.kind).toBe('bulkCaseStatus');
    expect(r.pending.bulkCaseNumbers).toEqual(['DS-0001', 'DS-0002']);
    expect(r.pending.targetStatus).toBe('ready');
  });

  it('restoreCase queues the unarchive', async () => {
    const r: any = await run('restoreCase', { caseNumber: 'DS-0001' });
    expect(r.kind).toBe('action');
    expect(r.pending.kind).toBe('restoreCase');
    expect(r.pending.caseNumber).toBe('DS-0001');
  });

  it('caseTemplateSave queues the template name', async () => {
    const r: any = await run('caseTemplateSave', { caseNumber: 'DS-0001', templateName: 'Retraced Crown' });
    expect(r.kind).toBe('action');
    expect(r.pending.kind).toBe('caseTemplateSave');
    expect(r.pending.caseNumber).toBe('DS-0001');
    expect(r.pending.templateName).toContain('Retraced Crown');
  });
});

describe('Tier 3 — destructive tools', () => {
  it('deleteCase is destructive with the case number', async () => {
    const r: any = await run('deleteCase', { caseNumber: 'DS-0001' });
    expect(r.kind).toBe('action');
    expect(r.risk).toBe('destructive');
    expect(r.pending.kind).toBe('deleteCase');
    expect(r.pending.caseNumber).toBe('DS-0001');
  });

  it('purgeCase is destructive with the case number', async () => {
    const r: any = await run('purgeCase', { caseNumber: 'DS-0002' });
    expect(r.kind).toBe('action');
    expect(r.risk).toBe('destructive');
    expect(r.pending.kind).toBe('purgeCase');
    expect(r.pending.caseNumber).toBe('DS-0002');
  });

  it('returns a natural question when no case number is given', async () => {
    const r: any = await run('deleteCase', {});
    expect(r.kind).toBe('read');
    expect(r.text).toContain('Which case');
    expect(r.text).not.toContain('Say:');
  });
});
