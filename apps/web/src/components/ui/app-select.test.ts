import { describe, expect, it } from 'vitest';
import { selectedOptionLabel } from './app-select';

describe('selectedOptionLabel', () => {
  it('shows an option label for its selected value', () => {
    expect(
      selectedOptionLabel(
        [{ value: 'account-id', label: 'Everyday checking · Checking' }],
        'account-id',
      ),
    ).toBe('Everyday checking · Checking');
  });

  it('falls back to the value when there is no matching option', () => {
    expect(selectedOptionLabel([], 'account-id')).toBe('account-id');
  });
});
