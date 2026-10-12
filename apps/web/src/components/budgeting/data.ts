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
  signedAmount?: number;
  kind: TransactionKind;
  transferId?: string;
  recurringRuleId?: string;
  splitGroup?: string;
  parentTransactionId?: string;
  subtransactions?: Transaction[];
  date: string;
  budgetId?: string;
  note?: string;
  tags?: string[];
  cleared?: boolean;
  reconciled?: boolean;
  receipt?: string;
  description?: string;
  receivable?: string;
  budgetAmount?: number;
  incomeAmount?: number;
};

export type Obligation = {
  id: string;
  side: 'receivable' | 'payable';
  party: string;
  title: string;
  amount: number;
  outstandingAmount: number;
  sourceTransaction?: string;
  dueDate?: string;
  notes?: string;
  status: 'open' | 'settled';
};

export type ObligationSettlement = {
  id: string;
  obligationId: string;
  transactionId: string;
  amount: number;
  date: string;
  notes?: string;
};

export type RecurringTransaction = {
  id: string;
  merchant: string;
  account: string;
  accountId: string;
  amount: number;
  kind: 'expense' | 'income' | 'adjustment';
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  startDate?: string;
  nextDate: string;
  endDate?: string;
  active: boolean;
};

export type Account = {
  id: string;
  name: string;
  type: string;
  currency?: string;
  balance: number;
  openingBalance?: number;
  alertBelow?: number;
  isDefault?: boolean;
  archived?: boolean;
  notes?: string;
  latestCheckpoint?: number;
  unexplained?: number;
};

export type Checkpoint = {
  id: string;
  accountId: string;
  account: string;
  date: string;
  balance: number;
  note?: string;
};

export type Budget = {
  id: string;
  category: string;
  spent: number;
  limit: number;
  color: string;
  startDate?: string;
  endDate?: string;
  archived?: boolean;
  notes?: string;
};

