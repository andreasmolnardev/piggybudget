import type { RecordModel } from 'pocketbase';
import { apiRequest } from '../../api/client';

export type TransactionKind = 'expense' | 'income' | 'transfer' | 'adjustment';
export type FinanceRecordType = 'transaction' | 'account' | 'budget' | 'asset' | 'goal';
export type FinanceRecordTarget = { type: FinanceRecordType; id: string };

export type Transaction = {
  id: string;
  merchant: string;
  category: string;
  account: string;
  accountId?: string;
  amount: number;
  kind: TransactionKind;
  date: string;
  budgetId?: string;
  note?: string;
  tags?: string[];
  cleared?: boolean;
  reconciled?: boolean;
  receipt?: string;
  description?: string;
  receivable?: string;
};

export type Account = {
  id: string;
  name: string;
  type: string;
  currency?: string;
  balance: number;
  openingBalance?: number;
  isDefault?: boolean;
  archived?: boolean;
  notes?: string;
  latestCheckpoint?: number;
  unexplained?: number;
};

export type Budget = {
  id: string;
  category: string;
  spent: number;
  limit: number;
  color: string;
};

export type Asset = {
  id: string;
  name: string;
  type: string;
  value: number;
  cost: number;
  color: string;
  purchaseDate?: string;
  targetSalePrice?: number;
  purchasePrice?: number;
  purchaseTransaction?: string;
  notes?: string;
};

export type AssetGroup = {
  id: string;
  name: string;
  description?: string;
  currency?: string;
  notes?: string;
  archived: boolean;
};

export type AssetPosition = {
  id: string;
  group: string;
  name: string;
  type: string;
  quantity: number;
  value: number;
  currency?: string;
  purchaseDate?: string;
  purchasePrice: number;
  targetSalePrice: number;
  asOf?: string;
  notes?: string;
  status?: string;
  archived: boolean;
};

export type Goal = {
  id: string;
  name: string;
  current: number;
  target: number;
  deadline: string;
  color: string;
  notes?: string;
  status?: 'active' | 'paused' | 'completed';
  archived?: boolean;
};

export type GoalContribution = {
  id: string;
  goalId: string;
  date: string;
  type: 'contribution' | 'withdrawal';
  amount: number;
  accountId?: string;
  transactionId?: string;
  notes?: string;
};

export type Reconciliation = {
  amount: number;
  state: 'reconciled' | 'incomplete' | 'invalid';
  account: string;
  accountId: string;
  from: string;
  to: string;
};

export type BudgetData = {
  transactions: Transaction[];
  accounts: Account[];
  budgets: Budget[];
  assets: Asset[];
  assetGroups: AssetGroup[];
  assetPositions: AssetPosition[];
  goals: Goal[];
  goalContributions: GoalContribution[];
  reconciliation: Reconciliation | null;
};

export const sampleData: BudgetData = {
  accounts: [
    { id: 'checking', name: 'Everyday checking', type: 'Checking', balance: 8420.14 },
    { id: 'savings', name: 'Rainy day fund', type: 'Savings', balance: 12450.0 },
    { id: 'visa', name: 'Blue card', type: 'Credit card', balance: -1240.62 },
  ],
  transactions: [
    {
      id: 'tx-1',
      merchant: 'Whole Foods Market',
      category: 'Groceries',
      account: 'Everyday checking',
      amount: 86.42,
      kind: 'expense',
      date: '2026-09-18',
    },
    {
      id: 'tx-2',
      merchant: 'Acme Co. Payroll',
      category: 'Income',
      account: 'Everyday checking',
      amount: 4200,
      kind: 'income',
      date: '2026-09-17',
    },
    {
      id: 'tx-3',
      merchant: 'Northstar Energy',
      category: 'Home',
      account: 'Everyday checking',
      amount: 142.8,
      kind: 'expense',
      date: '2026-09-16',
    },
    {
      id: 'tx-4',
      merchant: 'Moss & Pine',
      category: 'Dining',
      account: 'Blue card',
      amount: 64.25,
      kind: 'expense',
      date: '2026-09-15',
    },
    {
      id: 'tx-5',
      merchant: 'Metro Transit',
      category: 'Transport',
      account: 'Blue card',
      amount: 32,
      kind: 'expense',
      date: '2026-09-14',
    },
    {
      id: 'tx-6',
      merchant: 'Lumen Internet',
      category: 'Subscriptions',
      account: 'Everyday checking',
      amount: 79,
      kind: 'expense',
      date: '2026-09-13',
    },
    {
      id: 'tx-7',
      merchant: 'Parkside Market',
      category: 'Groceries',
      account: 'Everyday checking',
      amount: 48.9,
      kind: 'expense',
      date: '2026-09-12',
    },
    {
      id: 'tx-8',
      merchant: 'Freelance transfer',
      category: 'Income',
      account: 'Everyday checking',
      amount: 650,
      kind: 'income',
      date: '2026-09-11',
    },
  ],
  budgets: [
    { id: 'b-1', category: 'Home', spent: 1240, limit: 1800, color: '#7b8f84' },
    { id: 'b-2', category: 'Groceries', spent: 486, limit: 600, color: '#d68b5e' },
    { id: 'b-3', category: 'Dining & fun', spent: 318, limit: 450, color: '#a78bca' },
    { id: 'b-4', category: 'Transport', spent: 220, limit: 350, color: '#6b9ab8' },
  ],
  assets: [
    {
      id: 'a-1',
      name: 'Index funds',
      type: 'Brokerage',
      value: 18420,
      cost: 16000,
      color: '#5f8d7e',
    },
    { id: 'a-2', name: 'Retirement', type: '401(k)', value: 48200, cost: 39000, color: '#be8a54' },
    {
      id: 'a-3',
      name: 'Emergency fund',
      type: 'Cash',
      value: 12450,
      cost: 12450,
      color: '#8e82b9',
    },
  ],
  assetGroups: [],
  assetPositions: [],
  goals: [
    {
      id: 'g-1',
      name: 'Home down payment',
      current: 28600,
      target: 50000,
      deadline: 'Jun 2027',
      color: '#5f8d7e',
    },
    {
      id: 'g-2',
      name: 'Japan trip',
      current: 3200,
      target: 6000,
      deadline: 'Mar 2027',
      color: '#d68b5e',
    },
    {
      id: 'g-3',
      name: 'New bike',
      current: 850,
      target: 1800,
      deadline: 'Dec 2026',
      color: '#8e82b9',
    },
  ],
  goalContributions: [],
  reconciliation: {
    amount: 190.12,
    state: 'incomplete',
    account: 'Everyday checking',
    accountId: 'checking',
    from: 'Sep 1',
    to: 'Sep 20',
  },
};

