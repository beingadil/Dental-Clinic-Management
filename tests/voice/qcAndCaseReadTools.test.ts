import { describe, it, expect } from 'vitest';
import {
  getQcCaseState, getQcInspectionLog, getQcSummary, getQcGateCheck, getQcReworkList, qcReasonCodeList,
  getCaseDetail, getCaseSearch, getCaseTimeline, getCaseNotes, getCaseAttachments, bulkArchivePreview, getDueTodayBriefing,
} from '../../src/services/voiceTools';
import { VOICE_TOOLS } from '../../src/services/voiceRegistry';
import type { QcInspection } from '../../src/types';

const caseA: any = {
  id: 'c1', case_number: 'DS-0001', patient_name: 'Mateen Ali', case_type_name: 'Zirconia Crown',
  status: 'ready', delivery_date: new Date().toISOString().slice(0, 10), teeth: [26, 27], shade: 'A2', priority: 'high',
  history: [{ id: 'h1', case_id: 'c1', status: 'ready', timestamp: '2026-11-20 10:00', updated_by: 'Mateen' }],
};
const caseB: any = {
  id: 'c2', case_number: 'DS-0002', patient_name: 'Talal Niazi', case_type_name: 'Emax Bridge',
  status: 'delivered', delivery_date: '2026-11-22', teeth: [31, 32], shade: 'M3', priority: 'normal', archived_at: null,
};
const caseC: any = {
  id: 'c3', case_number: 'DS-0003', patient_name: 'Fatma Unal', case_type_name: 'Zirconia Bridge',
  status: 'ready', delivery_date: new Date().toISOString().slice(0, 10), teeth: [41, 42], shade: 'A1', priority: 'high', archived_at: null,
};
const qcEvents: QcInspection[] = [
  { id: 'q1', case_id: 'c1', case_number: 'DS-0001', inspection_no: 1, kind: 'inspection', result: 'pass', reason_code: 'occlusion', inspector: 'Mateen', dedupe_key: 'd1', created_at: '2026-11-21 11:00' },
  { id: 'q2', case_id: 'c2', case_number: 'DS-0002', inspection_no: 1, kind: 'inspection', result: 'fail', reason_code: 'margin_fit', reason_text: 'fix margin', inspector: 'Talal', dedupe_key: 'd2', created_at: '2026-11-21 12:00' },
  { id: 'q3', case_id: 'c3', case_number: 'DS-0003', inspection_no: 1, kind: 'inspection', result: 'fail', reason_code: 'finish_polish', inspector: 'Mateen', dedupe_key: 'd3', created_at: '2026-11-21 13:00' },
] as unknown as QcInspection[];

const ctx: any = { labs: [{ id: 'l1', name: 'Mir Dental' }], invoices: [], advancePayments: [], accountAdjustments: [], cases: [caseA, caseB, caseC], qcInspections: qcEvents, caseNotes: { c1: [{ id: 'n1', case_id: 'c1', note_text: 'Waxed up by morning', author: 'Mateen', created_at: '2026-11-19 10:00' }] } as any, caseAttachments: { c1: [{ id: 'f1', case_id: 'c1', filename: 'CBCT.dicom', file_type: 'x-icon' }] } as any, user: null };

describe('QC + case read tools', () => {
  it('getQcCaseState reports pass with attempt count and gate', () => {
    const out = getQcCaseState(ctx, 'DS-0001');
    expect(out).toContain('DS-0001');
    expect(out).toContain('pass');
    expect(out).toMatch(/attempt 1/);
  });
  it('getQcGateCheck: passed case says gate open; open cases are generic', () => {
    expect(getQcGateCheck(ctx, 'DS-0001')).toContain('passed QC — gate open');
  });
  it('getQcSummary: returns first-pass string, never a fabricated 0% when data exists', () => {
    const s = getQcSummary(ctx);
    expect(s).toContain('QC summary');
    expect(s).not.toMatch(/\(0\)\s*cases/);
  });

  it('getCaseSearch returns the case by type', () => {
    const s = getCaseSearch(ctx, 'crown');
    expect(s).toContain('DS-0001');
  });

  it('bulkArchivePreview counts the old delivered case', () => {
    const ctxOld = { ...ctx, cases: ctx.cases.map((c: any) => (c.id === 'c2' ? { ...c, delivery_date: '2026-10-01' } : c)) };
    expect(bulkArchivePreview(ctxOld).count).toBe(1);
  });

  it('getDueTodayBriefing lists the case due today', () => {
    expect(getDueTodayBriefing(ctx)).toContain('DS-0001');
  });
  it('getQcReworkList includes the failing case(s)', () => {
    const s = getQcReworkList(ctx);
    expect(s).toContain('DS-0003');
    expect(s).toMatch(/failed attempt/);
  });
  it('getQcInspectionLog shows attempts + reasons', () => {
    const s = getQcInspectionLog(ctx, 'DS-0002');
    expect(s).toContain('inspection #1');
    expect(s).toContain('Margin Fit');
  });

  it('qcReasonCodeList includes the failure reasons from the standard list', () => {
    const codes = qcReasonCodeList();
    expect(codes).toContain('Margin Fit');
    expect(codes).toContain('Shade Mismatch');
  });
  it('getCaseDetail contains teeth and status (when allowClinicalDetail)', () => {
    const s = getCaseDetail(ctx, 'DS-0001');
    expect(s).toContain('DS-0001');
    expect(s).toContain('Zirconia Crown');
  });
  it('getCaseTimeline narrates history', () => {
    const s = getCaseTimeline(ctx, 'DS-0001');
    expect(s).toContain('DS-0001');
    expect(s).toMatch(/ready/);
  });
  it('getCaseNotes returns note text', () => {
    expect(getCaseNotes(ctx, 'DS-0001')).toContain('Waxed up by morning');
  });
  it('getCaseAttachments lists files by category', () => {
    expect(getCaseAttachments(ctx, 'DS-0001')).toContain('CBCT');
  });
});

describe('VOICE_TOOLS registry (Tier-1+4 read tools)', () => {
  it('registers all new read tools', () => {
    const ids = VOICE_TOOLS.map((t) => t.id);
    for (const id of ['qc_state', 'qc_gate_check', 'qc_inspection_log', 'qc_metrics_summary', 'qc_rework', 'qc_reasons', 'case_detail', 'case_search', 'case_timeline', 'case_notes_list', 'case_attachments', 'dueToday']) {
      expect(ids).toContain(id);
    }
  });
  it('qc_state tool runs read-only', async () => {
    const tool = VOICE_TOOLS.find((t) => t.id === 'qc_state')!;
    expect(tool.risk).toBe('read');
    const r = await tool.run(ctx, { caseNumber: 'DS-0001' });
    expect(r?.kind).toBe('read');
  });
});
