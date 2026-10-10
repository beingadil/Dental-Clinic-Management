// @vitest-environment jsdom
/**
 * The case template library's close control.
 *
 * `CaseTemplateModalProps.onClose` was declared and never read: the component
 * took only `onApplyTemplate`, and the sole way to dismiss the library was the
 * X that CaseListView drew on the overlay wrapped around it. The component owns
 * its own dismissal now — like every other dialog in the app — so there is
 * exactly one close control and it cannot go missing when a caller forgets to
 * draw one.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    templates: [],
    caseTypes: [],
    deleteTemplate: () => {},
    saveAsTemplate: () => {},
  }),
}));

import { CaseTemplateModal } from '../../src/components/cases/CaseTemplateModal';

afterEach(cleanup);

describe('CaseTemplateModal close control', () => {
  it('dismisses through its own close button', () => {
    const onClose = vi.fn();
    render(<CaseTemplateModal onClose={onClose} />);

    fireEvent.click(screen.getByLabelText('Close template library'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders no dead close control when the caller passes no handler', () => {
    // A button with nothing behind it is worse than no button: it reads as a
    // way out and does nothing.
    render(<CaseTemplateModal />);

    expect(screen.queryByLabelText('Close template library')).toBeNull();
  });
});
