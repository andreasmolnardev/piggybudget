import { describe, expect, it } from 'vitest';
import { parseBulkTransactionJson } from './bulk-transaction-import';
import type { Account, Budget } from './data';

const accounts = [{ id: 'checking-id', name: 'Checking' }] as Account[];
const budgets = [{ id: 'food-id', category: 'Food' }] as Budget[];

describe('parseBulkTransactionJson', () => {
  it('resolves account and budget names and applies transaction signs', () => {
    const transactions = parseBulkTransactionJson(
      JSON.stringify([
        {
          account: 'Checking',
          date: '2026-10-25',
          amount: 12.5,
          type: 'expense',
          payee: 'Market',
          budget: 'Food',
          tags: ['home'],
        },
        {
          account: 'checking-id',
          date: '2026-10-26',
          amount: 8,
          type: 'income',
        },
      ]),
      accounts,
      budgets,
    );

    expect(transactions).toEqual([
      {
        account: 'checking-id',
        date: '2026-10-25',
        amount: -12.5,
        type: 'expense',
        payee: 'Market',
        description: '',
        category: '',
        budget: 'food-id',
        tags: ['home'],
        notes: '',
      },
      {
        account: 'checking-id',
        date: '2026-10-26',
        amount: 8,
        type: 'income',
        payee: '',
        description: '',
        category: '',
        budget: '',
        tags: [],
        notes: '',
      },
    ]);
  });

  it('reports the row with an unknown account', () => {
    expect(() =>
      parseBulkTransactionJson(
        JSON.stringify([{ account: 'Missing', date: '2026-10-25', amount: 3, type: 'expense' }]),
        accounts,
        budgets,
      ),
    ).toThrow('Transaction 1 refers to an unknown account: Missing.');
  });
});