function numberValue(record: RecordModel | undefined, ...keys: string[]) {
  if (!record) return 0;
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function textValue(record: RecordModel, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return '';
}

function dateValue(record: RecordModel) {
  const value = textValue(record, 'date', 'transaction_date', 'created');
  return value.slice(0, 10) || new Date().toISOString().slice(0, 10);
}

function optionalDateValue(record: RecordModel, ...keys: string[]) {
  const value = textValue(record, ...keys);
  if (!value) return undefined;
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    ? date
    : undefined;
}

async function getRecords(collection: string): Promise<RecordModel[]> {
  const records = await apiRequest<unknown>(`/api/finance/${collection}`);
  return Array.isArray(records) ? (records as RecordModel[]) : [];
}

function transactionKind(record: RecordModel): TransactionKind {
  const explicit = String(record.type ?? '').toLowerCase();
  if (explicit === 'transfer' || explicit === 'adjustment') return explicit;
  return Number(record.amount ?? 0) < 0 || explicit === 'expense' ? 'expense' : 'income';
}

export async function loadBudgetData(): Promise<{ data: BudgetData; remote: boolean }> {
  const [transactions, accounts, budgets, assets, assetGroups, assetPositions, goals] =
    await Promise.all([
      getRecords('transactions'),
      getRecords('accounts'),
      getRecords('budgets'),
      getRecords('assets'),
      getRecords('asset-groups'),
      getRecords('asset-positions'),
      getRecords('goals'),
    ]);
  const contributionRecords = await Promise.all(
    goals.map(async (goal) => {
      const records = await apiRequest<unknown>(`/api/finance/goals/${goal.id}/contributions`);
      return Array.isArray(records) ? (records as RecordModel[]) : [];
    }),
  );

  const remoteData: BudgetData = {
    transactions: transactions.map((record) => ({
      id: record.id,
      merchant: textValue(record, 'payee', 'description', 'name') || 'Untitled transaction',
      category: textValue(record, 'category', 'budget'),
      account: textValue(record, 'account') || 'Unassigned account',
      amount: Math.abs(numberValue(record, 'amount', 'value')),
      kind: transactionKind(record),
      date: dateValue(record),
      budgetId: textValue(record, 'budget'),
      note: textValue(record, 'notes', 'note', 'memo'),
      tags: Array.isArray(record.tags) ? record.tags.map(String) : [],
      cleared: Boolean(record.cleared),
      reconciled: Boolean(record.reconciled),
      receipt: textValue(record, 'receipt'),
      description: textValue(record, 'description'),
      receivable: textValue(record, 'receivable'),
      accountId: textValue(record, 'account'),
    })),
    accounts: accounts.map((record) => ({
      id: record.id,
      name: textValue(record, 'name', 'title') || 'Unnamed account',
      type: textValue(record, 'type', 'account_type') || 'Account',
      currency: textValue(record, 'currency') || 'USD',
      balance: numberValue(record, 'balance', 'current_balance', 'opening_balance'),
      openingBalance: numberValue(record, 'opening_balance'),
      isDefault: Boolean(record.is_default),
      archived: Boolean(record.archived),
      notes: textValue(record, 'notes') || undefined,
      latestCheckpoint: numberValue(record.lastCheckpoint as RecordModel | undefined, 'balance'),
      unexplained: numberValue(record, 'reconciliationDifference'),
    })),
    budgets: budgets.map((record, index) => ({
      id: record.id,
      category: textValue(record, 'category', 'name') || 'Other',
      spent: numberValue(record, 'spent', 'used', 'amount_spent'),
      limit: numberValue(record, 'limit', 'amount', 'target') || 1,
      color: ['#5f8d7e', '#d68b5e', '#a78bca', '#6b9ab8'][index % 4],
    })),
    assets: assets.map((record, index) => ({
      id: record.id,
      name: textValue(record, 'name', 'title') || 'Unnamed asset',
      type: textValue(record, 'type', 'asset_type') || 'Asset',
      value: numberValue(record, 'value', 'current_value', 'balance'),
      cost:
        numberValue(record, 'purchase_price', 'cost', 'basis', 'contributions') ||
        numberValue(record, 'value', 'current_value'),
      color: ['#5f8d7e', '#be8a54', '#8e82b9', '#6b9ab8'][index % 4],
      purchaseDate: textValue(record, 'purchase_date').slice(0, 10),
      purchasePrice: numberValue(record, 'purchase_price'),
      purchaseTransaction: textValue(record, 'purchase_transaction'),
      targetSalePrice: numberValue(record, 'target_sale_price'),
      notes: textValue(record, 'notes'),
    })),
    assetGroups: assetGroups.map((record) => ({
      id: record.id,
      name: textValue(record, 'name') || 'Unnamed asset group',
      description: textValue(record, 'description') || undefined,
      currency: textValue(record, 'currency') || undefined,
      notes: textValue(record, 'notes') || undefined,
      archived: Boolean(record.archived),
    })),
    assetPositions: assetPositions.map((record) => ({
      id: record.id,
      group: textValue(record, 'group'),
      name: textValue(record, 'name') || 'Unnamed position',
      type: textValue(record, 'type'),
      quantity: numberValue(record, 'quantity'),
      value: numberValue(record, 'value'),
      currency: textValue(record, 'currency') || undefined,
      purchaseDate: optionalDateValue(record, 'purchase_date'),
      purchasePrice: numberValue(record, 'purchase_price'),
      targetSalePrice: numberValue(record, 'target_sale_price'),
      asOf: optionalDateValue(record, 'as_of'),
      notes: textValue(record, 'notes') || undefined,
      status: textValue(record, 'status') || undefined,
      archived: Boolean(record.archived),
    })),
    goals: goals.map((record, index) => ({
      id: record.id,
      name: textValue(record, 'name', 'title') || 'Unnamed goal',
      current: numberValue(record, 'current_amount', 'current', 'saved', 'balance'),
      target: numberValue(record, 'target_amount', 'target', 'goal', 'amount') || 1,
      deadline: optionalDateValue(record, 'target_date', 'deadline') || 'No deadline',
      color: ['#5f8d7e', '#d68b5e', '#8e82b9', '#6b9ab8'][index % 4],
      notes: textValue(record, 'notes') || undefined,
      status: textValue(record, 'status') === 'paused' ? 'paused' : record.completed ? 'completed' : 'active',
      archived: Boolean(record.archived),
    })),
    goalContributions: contributionRecords.flatMap((records) => records.map((record) => ({
      id: record.id,
      goalId: textValue(record, 'goal'),
      date: dateValue(record),
      type: textValue(record, 'type') === 'withdrawal' ? 'withdrawal' as const : 'contribution' as const,
      amount: numberValue(record, 'amount'),
      accountId: textValue(record, 'account') || undefined,
      transactionId: textValue(record, 'transaction') || undefined,
      notes: textValue(record, 'notes') || undefined,
    }))),
    reconciliation: null,
  };

  const accountNames = new Map(remoteData.accounts.map((account) => [account.id, account.name]));
  remoteData.transactions = remoteData.transactions.map((transaction) => ({
    ...transaction,
    account: accountNames.get(transaction.account) ?? transaction.account,
  }));
  const spentByBudget = new Map<string, number>();
  for (const transaction of remoteData.transactions) {
    if (transaction.kind === 'expense' && transaction.budgetId) {
      spentByBudget.set(
        transaction.budgetId,
        (spentByBudget.get(transaction.budgetId) ?? 0) + transaction.amount,
      );
    }
  }
  remoteData.budgets = remoteData.budgets.map((budget) => ({
    ...budget,
    spent: spentByBudget.get(budget.id) ?? budget.spent,
  }));
  const firstWindow = accounts.flatMap((record) => {
    const windows = Array.isArray(record.checkpointWindows) ? record.checkpointWindows : [];
    return windows.map((window) => ({ record, window }));
  })[0];
  if (firstWindow) {
    const window = firstWindow.window as RecordModel;
    const account = remoteData.accounts.find((item) => item.id === firstWindow.record.id);
    remoteData.reconciliation = {
      amount: Math.abs(numberValue(window, 'unexplained')),
      state: String(window.state ?? 'incomplete') as 'reconciled' | 'incomplete' | 'invalid',
      account: account?.name ?? 'Account',
      accountId: firstWindow.record.id,
      from: dateValue(window),
      to: textValue(window, 'to', 'endDate').slice(0, 10),
    };
  }
  return { data: remoteData, remote: true };
}
