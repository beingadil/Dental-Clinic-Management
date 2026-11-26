import { strToU8, zipSync } from 'fflate';
import { saveFile, type SaveFileResult } from '../lib/saveFile';
import type { LedgerReportRow, LedgerReportSummary } from './ledgerReport';
import {
  LEDGER_EXPORT_HEADERS,
  ledgerExportRows,
  type LedgerCsvMeta,
} from './ledgerCsv';

type Cell = string | number;
interface StyledCell {
  value: Cell;
  style?: number;
}

const xml = (value: Cell): string =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const column = (index: number): string => {
  let n = index + 1;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
};

const cellXml = (ref: string, cell: StyledCell): string => {
  const style = cell.style ? ` s="${cell.style}"` : '';
  if (typeof cell.value === 'number') {
    return `<c r="${ref}"${style}><v>${cell.value}</v></c>`;
  }
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xml(cell.value)}</t></is></c>`;
};

const rowXml = (rowNumber: number, cells: StyledCell[]): string => {
  if (cells.length === 0) return `<row r="${rowNumber}"/>`;
  const values = cells
    .map((cell, index) => cellXml(`${column(index)}${rowNumber}`, cell))
    .join('');
  return `<row r="${rowNumber}" spans="1:${cells.length}">${values}</row>`;
};

const sheetXml = (rows: StyledCell[][], widths: number[], freeze = false, filterTo = 0): string => {
  const cols = widths
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join('');
  const sheetData = rows.map((cells, index) => rowXml(index + 1, cells)).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0">' +
    (freeze ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : '') +
    '</sheetView></sheetViews>' +
    `<cols>${cols}</cols>` +
    `<sheetData>${sheetData}</sheetData>` +
    (filterTo > 1 ? `<autoFilter ref="A1:Q${filterTo}"/>` : '') +
    '</worksheet>'
  );
};

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
  <fonts count="3">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1B3046"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border/>
    <border><bottom style="thin"><color rgb="FFB7C2CC"/></bottom></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="164" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Ledger" sheetId="1" r:id="rId1"/><sheet name="Summary" sheetId="2" r:id="rId2"/></sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const appXml = (): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Dental Solutions</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company>Dental Solutions</Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.0</AppVersion>
</Properties>`;

const coreXml = (title: string, generatedOn: string): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xml(title)}</dc:title><dc:creator>Dental Solutions</dc:creator><cp:lastModifiedBy>Dental Solutions</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${xml(generatedOn)}T00:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${xml(generatedOn)}T00:00:00Z</dcterms:modified>
</cp:coreProperties>`;

/** Build a real OOXML workbook with two sheets: transactions and summary. */
export function buildLedgerXlsx(
  rows: LedgerReportRow[],
  summary: LedgerReportSummary,
  meta: LedgerCsvMeta,
): Uint8Array {
  const body = ledgerExportRows(rows, meta.settlementByRow);
  const transactionRows: StyledCell[][] = [
    LEDGER_EXPORT_HEADERS.map((value) => ({ value, style: 1 })),
    ...body.map((values) => values.map((value, index) => ({
      value,
      style: index >= 5 && index <= 7 && typeof value === 'number' ? 2 : 0,
    }))),
  ];
  transactionRows.push([]);
  transactionRows.push([
    { value: 'TOTAL PERIOD ACTIVITY', style: 4 },
    { value: '', style: 4 },
    { value: '', style: 4 },
    { value: '', style: 4 },
    { value: '', style: 4 },
    { value: summary.totalDebits, style: 3 },
    { value: summary.totalCredits, style: 3 },
    { value: summary.closingBalance, style: 3 },
  ]);
  transactionRows.push([
    { value: 'TRANSACTIONS', style: 4 },
    { value: summary.transactionCount, style: 4 },
  ]);
  transactionRows.push([
    { value: 'OPENING BALANCE', style: 4 },
    { value: '', style: 4 },
    { value: '', style: 4 },
    { value: '', style: 4 },
    { value: '', style: 4 },
    { value: '', style: 4 },
    { value: '', style: 4 },
    { value: summary.openingBalance, style: 3 },
  ]);
  transactionRows.push([
    { value: 'CLOSING BALANCE', style: 4 },
    { value: '', style: 4 },
    { value: '', style: 4 },
    { value: '', style: 4 },
    { value: '', style: 4 },
    { value: '', style: 4 },
    { value: '', style: 4 },
    { value: summary.closingBalance, style: 3 },
  ]);

  const summaryRows: StyledCell[][] = [
    [{ value: 'GENERAL LEDGER SUMMARY', style: 1 }],
    [{ value: 'Clinic', style: 4 }, { value: meta.clinicLabel }],
    [{ value: 'Period', style: 4 }, { value: meta.periodLabel }],
    [{ value: 'Account', style: 4 }, { value: meta.accountLabel }],
    [{ value: 'Generated', style: 4 }, { value: meta.generatedOn }],
    [],
    [{ value: 'Opening balance', style: 4 }, { value: summary.openingBalance, style: 2 }],
    [{ value: 'Total debits', style: 4 }, { value: summary.totalDebits, style: 2 }],
    [{ value: 'Total credits', style: 4 }, { value: summary.totalCredits, style: 2 }],
    [{ value: 'Closing balance', style: 4 }, { value: summary.closingBalance, style: 2 }],
    [{ value: 'Transactions', style: 4 }, { value: summary.transactionCount }],
  ];

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'docProps/app.xml': strToU8(appXml()),
    'docProps/core.xml': strToU8(coreXml(`General Ledger - ${meta.clinicLabel}`, meta.generatedOn)),
    'xl/workbook.xml': strToU8(WORKBOOK),
    'xl/_rels/workbook.xml.rels': strToU8(WORKBOOK_RELS),
    'xl/styles.xml': strToU8(STYLES),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml(
      transactionRows,
      [13, 16, 12, 18, 52, 14, 14, 15, 30, 24, 20, 18, 8, 12, 12, 12, 35],
      true,
      body.length + 1,
    )),
    'xl/worksheets/sheet2.xml': strToU8(sheetXml(summaryRows, [22, 34])),
  };
  return zipSync(files, { level: 6 });
}

export function saveLedgerXlsx(fileName: string, bytes: Uint8Array): Promise<SaveFileResult> {
  return saveFile(fileName, bytes, {
    extension: '.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    dialogTitle: 'Export Excel workbook',
  });
}