export type Asset = {
  id: string;
  name: string;
  type: string;
  value: number;
  cost: number;
  costKnown?: boolean;
  color: string;
  purchaseDate?: string;
  asOf?: string;
  targetSalePrice?: number;
  purchasePrice?: number;
  purchaseTransaction?: string;
  assetGroup?: string;
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
  costKnown?: boolean;
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

export type RecurringGoalContribution = {
  id: string;
  goalId: string;
  amount: number;
  accountId?: string;
  frequency: RecurringTransaction['frequency'];
  interval: number;
  nextDate: string;
  endDate?: string;
  active: boolean;
  notes?: string;
};

export type Reconciliation = {
  amount: number;
  actualDelta: number;
  transactionDelta: number;
  fromBalance: number;
  toBalance: number;
  state: 'reconciled' | 'incomplete' | 'invalid';
  account: string;
  accountId: string;
  from: string;
  to: string;
};

export type BudgetData = {
  transactions: Transaction[];
  checkpoints: Checkpoint[];
  recurringTransactions: RecurringTransaction[];
  obligations: Obligation[];
  settlements: ObligationSettlement[];
  accounts: Account[];
  budgets: Budget[];
  assets: Asset[];
  assetGroups: AssetGroup[];
  assetPositions: AssetPosition[];
  goals: Goal[];
  goalContributions: GoalContribution[];
  recurringGoalContributions: RecurringGoalContribution[];
  reconciliation: Reconciliation | null;
};

export const emptyBudgetData: BudgetData = {
  transactions: [],
  checkpoints: [],
  recurringTransactions: [],
  obligations: [],
  settlements: [],
  accounts: [],
  budgets: [],
  assets: [],
  assetGroups: [],
  assetPositions: [],
  goals: [],
  goalContributions: [],
  recurringGoalContributions: [],
  reconciliation: null,
};

export function checkpointsMatchingHistory(
  checkpoints: Checkpoint[],
  transactions: Transaction[],
) {
  const transactionDates = new Set(
    transactions
      .filter((transaction) => transaction.accountId)
      .map((transaction) => `${transaction.accountId}:${transaction.date}`),
  );
  return checkpoints.filter((checkpoint) =>
    transactionDates.has(`${checkpoint.accountId}:${checkpoint.date}`),
  );
}

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
  const [
    transactions,
    checkpoints,
    accounts,
    budgets,
    assets,
    assetGroups,
    assetPositions,
    goals,
    recurringTransactions,
    obligations,
    settlements,
  ] = await Promise.all([
    getRecords('transactions'),
    getRecords('checkpoints'),
    getRecords('accounts'),
    getRecords('budgets'),
    getRecords('assets'),
    getRecords('asset-groups'),
    getRecords('asset-positions'),
    getRecords('goals'),
    getRecords('recurring_transactions'),
    getRecords('obligations'),
    getRecords('settlements'),
  ]);
  const [contributionRecords, recurringGoalContributionRecords] = await Promise.all([
    Promise.all(
      goals.map(async (goal) => {
        const records = await apiRequest<unknown>(`/api/finance/goals/${goal.id}/contributions`);
        return Array.isArray(records) ? (records as RecordModel[]) : [];
      }),
    ),
    Promise.all(
      goals.map(async (goal) => {
        const records = await apiRequest<unknown>(
          `/api/finance/goals/${goal.id}/recurring-contributions`,
        );
        return Array.isArray(records) ? (records as RecordModel[]) : [];
      }),
    ),
  ]);

  const mappedTransactions: Transaction[] = transactions.map((record) => ({
    id: record.id,
    merchant: textValue(record, 'payee', 'description', 'name') || 'Untitled transaction',
    category: textValue(record, 'category', 'budget'),
    account: textValue(record, 'account') || 'Unassigned account',
    accountId: textValue(record, 'account'),
    amount: Math.abs(numberValue(record, 'amount', 'value')),
    signedAmount: numberValue(record, 'amount', 'value'),
    kind: transactionKind(record),
    transferId: textValue(record, 'transfer_id') || undefined,
    recurringRuleId: textValue(record, 'recurring_rule') || undefined,
    splitGroup: textValue(record, 'split_group') || undefined,
    parentTransactionId: textValue(record, 'parent_transaction') || undefined,
    date: dateValue(record),
    budgetId: textValue(record, 'budget'),
    note: textValue(record, 'notes', 'note', 'memo'),
    tags: Array.isArray(record.tags) ? record.tags.map(String) : [],
    cleared: Boolean(record.cleared),
    reconciled: Boolean(record.reconciled),
    receipt: textValue(record, 'receipt'),
    description: textValue(record, 'description'),
    receivable: textValue(record, 'receivable'),
    budgetAmount:
      record.budget_amount === undefined || record.budget_amount === null
        ? undefined
        : numberValue(record, 'budget_amount'),
    incomeAmount:
      record.income_amount === undefined || record.income_amount === null
        ? undefined
        : numberValue(record, 'income_amount'),
  }));
  const remoteData: BudgetData = {
    recurringTransactions: recurringTransactions.map((record) => ({
      id: record.id,
      merchant: textValue(record, 'payee') || 'Recurring transaction',
      account: textValue(record, 'account'),
      accountId: textValue(record, 'account'),
      amount: numberValue(record, 'amount'),
      kind: (textValue(record, 'type') || 'expense') as RecurringTransaction['kind'],
      frequency: textValue(record, 'frequency') as RecurringTransaction['frequency'],
      interval: numberValue(record, 'interval') || 1,
      startDate: optionalDateValue(record, 'start_date') || undefined,
      nextDate: optionalDateValue(record, 'next_date') ?? '',
      endDate: optionalDateValue(record, 'end_date') || undefined,
      active: Boolean(record.active),
    })),
    obligations: obligations.map((record) => ({
      id: record.id,
      side: textValue(record, 'side') === 'payable' ? 'payable' : 'receivable',
      party: textValue(record, 'party'),
      title: textValue(record, 'title'),
      amount: numberValue(record, 'amount'),
      outstandingAmount: numberValue(record, 'outstanding_amount'),
      sourceTransaction: textValue(record, 'source_transaction') || undefined,
      dueDate: optionalDateValue(record, 'due_date'),
      notes: textValue(record, 'notes') || undefined,
      status: textValue(record, 'status') === 'settled' ? 'settled' : 'open',
    })),
    settlements: settlements.map((record) => ({
      id: record.id,
      obligationId: textValue(record, 'obligation'),
      transactionId: textValue(record, 'transaction'),
      amount: numberValue(record, 'amount'),
      date: dateValue(record),
      notes: textValue(record, 'notes') || undefined,
    })),
    transactions: mappedTransactions,
    checkpoints: checkpoints.map((record) => ({
      id: record.id,
      accountId: textValue(record, 'account'),
      account: textValue(record, 'account'),
      date: dateValue(record),
      balance: numberValue(record, 'balance'),
      note: textValue(record, 'note') || undefined,
    })),
    accounts: accounts.map((record) => ({
      id: record.id,
      name: textValue(record, 'name', 'title') || 'Unnamed account',
      type: textValue(record, 'type', 'account_type') || 'Account',
      currency: textValue(record, 'currency') || 'USD',
      balance: numberValue(record, 'balance', 'current_balance', 'opening_balance'),
      openingBalance: numberValue(record, 'opening_balance'),
      alertBelow: numberValue(record, 'alert_below') || undefined,
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
      startDate: optionalDateValue(record, 'start_date') || undefined,
      endDate: optionalDateValue(record, 'end_date') || undefined,
      archived: Boolean(record.archived),
      notes: textValue(record, 'notes') || undefined,
    })),
    assets: assets.map((record, index) => ({
      id: record.id,
      name: textValue(record, 'name', 'title') || 'Unnamed asset',
      type: textValue(record, 'type', 'asset_type') || 'Asset',
      value: numberValue(record, 'value', 'current_value', 'balance'),
      cost: numberValue(record, 'purchase_price', 'cost', 'basis', 'contributions'),
      costKnown: numberValue(record, 'purchase_price', 'cost', 'basis', 'contributions') > 0,
      color: ['#5f8d7e', '#be8a54', '#8e82b9', '#6b9ab8'][index % 4],
      purchaseDate: textValue(record, 'purchase_date').slice(0, 10),
      asOf: optionalDateValue(record, 'as_of'),
      purchasePrice: numberValue(record, 'purchase_price'),
      purchaseTransaction: textValue(record, 'purchase_transaction'),
      targetSalePrice: numberValue(record, 'target_sale_price'),
      assetGroup: textValue(record, 'asset_group') || undefined,
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
      costKnown: numberValue(record, 'purchase_price') > 0,
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
      status:
        textValue(record, 'status') === 'paused'
          ? 'paused'
          : record.completed
            ? 'completed'
            : 'active',
      archived: Boolean(record.archived),
    })),
    goalContributions: contributionRecords.flatMap((records) =>
      records.map((record) => ({
        id: record.id,
        goalId: textValue(record, 'goal'),
        date: dateValue(record),
        type:
          textValue(record, 'type') === 'withdrawal'
            ? ('withdrawal' as const)
            : ('contribution' as const),
        amount: numberValue(record, 'amount'),
        accountId: textValue(record, 'account') || undefined,
        transactionId: textValue(record, 'transaction') || undefined,
        notes: textValue(record, 'notes') || undefined,
      })),
    ),
    recurringGoalContributions: recurringGoalContributionRecords.flatMap((records) =>
      records.map((record) => ({
        id: record.id,
        goalId: textValue(record, 'goal'),
        amount: numberValue(record, 'amount'),
        accountId: textValue(record, 'account') || undefined,
        frequency: textValue(record, 'frequency') as RecurringTransaction['frequency'],
        interval: numberValue(record, 'interval') || 1,
        nextDate: optionalDateValue(record, 'next_date') ?? '',
        endDate: optionalDateValue(record, 'end_date') || undefined,
        active: Boolean(record.active),
        notes: textValue(record, 'notes') || undefined,
      })),
    ),
    reconciliation: null,
  };

  const accountNames = new Map(remoteData.accounts.map((account) => [account.id, account.name]));
  remoteData.checkpoints = remoteData.checkpoints.map((checkpoint) => ({
    ...checkpoint,
    account: accountNames.get(checkpoint.accountId) ?? checkpoint.account,
  }));
  remoteData.transactions = remoteData.transactions.map((transaction) => ({
    ...transaction,
    account: accountNames.get(transaction.account) ?? transaction.account,
  }));
  const transactionsById = new Map(
    remoteData.transactions.map((transaction) => [transaction.id, transaction]),
  );
  for (const transaction of remoteData.transactions) {
    if (!transaction.parentTransactionId) continue;
    const parent = transactionsById.get(transaction.parentTransactionId);
    if (!parent) continue;
    parent.subtransactions ??= [];
    parent.subtransactions.push(transaction);
  }
  remoteData.recurringTransactions = remoteData.recurringTransactions.map((rule) => ({
    ...rule,
    account: accountNames.get(rule.accountId) ?? rule.account,
  }));
  const spentByBudget = new Map<string, number>();
  for (const transaction of remoteData.transactions) {
    if (transaction.kind === 'expense' && transaction.budgetId) {
      spentByBudget.set(
        transaction.budgetId,
        (spentByBudget.get(transaction.budgetId) ?? 0) +
          (transaction.budgetAmount ?? transaction.amount),
      );
    }
  }
  remoteData.budgets = remoteData.budgets.map((budget) => ({
    ...budget,
    spent: spentByBudget.get(budget.id) ?? budget.spent,
  }));
  const firstWindow = accounts
    .flatMap((record) => {
      const windows = Array.isArray(record.checkpointWindows) ? record.checkpointWindows : [];
      return windows.map((window) => ({ record, window }));
    })
    .find(({ window }) => window.state !== 'reconciled');
  if (firstWindow) {
    const window = firstWindow.window as RecordModel;
    const account = remoteData.accounts.find((item) => item.id === firstWindow.record.id);
    remoteData.reconciliation = {
      amount: Math.abs(numberValue(window, 'unexplained')),
      actualDelta: numberValue(window, 'actualDelta'),
      transactionDelta: numberValue(window, 'transactionDelta'),
      fromBalance: numberValue(window, 'fromBalance'),
      toBalance: numberValue(window, 'toBalance'),
      state: String(window.state ?? 'incomplete') as 'reconciled' | 'incomplete' | 'invalid',
      account: account?.name ?? 'Account',
      accountId: firstWindow.record.id,
      from: dateValue(window),
      to: textValue(window, 'to', 'endDate').slice(0, 10),
    };
  }
  return { data: remoteData, remote: true };
}
