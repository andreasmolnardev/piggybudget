import type { Account, Budget } from './data';

export type BulkTransactionPayload = {
  account: string;
  date: string;
  amount: number;
  type: 'expense' | 'income' | 'adjustment';
  payee: string;
  description: string;
  category: string;
  budget: string;
  tags: string[];
  notes: string;
};

export function parseBulkTransactionJson(
  json: string,
  accounts: Account[],
  budgets: Budget[],
): BulkTransactionPayload[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Enter valid JSON.');
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 500) {
    throw new Error('Paste a JSON array with 1 to 500 transactions.');
  }

  return parsed.map((entry, index) => {
    const row = index + 1;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Transaction ${row} must be an object.`);
    }
    const item = entry as Record<string, unknown>;
    const accountRef = requiredString(item.account, row, 'account');
    const matchingAccounts = accounts.filter(
      (account) =>
        account.id === accountRef || account.name.toLowerCase() === accountRef.toLowerCase(),
    );
    if (matchingAccounts.length !== 1) {
      throw new Error(
        matchingAccounts.length
          ? `Transaction ${row} has an account name that is not unique. Use its ID.`
          : `Transaction ${row} refers to an unknown account: ${accountRef}.`,
      );
    }

    const date = requiredString(item.date, row, 'date');
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date
    ) {
      throw new Error(`Transaction ${row} date must use YYYY-MM-DD.`);
    }
    if (typeof item.amount !== 'number' || !Number.isFinite(item.amount) || item.amount <= 0) {
      throw new Error(`Transaction ${row} amount must be a positive number.`);
    }
    if (!['expense', 'income', 'adjustment'].includes(String(item.type))) {
      throw new Error(`Transaction ${row} type must be expense, income, or adjustment.`);
    }
    const type = item.type as BulkTransactionPayload['type'];
    const adjustment = item.adjustment ?? 'increase';
    if (type === 'adjustment' && !['increase', 'decrease'].includes(String(adjustment))) {
      throw new Error(`Transaction ${row} adjustment must be increase or decrease.`);
    }
    const budgetRef = optionalString(item.budget, row, 'budget');
    const matchingBudgets = budgetRef
      ? budgets.filter(
          (budget) =>
            budget.id === budgetRef || budget.category.toLowerCase() === budgetRef.toLowerCase(),
        )
      : [];
    if (budgetRef && matchingBudgets.length !== 1) {
      throw new Error(
        matchingBudgets.length
          ? `Transaction ${row} has a budget name that is not unique. Use its ID.`
          : `Transaction ${row} refers to an unknown budget: ${budgetRef}.`,
      );
    }
    if (
      item.tags !== undefined &&
      (!Array.isArray(item.tags) || !item.tags.every((tag) => typeof tag === 'string'))
    ) {
      throw new Error(`Transaction ${row} tags must be an array of strings.`);
    }
    const signedAmount =
      type === 'expense' || (type === 'adjustment' && adjustment === 'decrease')
        ? -item.amount
        : item.amount;

    return {
      account: matchingAccounts[0].id,
      date,
      amount: signedAmount,
      type,
      payee: optionalString(item.payee, row, 'payee'),
      description: optionalString(item.description, row, 'description'),
      category: optionalString(item.category, row, 'category'),
      budget: matchingBudgets[0]?.id ?? '',
      tags: (item.tags as string[] | undefined) ?? [],
      notes: optionalString(item.notes, row, 'notes'),
    };
  });
}

function requiredString(value: unknown, row: number, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Transaction ${row} needs a ${field}.`);
  }
  return value.trim();
}

function optionalString(value: unknown, row: number, field: string) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new Error(`Transaction ${row} ${field} must be text.`);
  return value.trim();
}
