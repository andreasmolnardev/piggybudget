import { describe, expect, it } from 'vitest';
import {
  budgetNameForId,
  budgetCarryoverAdjustments,
  categorySpendForRange,
  formatTransactionGroupDate,
  historyDatesForDisplay,
  transactionEditId,
  type Budget,
  type Checkpoint,
  type Transaction,
} from './data';

describe('budgetNameForId', () => {
  const budgets = [{ id: 'budget-id', category: 'Groceries' }] as Budget[];

  it('resolves the display name from a budget ID', () => {
    expect(budgetNameForId(budgets, 'budget-id')).toBe('Groceries');
  });

  it('returns no name when the budget ID is missing or unknown', () => {
    expect(budgetNameForId(budgets)).toBeUndefined();
    expect(budgetNameForId(budgets, 'unknown')).toBeUndefined();
  });
});

describe('budgetCarryoverAdjustments', () => {
  const budgets = [
    {
      id: 'food-prev',
      category: 'Food',
      limit: 100,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      surplusAction: 'carry',
    },
    {
      id: 'fun-prev',
      category: 'Fun',
      limit: 50,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      surplusAction: 'push',
      surplusTarget: 'Food',
    },
    {
      id: 'travel-prev',
      category: 'Travel',
      limit: 40,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      deficitAction: 'pull',
      deficitSource: 'Food',
    },
  ] as Budget[];

  it('carries surplus, pushes surplus, and transfers deficit coverage', () => {
    const transactions = [
      { budgetId: 'food-prev', category: 'Food', kind: 'expense', amount: 70, date: '2026-09-10' },
      { budgetId: 'fun-prev', category: 'Fun', kind: 'expense', amount: 30, date: '2026-09-10' },
      {
        budgetId: 'travel-prev',
        category: 'Travel',
        kind: 'expense',
        amount: 55,
        date: '2026-09-10',
      },
    ] as Transaction[];

    expect(budgetCarryoverAdjustments(budgets, transactions, '2026-10')).toEqual(
      new Map([
        ['food', 35],
        ['travel', 15],
      ]),
    );
  });
});

describe('categorySpendForRange', () => {
  it('sums expenses in the selected span and keeps budget categories with no spend', () => {
    const transactions = [
      { category: 'Food', amount: 12, kind: 'expense', date: '2026-10-04' },
      { category: 'Food', amount: 8, budgetAmount: 6, kind: 'expense', date: '2026-10-12' },
      { category: 'Food', amount: 50, kind: 'expense', date: '2026-09-30' },
      { category: 'Pay', amount: 100, kind: 'income', date: '2026-10-12' },
      { category: '', amount: 3, kind: 'expense', date: '2026-10-15' },
      { category: 'Draft', amount: 25, kind: 'expense', date: '2026-10-15', isDraft: true },
    ] as Transaction[];
    const budgets = [
      { id: 'food', category: 'Food' },
      { id: 'home', category: 'Home' },
    ] as Budget[];

    expect(categorySpendForRange(transactions, budgets, '2026-10-01', '2026-10-31')).toEqual([
      { category: 'Food', spent: 18 },
      { category: 'Home', spent: 0 },
      { category: 'Uncategorized', spent: 3 },
    ]);
  });
});

describe('historyDatesForDisplay', () => {
  it('includes every checkpoint date even when there is no transaction', () => {
    const checkpoints: Checkpoint[] = [
      {
        id: 'today',
        accountId: 'checking',
        account: 'Checking',
        date: '2026-10-12',
        balance: 125,
      },
      {
        id: 'earlier',
        accountId: 'savings',
        account: 'Savings',
        date: '2026-10-10',
        balance: 500,
      },
    ];
    const transactions = [{ accountId: 'checking', date: '2026-10-11' }] as Transaction[];

    expect(historyDatesForDisplay(transactions, checkpoints)).toEqual([
      '2026-10-12',
      '2026-10-11',
      '2026-10-10',
    ]);
  });

  it('does not repeat a date shared by transactions and checkpoints', () => {
    const checkpoints: Checkpoint[] = [
      {
        id: 'first',
        accountId: 'checking',
        account: 'Checking',
        date: '2026-10-12',
        balance: 125,
      },
      {
        id: 'second',
        accountId: 'savings',
        account: 'Savings',
        date: '2026-10-12',
        balance: 500,
      },
    ];
    const transactions = [{ accountId: 'checking', date: '2026-10-12' }] as Transaction[];

    expect(historyDatesForDisplay(transactions, checkpoints)).toEqual(['2026-10-12']);
  });
});

describe('formatTransactionGroupDate', () => {
  it('shows the weekday with the month and day', () => {
    expect(formatTransactionGroupDate('2022-10-03', 'en-US')).toBe('Mon Oct 3');
  });
});

describe('transactionEditId', () => {
  it('uses no existing ID when making a duplicate', () => {
    expect(transactionEditId({ id: 'original' } as Transaction, true, null)).toBeUndefined();
  });

  it('keeps the existing ID when editing a transaction', () => {
    expect(transactionEditId({ id: 'original' } as Transaction, false, null)).toBe('original');
  });
});
