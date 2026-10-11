import { queryOptions } from '@tanstack/react-query';
import { loadBudgetData } from './data';

export const budgetDataQueryKey = (userId: string) => ['budget-data', userId] as const;

export function budgetDataQueryOptions(userId: string) {
  return queryOptions({
    queryKey: budgetDataQueryKey(userId),
    queryFn: loadBudgetData,
    enabled: Boolean(userId),
  });
}
