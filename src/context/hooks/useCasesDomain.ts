import { useState } from 'react';
import { DentalCase, DentalLab, CaseType, CaseAttachment, CaseNote, QcInspection } from '../../types';
import {
  attachmentsRepo, caseNotesRepo, qcInspectionsRepo,
} from '../../db/repos';
import { hydrateAllFromDb, dbMirror, dbRows, sqliteDb, attachmentsByCase, groupByCase } from './domainState';
import { isDatabaseReady } from '../../db/core';

/**
 * Cases domain state — cases, labs, case types, per-case attachments/notes and
 * the QC inspection stream. Extracted from AppContext with an identical
 * surface: values plus raw setters, so restore/wipe flows keep setting them
 * directly. Persistence stays in AppContext's sync effect.
 */
export function useCasesDomain() {
  const [cases, setCases] = useState<DentalCase[]>(() => {
    if (hydrateAllFromDb() && dbMirror['cases']) return dbMirror['cases'] as DentalCase[];
    return sqliteDb.cases.getAll();
  });
  const [labs, setLabs] = useState<DentalLab[]>(() => {
    if (dbMirror['labs']) return dbMirror['labs'] as DentalLab[];
    return sqliteDb.labs.getAll();
  });
  const [caseTypes, setCaseTypes] = useState<CaseType[]>(() => {
    if (dbMirror['caseTypes']) return dbMirror['caseTypes'] as CaseType[];
    return sqliteDb.caseTypes.getAll();
  });

  const [caseAttachments, setCaseAttachments] = useState<Record<string, CaseAttachment[]>>(() => dbRows('caseAttachments', () => attachmentsByCase(attachmentsRepo.all())));

  const [caseNotes, setCaseNotes] = useState<Record<string, CaseNote[]>>(() => dbRows('caseNotes', () => groupByCase(caseNotesRepo.all()) as unknown as Record<string, CaseNote[]>));

  /* Quality control: the append-only inspection stream (SQLite is authoritative,
     React state mirrors it and the write-through sync persists it). */
  const [qcInspections, setQcInspections] = useState<QcInspection[]>(() => {
    if (isDatabaseReady()) {
      try { return qcInspectionsRepo.all(); } catch { /* fall through */ }
    }
    return [];
  });

  return {
    cases, setCases,
    labs, setLabs,
    caseTypes, setCaseTypes,
    caseAttachments, setCaseAttachments,
    caseNotes, setCaseNotes,
    qcInspections, setQcInspections,
  };
}
