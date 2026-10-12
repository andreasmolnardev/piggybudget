import { queryOptions } from '@tanstack/react-query';
import { loadBudgetData } from './data';

export const budgetDataQueryKey = (userId: string) => ['budget-data', userId] as const;

export function budgetDataQueryOptions(userId: string) {
  return queryOptions({
    queryKey: budgetDataQueryKey(userId),
    queryFn: loadBudgetData,
    enabled: Boolean(userId),
    refetchInterval: (query) => {
      const nextDueAt = query.state.data?.data.recurringTransactions
        .filter((rule) => rule.active)
        .map((rule) => Date.parse(`${rule.nextDate.slice(0, 10)}T00:00:00.000Z`))
        .filter(Number.isFinite)
        .sort((first, second) => first - second)[0];
      if (nextDueAt === undefined) return false;
      const untilDue = nextDueAt - Date.now();
      return untilDue > 0 ? untilDue : 60_000;
    },
  });
}
