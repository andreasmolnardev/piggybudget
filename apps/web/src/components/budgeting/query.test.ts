import { describe, expect, it, vi } from 'vitest';
import { budgetDataQueryKey, budgetDataQueryOptions } from './query';

vi.mock('../../api/pocketbase', () => ({
  pb: { authStore: { token: 'test-token', clear: () => undefined } },
}));

describe('budget data query', () => {
  it('uses a user-scoped cache key', () => {
    expect(budgetDataQueryKey('user-a')).toEqual(['budget-data', 'user-a']);
    expect(budgetDataQueryKey('user-a')).not.toEqual(budgetDataQueryKey('user-b'));
  });

  it('disables finance reads until an authenticated user is known', () => {
    expect(budgetDataQueryOptions('').enabled).toBe(false);
    expect(budgetDataQueryOptions('user-a').enabled).toBe(true);
  });
});
