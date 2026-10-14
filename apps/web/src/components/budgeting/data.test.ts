import { describe, expect, it } from 'vitest';
import { historyDatesForDisplay, type Checkpoint, type Transaction } from './data';

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
