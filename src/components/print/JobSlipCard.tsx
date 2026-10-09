import React from 'react';
import { DentalCase } from '../../types';
import { QRCodeSVG } from 'qrcode.react';
import { slipBandFor, guessCategory } from '../../lib/slipBanding';
import { receivedDateFor } from '../../utils/dateUtils';
import { formatDoctorName } from '../../utils/doctorName';

/**
 * Compact physical laboratory job tag — the ONE true job slip.
 *
 * Fixed physical geometry: 100 mm × 95 mm cutting area (mm units only —
 * never scaled, never zoomed, never responsive). Used by BOTH print modes:
 *
 *   MODE A — single slip: 100 × 95 mm page (A4 fallback keeps this size)
 *   MODE B — A4 batch:    six of these on 210 × 297 mm, 2 cols × 3 rows
 *
 * Identical component in both modes guarantees a standalone slip is
 * physically equivalent to one slip cut from the 6-up sheet.
 *
 * Design: black-and-white friendly work label. High contrast, compact
 * typography, ~4mm safe padding inside the 0.3mm cutting border.
 * Long values wrap; optional fields render nothing when absent.
 */

const fmtDate = (d?: string | null): string => {
  if (!d) return '';
  const parsed = new Date(d);
  if (isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
};

interface JobSlipCardProps {
  caseData: DentalCase;
  /** Lab name for the letterhead line (from branding settings). */
  labName?: string;
  /** Lab logo for the letterhead (from branding settings); omitted → none. */
  logoUrl?: string;
}

export const JobSlipCard: React.FC<JobSlipCardProps> = ({ caseData: c, labName, logoUrl }) => {
  const teeth = (c.selected_teeth || []).map((t) => `#${t}`).join(', ');
  // The tag carries the day the lab received the job, not the future promised
  // delivery date — a bag in a pile is sorted by when it arrived.
  const receivedDate = receivedDateFor(c);
  const instructions = (c.instructions || '').trim();
  const band = slipBandFor(guessCategory(c.case_type_name));

  return (
    <div className="job-slip-card">
      {/* Category band — the edge strip that makes job bags sortable at a
          glance. Paired hue + luminance keeps groups distinct in grayscale. */}
      <div className="js-band" style={{ backgroundColor: band.background }} title={band.label} />
      <div className="job-slip-body">
      {/* Letterhead + QR — the only non-essential block, kept tiny */}
      <div className="js-head">
        {logoUrl && <img src={logoUrl} alt="" className="js-logo" />}
        <div className="js-lab">{labName || 'DENTAL LAB'}</div>
        <div className="js-doc-title">JOB SLIP</div>
        <div className="js-qr">
          <QRCodeSVG
            value={JSON.stringify({
              n: c.case_number,
              p: c.patient_name || undefined,
              t: c.selected_teeth,
              received: receivedDate,
            })}
            size={44}
            level="M"
          />
        </div>
      </div>

      {/* Case ID — the hero: instantly visible in a pile of job bags */}
      <div className="js-id">{c.case_number}</div>

      {/* Identity grid — Patient always printed (even when unnamed, the lab
          still needs to see the slot); other optional fields render nothing. */}
      <div className="js-grid">
        <div className="js-row">
          <span className="js-k">Patient</span>
          <span className="js-v">{c.patient_name || '—'}</span>
        </div>
        {c.doctor_name && (
          <div className="js-row">
            <span className="js-k">Doctor</span>
            <span className="js-v">{formatDoctorName(c.doctor_name)}</span>
          </div>
        )}
        {c.lab_name && (
          <div className="js-row">
            <span className="js-k">Clinic</span>
            <span className="js-v">{c.lab_name}</span>
          </div>
        )}
        {teeth && (
          <div className="js-row">
            <span className="js-k">Teeth</span>
            <span className="js-v js-mono">{teeth}</span>
          </div>
        )}
        {c.case_type_name && (
          <div className="js-row">
            <span className="js-k">Material</span>
            <span className="js-v">{c.case_type_name}</span>
          </div>
        )}
        {c.shade && (
          <div className="js-row">
            <span className="js-k">Shade</span>
            <span className="js-v js-mono">{c.shade}</span>
          </div>
        )}
        <div className="js-row">
          <span className="js-k">Priority</span>
          <span className="js-v js-strong">{(c.priority || 'normal').toUpperCase()}</span>
        </div>
        {c.status && (
          <div className="js-row">
            <span className="js-k">Stage</span>
            <span className="js-v">{String(c.status).replace(/_/g, ' ')}</span>
          </div>
        )}
      </div>

      {/* Received-date band — second-most-visible line */}
      <div className="js-due">
        <span className="js-due-k">RECEIVED</span>
        <span className="js-due-v">{fmtDate(receivedDate) || receivedDate}</span>
        <span className="js-due-t">05:00 PM</span>
      </div>

      {/* Workstation instructions — wrap within the slip, never overlap */}
      {instructions && (
        <div className="js-notes">
          <span className="js-notes-k">NOTES </span>
          {instructions}
        </div>
      )}
      </div>
    </div>
  );
};
