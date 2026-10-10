// @vitest-environment jsdom
/**
 * The lab address form's country field.
 *
 * `country` was a state constant with no setter and no input anywhere in the
 * form, yet it was submitted on every save — so each address silently stored
 * the same value and an operator had no way to correct it. It is a real field
 * now, and it is validated the way its neighbours are.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const { added } = vi.hoisted(() => ({ added: [] as unknown[] }));

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    labContacts: [],
    labAddresses: [],
    addLabContact: () => {},
    deleteLabContact: () => {},
    addLabAddress: (address: unknown) => {
      added.push(address);
    },
    deleteLabAddress: () => {},
  }),
}));

import { LabContactsManager } from '../../src/components/labs/LabContactsManager';

beforeEach(() => {
  added.length = 0;
});

afterEach(cleanup);

/** Open the address form and fill the one field the validator requires. */
const openFilledForm = () => {
  render(<LabContactsManager labId="lab-1" />);
  fireEvent.click(screen.getByText('Add Address'));
  const street = screen.getByPlaceholderText('Suite 402, Blue Area...');
  fireEvent.change(street, { target: { value: '12 Jinnah Avenue, Blue Area' } });
  return { form: street.closest('form') as HTMLFormElement, country: screen.getByLabelText('Country') };
};

describe('LabContactsManager address country', () => {
  it('exposes the country as an editable field, defaulted as before', () => {
    const { country } = openFilledForm();

    // The default is unchanged; what is new is that the operator can move it.
    expect((country as HTMLInputElement).value).toBe('Pakistan');
    expect((country as HTMLInputElement).disabled).toBe(false);
  });

  it('saves the country the operator actually typed', () => {
    const { form, country } = openFilledForm();

    fireEvent.change(country, { target: { value: 'United Arab Emirates' } });
    fireEvent.submit(form);

    expect(added).toHaveLength(1);
    expect((added[0] as { country: string }).country).toBe('United Arab Emirates');
  });

  it('refuses to save an address with no country, and says why', () => {
    // The original defect saved an empty country in silence.
    const { form, country } = openFilledForm();

    fireEvent.change(country, { target: { value: '   ' } });
    fireEvent.submit(form);

    expect(added).toHaveLength(0);
    expect(screen.getByText('Country is required')).toBeTruthy();
  });
});
