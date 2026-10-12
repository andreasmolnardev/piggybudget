import { describe, expect, it } from 'vitest';
import { checkpointsMatchingHistory, type Checkpoint, type Transaction } from './data';

describe('checkpointsMatchingHistory', () => {
  it('matches checkpoints to transactions on the same account and date', () => {
    const checkpoints: Checkpoint[] = [
      {
        id: 'same-day',
        accountId: 'checking',
        account: 'Checking',
        date: '2026-10-12',
        balance: 125,
      },
      {
        id: 'other-account',
        accountId: 'savings',
        account: 'Savings',
        date: '2026-10-12',
        balance: 500,
      },
      {
        id: 'other-date',
        accountId: 'checking',
        account: 'Checking',
        date: '2026-10-11',
        balance: 100,
      },
    ];
    const transactions = [
      { accountId: 'checking', date: '2026-10-12' },
    ] as Transaction[];

    expect(checkpointsMatchingHistory(checkpoints, transactions)).toEqual([checkpoints[0]]);
  });
});
