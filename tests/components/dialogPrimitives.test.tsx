// @vitest-environment jsdom
import React, { useRef, useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Modal } from '../../src/components/common/ui/Modal';
import { ConfirmDialog } from '../../src/components/common/ui/ConfirmDialog';
import { InvoiceStatusBadge } from '../../src/components/common/ui/Badge';

afterEach(cleanup);

/**
 * D5 — component-level coverage for the V-19 dialog contract. These are the
 * behaviours that only exist in the DOM (focus, Escape, stacking), so they
 * cannot be pinned by the service tests.
 */

const modal = (props: Partial<React.ComponentProps<typeof Modal>> = {}) => (
  <Modal open onClose={() => {}} label="Job slip" {...props}>
    <button type="button">First</button>
    <button type="button">Last</button>
  </Modal>
);

describe('Modal (V-19)', () => {
  it('exposes the dialog semantics every caller used to hand-roll', () => {
    render(modal());

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Job slip');
  });

  it('closes on Escape and ignores it once closed', () => {
    const onClose = vi.fn();
    const { rerender } = render(modal({ onClose }));

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<div />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab inside the panel, wrapping at both ends', () => {
    render(modal());

    const first = screen.getByText('First');
    const last = screen.getByText('Last');
    const close = screen.getByLabelText('Close Job slip');

    close.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(close); // last focusable stays put

    last.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(close);

    first.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(first); // first wraps on shift-Tab
  });

  it('lets only the topmost dialog answer Escape', () => {
    const closeUnder = vi.fn();
    const closeTop = vi.fn();

    render(
      <>
        <Modal open onClose={closeUnder} label="Invoice drawer">
          <button type="button">Under</button>
        </Modal>
        <Modal open onClose={closeTop} label="Reverse payment" zIndex="z-[60]">
          <button type="button">Top</button>
        </Modal>
      </>,
    );

    fireEvent.keyDown(window, { key: 'Escape' });

    // A local listener in the drawer would have closed both layers.
    expect(closeTop).toHaveBeenCalledTimes(1);
    expect(closeUnder).not.toHaveBeenCalled();
  });

  it('returns focus to the control that opened it', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { rerender } = render(modal());
    rerender(<div />);
    expect(document.activeElement).toBe(opener);

    opener.remove();
  });

  it('does not render anything while closed', () => {
    render(modal({ open: false }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('carries a caller-supplied print class on the card itself', () => {
    render(modal({ cardClassName: 'print-area printable-area' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('print-area');
    // The print contract needs the card to be the outermost printable node.
    expect(dialog.parentElement?.className).not.toContain('print-area');
  });
});

describe('ConfirmDialog (B4/B10)', () => {
  it('cannot confirm until the typed phrase matches', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Void invoice INV-1"
        consequences={['Reverses posted payments']}
        confirmLabel="Void invoice"
        typedPhrase="VOID"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    const confirm = screen.getByRole('button', { name: 'Void invoice' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Type/i), { target: { value: 'void' } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('ships the consequence list to the reader', () => {
    render(
      <ConfirmDialog
        open
        title="Void invoice"
        consequences={['Reverses posted payments', 'Restores the receivable']}
        confirmLabel="Void"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByText('Restores the receivable')).toBeTruthy();
  });
});

describe('InvoiceStatusBadge (V-18)', () => {
  it('maps every invoice state to one readable chip', () => {
    const { rerender } = render(<InvoiceStatusBadge status="paid" />);
    expect(screen.getByText('Paid')).toBeTruthy();

    rerender(<InvoiceStatusBadge status="overdue" />);
    expect(screen.getByText('Overdue')).toBeTruthy();

    rerender(<InvoiceStatusBadge status="partially_paid" />);
    expect(screen.getByText('Partial')).toBeTruthy();

    rerender(<InvoiceStatusBadge status="voided" />);
    expect(screen.getByText('Voided')).toBeTruthy();
  });
});

/**
 * The drawer and the dialogs are always mounted and return null while closed;
 * this pins that a reopen still traps focus (the effect has to re-arm).
 */
describe('Modal re-open', () => {
  it('re-arms the focus trap after a close/open cycle', () => {
    const Harness = () => {
      const [open, setOpen] = useState(false);
      const openerRef = useRef<HTMLButtonElement>(null);
      return (
        <div>
          <button ref={openerRef} type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Modal open={open} onClose={() => setOpen(false)} label="Reopen">
            <button type="button">Inside</button>
          </Modal>
        </div>
      );
    };

    render(<Harness />);
    fireEvent.click(screen.getByText('Open'));
    expect(document.activeElement).toBe(screen.getByLabelText('Close Reopen'));

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByText('Open'));
    expect(document.activeElement).toBe(screen.getByLabelText('Close Reopen'));
  });
});
