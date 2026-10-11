import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  Filter,
  HandCoins,
  Landmark,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingUp,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import type { RecordModel } from 'pocketbase';
import type { SidebarTab } from '../sidebar';
import type { UserProfile } from '../../profile';
import { apiFetch } from '../../api/client';
import { pb } from '../../api/pocketbase';
import type {
  Asset,
  AssetGroup,
  AssetPosition,
  Budget,
  BudgetData,
  Goal,
  Transaction,
  TransactionKind,
} from './data';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

export type BudgetView = SidebarTab;

type Props = {
  view: BudgetView;
  userId: string;
  data: BudgetData;
  remote: boolean;
  loading: boolean;
  onRefresh: () => void;
  onNavigate: (view: BudgetView) => void;
  profile: UserProfile;
};

export function formatMoney(value: number, compact = false) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 2,
  }).format(value);
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    new Date(`${date}T12:00:00`),
  );
}

function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-header budgeting-page-header">
      <div>
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {action && <div className="header-actions">{action}</div>}
    </div>
  );
}

function SectionHeading({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

function TransactionIcon({ kind }: { kind: TransactionKind }) {
  return (
    <span className={`transaction-icon ${kind}`}>
      {kind === 'income' ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
    </span>
  );
}

function TransactionRow({
  transaction,
  onOpen,
  onEdit,
  onDelete,
}: {
  transaction: Transaction;
  onOpen?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className="transaction-row transaction-entry"
      role="group"
      aria-label={`${transaction.merchant}, ${formatMoney(transaction.amount)}`}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onOpen?.();
        }
      }}
    >
      <TransactionIcon kind={transaction.kind} />
      <div className="transaction-main">
        <strong>{transaction.merchant}</strong>
        <span>
          {transaction.category} · {transaction.account}
        </span>
      </div>
      <time>{formatDate(transaction.date)}</time>
      <strong className={`transaction-amount ${transaction.kind}`}>
        {transaction.kind === 'income' ? '+' : '-'}
        {formatMoney(transaction.amount)}
      </strong>
      {onEdit && onDelete ? (
        <span className="row-actions">
          <button
            className="text-button"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
          >
            Edit
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            aria-label={`Delete ${transaction.merchant}`}
          >
            <Trash2 size={15} />
          </button>
        </span>
      ) : (
        <button
          className="icon-button row-menu"
          aria-label={`More options for ${transaction.merchant}`}
          type="button"
        >
          <MoreHorizontal size={17} />
        </button>
      )}
    </div>
  );
}

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="progress-track" aria-label={`${Math.round(value)} percent complete`}>
      <span style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }} />
    </div>
  );
}

function BudgetLine({ budget }: { budget: Budget }) {
  const percentage = budget.limit ? (budget.spent / budget.limit) * 100 : 0;
  return (
    <div className="budget-line">
      <div className="budget-line-heading">
        <span className="budget-dot" style={{ background: budget.color }} />
        <strong>{budget.category}</strong>
        <span className="budget-line-amount">
          {formatMoney(budget.spent)} <em>/ {formatMoney(budget.limit)}</em>
        </span>
      </div>
      <ProgressBar value={percentage} color={budget.color} />
      <small>
        {Math.max(0, budget.limit - budget.spent) > 0
          ? `${formatMoney(budget.limit - budget.spent)} left`
          : 'Over budget'}
      </small>
    </div>
  );
}

function ReconciliationCard({
  reconciliation,
  compact = false,
}: {
  reconciliation: BudgetData['reconciliation'];
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!reconciliation) {
    return (
      <article className={`reconciliation-card ${compact ? 'is-compact' : ''} is-good`}>
        <div className="reconciliation-icon">
          <CheckCircle2 size={19} />
        </div>
        <div className="reconciliation-copy">
          <div className="reconciliation-title">
            <span>Reconciliation</span>
            <span className="status-pill">All clear</span>
          </div>
          <strong>No unexplained money</strong>
          <p>Your recorded transactions match your latest checkpoints.</p>
        </div>
      </article>
    );
  }
  const isInvalid = reconciliation.state === 'invalid';
  const status = isInvalid
    ? 'Mismatch'
    : reconciliation.state === 'incomplete'
      ? 'Needs review'
      : 'Reconciled';
  return (
    <article
      className={`reconciliation-card ${compact ? 'is-compact' : ''} ${isInvalid ? 'is-invalid' : ''}`}
    >
      <div className="reconciliation-icon">
        <CircleAlert size={19} />
      </div>
      <div className="reconciliation-copy">
        <div className="reconciliation-title">
          <span>{reconciliation.account} checkpoint</span>
          <span className="status-pill">{status}</span>
        </div>
        <strong>
          {isInvalid ? 'Checkpoint mismatch' : 'Unknown gap'}{' '}
          <span>{formatMoney(reconciliation.amount)}</span>
        </strong>
        <p>
          {isInvalid
            ? 'Recorded transactions conflict with the fixed balance. Review the window before adding more records.'
            : 'Your checkpoint is fixed, but some money in this window has not been explained yet.'}
        </p>
        <button
          className="text-button"
          type="button"
          disabled={busy || !reconciliation.accountId || reconciliation.amount < 0.005}
          onClick={() => {
            setBusy(true);
            setError('');
            void apiFetch(`/api/finance/accounts/${reconciliation.accountId}/reconcile`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${pb.authStore.token}` },
            })
              .then(async (response) => {
                if (!response.ok)
                  throw new Error((await response.text()) || 'Could not reconcile gap.');
                window.dispatchEvent(new Event('piggybudget:refresh'));
              })
              .catch((caught: unknown) =>
                setError(caught instanceof Error ? caught.message : 'Could not reconcile gap.'),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Reconciling…' : 'Move gap to Miscellaneous'} <ArrowRight size={14} />
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {!compact && (
        <div className="checkpoint-ring">
          <span>{reconciliation.state === 'reconciled' ? '100%' : '62%'}</span>
          <small>checked</small>
        </div>
      )}
    </article>
  );
}

function CashFlowChart({ transactions }: { transactions: Transaction[] }) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    const dateKey = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
    const matchingTransactions = transactions.filter((transaction) => transaction.date === dateKey);
    return {
      dateKey,
      label: new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date),
      income: matchingTransactions
        .filter((transaction) => transaction.kind === 'income')
        .reduce((sum, transaction) => sum + transaction.amount, 0),
      expenses: matchingTransactions
        .filter((transaction) => transaction.kind === 'expense')
        .reduce((sum, transaction) => sum + transaction.amount, 0),
    };
  });
  const scale = Math.max(
    2000,
    Math.ceil(Math.max(...days.flatMap((day) => [day.income, day.expenses])) / 1000) * 1000,
  );
  return (
    <div className="cashflow-chart" aria-label="Cash flow over the last seven days">
      <div className="chart-y-labels">
        <span>{formatMoney(scale, true)}</span>
        <span>{formatMoney(scale / 2, true)}</span>
        <span>$0</span>
      </div>
      <div className="chart-bars">
        {days.map((day) => (
          <div className="chart-day" key={day.dateKey}>
            <div className="chart-bar-wrap">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="chart-income"
                    style={{ height: `${(day.income / scale) * 100}%` }}
                    aria-label={`${day.label} income: ${formatMoney(day.income)}`}
                  />
                </TooltipTrigger>
                <TooltipContent>{`${day.label} income: ${formatMoney(day.income)}`}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="chart-expense"
                    style={{ height: `${(day.expenses / scale) * 100}%` }}
                    aria-label={`${day.label} expenses: ${formatMoney(day.expenses)}`}
                  />
                </TooltipTrigger>
                <TooltipContent>{`${day.label} expenses: ${formatMoney(day.expenses)}`}</TooltipContent>
              </Tooltip>
            </div>
            <small>{day.label}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function FinanceHelper({ reconciliation }: { reconciliation: BudgetData['reconciliation'] }) {
  return (
    <aside className="helper-panel">
      <div className="helper-heading">
        <span className="helper-mark">
          <Sparkles size={15} />
        </span>
        <div>
          <strong>Your finance guide</strong>
          <small>Simple answers from your data</small>
        </div>
      </div>
      <p>
        {reconciliation
          ? `You have ${formatMoney(reconciliation.amount)} in an unexplained checkpoint gap.`
          : 'Your recorded balances and checkpoints are in sync.'}
      </p>
      <div className="helper-prompt-list">
        <button type="button" onClick={() => undefined}>
          What changed this month? <ArrowRight size={14} />
        </button>
        <button type="button" onClick={() => undefined}>
          How much can I spend? <ArrowRight size={14} />
        </button>
      </div>
      <small className="helper-note">No bank connection needed.</small>
    </aside>
  );
}

function DashboardView({
  data,
  onNavigate,
  onAddTransaction,
}: {
  data: BudgetData;
  onNavigate: (view: BudgetView) => void;
  onAddTransaction: () => void;
}) {
  const income = data.transactions
    .filter((item) => item.kind === 'income')
    .reduce((sum, item) => sum + item.amount, 0);
  const expenses = data.transactions
    .filter((item) => item.kind === 'expense')
    .reduce((sum, item) => sum + item.amount, 0);
  const recent = data.transactions.slice(0, 5);
  return (
    <>
      <PageHeader
        title="Good morning, Alex"
        description="Here is your money at a glance."
        action={
          <button className="button button-primary" type="button" onClick={onAddTransaction}>
            <Plus size={16} /> New
          </button>
        }
      />

      <div className="dashboard-grid dashboard-primary-grid">
        <section className="panel cashflow-panel">
          <SectionHeading
            title="Cash flow"
            action={
              <button className="select-button" type="button">
                This month <ChevronDown size={14} />
              </button>
            }
          />
          <div className="cashflow-total">
            <strong>{formatMoney(income - expenses)}</strong>
            <span>
              <ArrowUpRight size={14} /> $320 more than last month
            </span>
          </div>
          <CashFlowChart transactions={data.transactions} />
          <div className="chart-legend">
            <span>
              <i className="legend-dot income" />
              Income
            </span>
            <span>
              <i className="legend-dot expense" />
              Expenses
            </span>
          </div>
        </section>
        <FinanceHelper reconciliation={data.reconciliation} />
      </div>
      <div className="dashboard-grid dashboard-secondary-grid">
        <section className="panel">
          <SectionHeading
            title="Recent transactions"
            action={
              <button
                className="text-button"
                type="button"
                onClick={() => onNavigate('transactions')}
              >
                See all <ArrowRight size={14} />
              </button>
            }
          />
          <div className="transaction-list">
            {recent.map((transaction) => (
              <TransactionRow key={transaction.id} transaction={transaction} />
            ))}
          </div>
        </section>
        <section className="panel budget-panel">
          <SectionHeading
            title="Budget snapshot"
            action={
              <button className="text-button" type="button" onClick={() => onNavigate('budgets')}>
                Manage <ArrowRight size={14} />
              </button>
            }
          />
          <div className="budget-list">
            {data.budgets.slice(0, 4).map((budget) => (
              <BudgetLine key={budget.id} budget={budget} />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function TransactionsView({
  data,
  onAddTransaction,
  onAddCheckpoint,
  onAddAccount,
  onEditTransaction,
  onDeleteTransaction,
  onOpenTransaction,
}: {
  data: BudgetData;
  onAddTransaction: () => void;
  onAddCheckpoint: () => void;
  onAddAccount: () => void;
  onEditTransaction: (transaction: Transaction) => void;
  onDeleteTransaction: (transaction: Transaction) => void;
  onOpenTransaction: (transaction: Transaction) => void;
}) {
  const [account, setAccount] = useState('All accounts');
  const [kind, setKind] = useState<'all' | TransactionKind>('all');
  const [category, setCategory] = useState('All categories');
  const [tagQuery, setTagQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [addPopoverOpen, setAddPopoverOpen] = useState(false);
  const activeFilterCount =
    Number(account !== 'All accounts') +
    Number(kind !== 'all') +
    Number(category !== 'All categories') +
    Number(Boolean(tagQuery.trim())) +
    Number(Boolean(fromDate)) +
    Number(Boolean(toDate));
  const clearFilters = () => {
    setAccount('All accounts');
    setKind('all');
    setCategory('All categories');
    setTagQuery('');
    setFromDate('');
    setToDate('');
  };
  const filtered = useMemo(
    () =>
      data.transactions.filter((transaction) => {
        const matchesAccount = account === 'All accounts' || transaction.account === account;
        const matchesKind = kind === 'all' || transaction.kind === kind;
        const matchesCategory = category === 'All categories' || transaction.category === category;
        const matchesTag =
          !tagQuery ||
          (transaction.tags ?? []).some((tag) =>
            tag.toLowerCase().includes(tagQuery.toLowerCase()),
          );
        const matchesDate =
          (!fromDate || transaction.date >= fromDate) && (!toDate || transaction.date <= toDate);
        return matchesAccount && matchesKind && matchesCategory && matchesTag && matchesDate;
      }),
    [account, category, data.transactions, fromDate, kind, tagQuery, toDate],
  );
  return (
    <>
      <PageHeader title="Transactions" />
      <MoneyLentPanel transactions={data.transactions} />
      <section className="transactions-section">
        <div className="transaction-toolbar">
          <div className="transaction-toolbar-actions">
            <Popover>
              <PopoverTrigger asChild>
                <button className="button transaction-filter-trigger" type="button">
                  <SlidersHorizontal size={15} />
                  Filters
                  {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="transaction-filter-popover">
                <div className="transaction-filter-heading">
                  <strong>Filter transactions</strong>
                  <button
                    className="text-button"
                    type="button"
                    onClick={clearFilters}
                    disabled={activeFilterCount === 0}
                  >
                    Clear all
                  </button>
                </div>
                <label className="transaction-filter-field">
                  Account
                  <select value={account} onChange={(event) => setAccount(event.target.value)}>
                    <option>All accounts</option>
                    {data.accounts.map((item) => (
                      <option key={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
                <div className="transaction-filter-field">
                  <span>Type</span>
                  <div className="filter-group" role="group" aria-label="Transaction type">
                    {(['all', 'expense', 'income'] as const).map((option) => (
                      <button
                        key={option}
                        className={kind === option ? 'is-active' : ''}
                        type="button"
                        onClick={() => setKind(option)}
                      >
                        {option === 'all' ? 'All' : option === 'expense' ? 'Expenses' : 'Income'}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="transaction-filter-field">
                  Category
                  <select value={category} onChange={(event) => setCategory(event.target.value)}>
                    <option>All categories</option>
                    {[...new Set(data.transactions.map((item) => item.category))]
                      .sort()
                      .map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                  </select>
                </label>
                <label className="transaction-filter-field">
                  Tag
                  <input
                    value={tagQuery}
                    onChange={(event) => setTagQuery(event.target.value)}
                    placeholder="Filter by tag"
                  />
                </label>
                <div className="transaction-date-filters">
                  <label className="transaction-filter-field">
                    From
                    <input
                      type="date"
                      value={fromDate}
                      onChange={(event) => setFromDate(event.target.value)}
                      aria-label="From date"
                    />
                  </label>
                  <label className="transaction-filter-field">
                    To
                    <input
                      type="date"
                      value={toDate}
                      onChange={(event) => setToDate(event.target.value)}
                      aria-label="To date"
                    />
                  </label>
                </div>
              </PopoverContent>
            </Popover>
            <Popover open={addPopoverOpen} onOpenChange={setAddPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  className="button button-primary transaction-add-trigger"
                  type="button"
                  aria-label="Add finance entry"
                >
                  <Plus size={17} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="transaction-add-popover">
                <button
                  type="button"
                  onClick={() => {
                    setAddPopoverOpen(false);
                    onAddTransaction();
                  }}
                >
                  Add transaction
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddPopoverOpen(false);
                    onAddAccount();
                  }}
                >
                  <Landmark size={15} /> Add account
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddPopoverOpen(false);
                    onAddCheckpoint();
                  }}
                >
                  <CheckCircle2 size={15} /> Record checkpoint
                </button>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <div className="table-header">
          <span>Transaction</span>
          <span>Date</span>
          <span>Amount</span>
          <span />
        </div>
        <div className="transaction-list transaction-table transaction-cards">
          {filtered.length ? (
            filtered.map((transaction) => (
              <TransactionRow
                key={transaction.id}
                transaction={transaction}
                onOpen={() => onOpenTransaction(transaction)}
                onEdit={() => onEditTransaction(transaction)}
                onDelete={() => onDeleteTransaction(transaction)}
              />
            ))
          ) : (
            <div className="empty-state">
              <Search size={20} />
              <strong>No transactions found</strong>
              <span>Try changing your filters.</span>
            </div>
          )}
        </div>
        <div className="table-footer">
          Showing {filtered.length} of {data.transactions.length} transactions{' '}
          <button className="text-button" type="button">
            <Filter size={14} /> Saved views
          </button>
        </div>
      </section>
    </>
  );
}

function MoneyLentPanel({ transactions }: { transactions: Transaction[] }) {
  const people = useMemo(() => {
    const balances = new Map<string, number>();
    for (const transaction of transactions) {
      const person = transaction.receivable?.trim();
      if (!person) continue;
      const change = transaction.kind === 'expense' ? transaction.amount : -transaction.amount;
      balances.set(person, (balances.get(person) ?? 0) + change);
    }
    return [...balances.entries()]
      .filter(([, balance]) => balance > 0.005)
      .map(([person, balance]) => ({ person, balance }));
  }, [transactions]);
  const reminderStorageKey = `piggybudget-receivable-reminders:${pb.authStore.record?.id ?? 'guest'}`;
  const [reminders, setReminders] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(reminderStorageKey) ?? '{}') as Record<string, string>;
    } catch {
      return {};
    }
  });
  const setReminder = (person: string, date: string) => {
    const next = { ...reminders, [person]: date };
    setReminders(next);
    localStorage.setItem(reminderStorageKey, JSON.stringify(next));
  };
  if (!people.length) return null;
  return (
    <section className="panel" aria-label="Money lent">
      <SectionHeading title="Money lent" />
      <p className="page-description">
        Add a person to a transaction to track money lent. Repayments should use the same name.
      </p>
      <div className="asset-list">
        {people.map(({ person, balance }) => (
          <div className="asset-row" key={person}>
            <span className="asset-mark">
              <HandCoins size={16} />
            </span>
            <div className="asset-main">
              <strong>{person}</strong>
              <span>Still owed</span>
            </div>
            <strong>{formatMoney(balance)}</strong>
            <label>
              Remind me
              <input
                aria-label={`Reminder date for ${person}`}
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={reminders[person] ?? ''}
                onChange={(event) => setReminder(person, event.target.value)}
              />
            </label>
            {reminders[person] && reminders[person] <= new Date().toISOString().slice(0, 10) && (
              <span role="status">Reminder due</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function BudgetsView({ data, onAddBudget }: { data: BudgetData; onAddBudget: () => void }) {
  const totalSpent = data.budgets.reduce((sum, budget) => sum + budget.spent, 0);
  const totalLimit = data.budgets.reduce((sum, budget) => sum + budget.limit, 0);
  return (
    <>
      <PageHeader
        title="Budgets"
        description="Give every dollar a job, then check in as you go."
        action={
          <button className="button button-primary" type="button" onClick={onAddBudget}>
            <Plus size={16} /> New budget
          </button>
        }
      />
      <div className="budget-summary-grid">
        <article className="budget-summary-card">
          <span>Total planned</span>
          <strong>{formatMoney(totalLimit)}</strong>
          <small>for September</small>
        </article>
        <article className="budget-summary-card is-highlight">
          <span>Spent so far</span>
          <strong>{formatMoney(totalSpent)}</strong>
          <small>{Math.round((totalSpent / totalLimit) * 100)}% of plan</small>
        </article>
        <article className="budget-summary-card">
          <span>Left to spend</span>
          <strong>{formatMoney(totalLimit - totalSpent)}</strong>
          <small>across {data.budgets.length} categories</small>
        </article>
      </div>
      <div className="dashboard-grid budgets-layout">
        <section className="panel">
          <SectionHeading
            title="September budgets"
            action={
              <button className="select-button" type="button">
                Monthly <ChevronDown size={14} />
              </button>
            }
          />
          <div className="budget-list budget-list-large">
            {data.budgets.map((budget) => (
              <BudgetLine key={budget.id} budget={budget} />
            ))}
          </div>
          <button className="add-line-button" type="button" onClick={onAddBudget}>
            <Plus size={15} /> Add category
          </button>
        </section>
        <div className="stacked-cards">
          <ReconciliationCard reconciliation={data.reconciliation} compact />
          <article className="panel unknown-panel">
            <div className="small-panel-icon">
              <CircleHelp size={17} />
            </div>
            <div>
              <h3>What is an unknown gap?</h3>
              <p>
                It is the space between what your accounts say happened and what you have recorded.
                Resolve it before the month closes.
              </p>
              <button className="text-button" type="button">
                Learn about reconciliation <ArrowRight size={14} />
              </button>
            </div>
          </article>
        </div>
      </div>
    </>
  );
}

function AssetsView({
  data,
  onRefresh,
  onAddAsset,
  onEditAsset,
  onDeleteAsset,
}: {
  data: BudgetData;
  onRefresh: () => void;
  onAddAsset: () => void;
  onEditAsset: (asset: Asset) => void;
  onDeleteAsset: (asset: Asset) => void;
}) {
  const totalValue =
    data.assets.reduce((sum, asset) => sum + asset.value, 0) +
    data.assetPositions.reduce((sum, position) => sum + position.value, 0);
  const totalCost =
    data.assets.reduce((sum, asset) => sum + asset.cost, 0) +
    data.assetPositions.reduce((sum, position) => sum + position.purchasePrice, 0);
  const roi = totalCost ? ((totalValue - totalCost) / totalCost) * 100 : 0;
  return (
    <>
      <PageHeader
        title="Assets"
        description="See your net worth and how each part is working for you."
        action={
          <button className="button" type="button" onClick={onAddAsset}>
            <Plus size={15} /> Add asset
          </button>
        }
      />
      <div className="asset-hero-grid">
        <section className="panel net-worth-panel">
          <div className="net-worth-copy">
            <span>Total net worth</span>
            <strong>{formatMoney(totalValue)}</strong>
            <small>
              <ArrowUpRight size={14} /> {roi.toFixed(1)}% return overall
            </small>
          </div>
          <div
            className="asset-donut"
            style={{
              background: `conic-gradient(#5f8d7e 0 42%, #be8a54 42% 76%, #8e82b9 76% 100%)`,
            }}
          >
            <div>
              <strong>100%</strong>
              <small>assets</small>
            </div>
          </div>
        </section>
        <section className="panel roi-panel">
          <div className="small-panel-icon is-green">
            <TrendingUp size={17} />
          </div>
          <span>Portfolio ROI</span>
          <strong>+{formatMoney(totalValue - totalCost)}</strong>
          <small>Since you started tracking</small>
          <div className="mini-sparkline">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </section>
      </div>
      <section className="asset-list-panel">
        <SectionHeading
          title="Your assets"
          action={
            <button className="text-button" type="button" onClick={onAddAsset}>
              <Plus size={14} /> Add asset
            </button>
          }
        />
        <div className="asset-card-grid">
          {data.assets.map((asset) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              onEdit={() => onEditAsset(asset)}
              onDelete={() => onDeleteAsset(asset)}
            />
          ))}
        </div>
      </section>
      <AssetGroupsSection
        groups={data.assetGroups}
        positions={data.assetPositions}
        onRefresh={onRefresh}
      />
    </>
  );
}

function AssetRow({
  asset,
  onEdit,
  onDelete,
}: {
  asset: Asset;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const returnValue = asset.value - asset.cost;
  const returnPercentage = asset.cost ? (returnValue / asset.cost) * 100 : 0;
  return (
    <article className="asset-row asset-card">
      <span className="asset-mark" style={{ background: asset.color }}>
        <TrendingUp size={16} />
      </span>
      <div className="asset-main">
        <strong>{asset.name}</strong>
        <span>
          {asset.type}
          {asset.purchaseDate && ` · Purchased ${asset.purchaseDate}`}
          {asset.targetSalePrice ? ` · Target sale ${formatMoney(asset.targetSalePrice)}` : ''}
        </span>
      </div>
      <div className="asset-bar">
        <ProgressBar value={(asset.value / 50000) * 100} color={asset.color} />
      </div>
      <div className="asset-numbers">
        <strong>{formatMoney(asset.value)}</strong>
        <span className="positive">
          +{returnPercentage.toFixed(1)}% <small>({formatMoney(returnValue)})</small>
        </span>
      </div>
      <span className="row-actions">
        <button className="text-button" type="button" onClick={onEdit}>
          Edit
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${asset.name}`}
        >
          <Trash2 size={15} />
        </button>
      </span>
    </article>
  );
}

function AssetGroupsSection({
  groups,
  positions,
  onRefresh,
}: {
  groups: AssetGroup[];
  positions: AssetPosition[];
  onRefresh: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const createGroup = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await apiFetch('/api/finance/asset-groups', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pb.authStore.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: name.trim(), currency: 'USD' }),
      });
      if (!response.ok) throw new Error((await response.text()) || 'Could not create asset group.');
      setName('');
      setCreating(false);
      onRefresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not create asset group.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="asset-groups-section">
      <SectionHeading
        title="Asset groups"
        action={
          <button
            className="text-button"
            type="button"
            onClick={() => setCreating((value) => !value)}
          >
            <Plus size={14} /> Add group
          </button>
        }
      />
      {creating && (
        <form className="asset-group-create" onSubmit={createGroup}>
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Group name, e.g. Index fund"
            aria-label="Asset group name"
          />
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Create group'}
          </button>
        </form>
      )}
      {groups.length ? (
        <div className="asset-group-grid">
          {groups
            .filter((group) => !group.archived)
            .map((group) => (
              <AssetGroupCard
                key={group.id}
                group={group}
                positions={positions.filter(
                  (position) => position.group === group.id && !position.archived,
                )}
                onRefresh={onRefresh}
              />
            ))}
        </div>
      ) : (
        <p className="asset-group-empty">
          Group a fund or portfolio, then track each holding’s buy and planned sell value
          separately.
        </p>
      )}
    </section>
  );
}

function AssetGroupCard({
  group,
  positions,
  onRefresh,
}: {
  group: AssetGroup;
  positions: AssetPosition[];
  onRefresh: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [targetSalePrice, setTargetSalePrice] = useState('');
  const [editingPosition, setEditingPosition] = useState<string | null>(null);
  const [salePrice, setSalePrice] = useState('');
  const savePosition = async (event: React.FormEvent) => {
    event.preventDefault();
    const response = await apiFetch('/api/finance/asset-positions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pb.authStore.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        group: group.id,
        name: name.trim(),
        value: Number(value),
        purchase_price: Number(purchasePrice),
        target_sale_price: Number(targetSalePrice),
        currency: group.currency || 'USD',
      }),
    });
    if (!response.ok) {
      window.alert((await response.text()) || 'Could not save holding.');
      return;
    }
    setAdding(false);
    setName('');
    setValue('');
    setPurchasePrice('');
    setTargetSalePrice('');
    onRefresh();
  };
  const updateSalePrice = async (position: AssetPosition) => {
    const response = await apiFetch(`/api/finance/asset-positions/${position.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${pb.authStore.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ target_sale_price: Number(salePrice) }),
    });
    if (!response.ok) {
      window.alert((await response.text()) || 'Could not update sale value.');
      return;
    }
    setEditingPosition(null);
    onRefresh();
  };
  return (
    <article className="asset-group-card">
      <header>
        <div>
          <h3>{group.name}</h3>
          <span>{positions.length} holdings</span>
        </div>
        <button className="text-button" type="button" onClick={() => setAdding((open) => !open)}>
          <Plus size={14} /> Add holding
        </button>
      </header>
      {positions.map((position) => (
        <div className="asset-position" key={position.id}>
          <strong>{position.name}</strong>
          <span>
            Buy {formatMoney(position.purchasePrice)} · Sell {formatMoney(position.targetSalePrice)}
          </span>
          <b>{formatMoney(position.value)}</b>
          {editingPosition === position.id ? (
            <div className="asset-position-edit">
              <input
                aria-label={`Sell value for ${position.name}`}
                type="number"
                min="0"
                step="0.01"
                value={salePrice}
                onChange={(event) => setSalePrice(event.target.value)}
              />
              <button
                className="text-button"
                type="button"
                onClick={() => void updateSalePrice(position)}
              >
                Save
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => setEditingPosition(null)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              className="text-button asset-position-edit-trigger"
              type="button"
              onClick={() => {
                setEditingPosition(position.id);
                setSalePrice(String(position.targetSalePrice));
              }}
            >
              Update sell value
            </button>
          )}
        </div>
      ))}
      {adding && (
        <form className="asset-position-form" onSubmit={(event) => void savePosition(event)}>
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Stock or holding"
            aria-label="Holding name"
          />
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Current value"
            aria-label="Current value"
          />
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={purchasePrice}
            onChange={(event) => setPurchasePrice(event.target.value)}
            placeholder="Buy value"
            aria-label="Buy value"
          />
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={targetSalePrice}
            onChange={(event) => setTargetSalePrice(event.target.value)}
            placeholder="Sell value"
            aria-label="Sell value"
          />
          <button className="button button-primary" type="submit">
            Save holding
          </button>
        </form>
      )}
    </article>
  );
}

function GoalsView({ data }: { data: BudgetData }) {
  return (
    <>
      <PageHeader
        title="Goals"
        description="Small, steady progress adds up to a life you choose."
        action={
          <button className="button button-primary">
            <Plus size={16} /> New goal
          </button>
        }
      />
      <section className="goal-intro">
        <div>
          <span className="goal-intro-icon">
            <Target size={20} />
          </span>
          <div>
            <strong>
              {formatMoney(data.goals.reduce((sum, goal) => sum + goal.current, 0))} saved toward
              your goals
            </strong>
            <p>You are making good progress. Keep the momentum going.</p>
          </div>
        </div>
        <button className="button button-quiet">
          <CalendarDays size={15} /> View timeline
        </button>
      </section>
      <div className="goal-grid">
        {data.goals.map((goal) => (
          <GoalCard key={goal.id} goal={goal} />
        ))}
        <button className="goal-add-card" type="button">
          <span>
            <Plus size={20} />
          </span>
          <strong>Start a new goal</strong>
          <small>Trips, projects, or peace of mind</small>
        </button>
      </div>
    </>
  );
}

function GoalCard({ goal }: { goal: Goal }) {
  const progress = goal.target ? (goal.current / goal.target) * 100 : 0;
  return (
    <article className="goal-card">
      <div className="goal-card-top">
        <span className="goal-mark" style={{ background: goal.color }}>
          <Target size={17} />
        </span>
        <button className="icon-button" aria-label={`More options for ${goal.name}`} type="button">
          <MoreHorizontal size={17} />
        </button>
      </div>
      <h3>{goal.name}</h3>
      <div className="goal-amount">
        <strong>{formatMoney(goal.current)}</strong>
        <span>of {formatMoney(goal.target)}</span>
      </div>
      <ProgressBar value={progress} color={goal.color} />
      <div className="goal-card-footer">
        <span>{Math.round(progress)}% complete</span>
        <span>Target {goal.deadline}</span>
      </div>
      {progress >= 50 && (
        <div className="goal-note">
          <CheckCircle2 size={14} /> Nice work — halfway there
        </div>
      )}
    </article>
  );
}

export function BudgetingDashboard({
  view,
  userId,
  data,
  remote,
  loading,
  onRefresh,
  onNavigate,
  profile,
}: Props) {
  const [settingsMessage, setSettingsMessage] = useState('');
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [composer, setComposer] = useState<
    'account' | 'transaction' | 'checkpoint' | 'asset' | 'budget' | null
  >(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [viewingTransaction, setViewingTransaction] = useState<Transaction | null>(null);
  useEffect(() => {
    if (!userId || !remote || data.accounts.length > 0) return;
    if (localStorage.getItem(onboardingStorageKey(userId)) !== 'complete') {
      setOnboardingOpen(true);
    }
  }, [data.accounts.length, remote, userId]);
  if (loading)
    return (
      <div className="loading-state">
        <div className="loading-orb">
          <Wallet size={21} />
        </div>
        <strong>Loading your money space…</strong>
        <span>Using your latest balances when available.</span>
      </div>
    );
  const closeComposer = () => {
    setComposer(null);
    setEditingTransaction(null);
    setEditingAsset(null);
  };
  const saved = () => {
    closeComposer();
    onRefresh();
  };
  const deleteRecord = async (resource: 'transactions' | 'assets', id: string, name: string) => {
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    const response = await apiFetch(`/api/finance/${resource}/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${pb.authStore.token}` },
    });
    if (!response.ok) {
      window.alert((await response.text()) || `Could not delete ${name}.`);
      return;
    }
    onRefresh();
  };
  const content =
    view === 'dashboard' ? (
      <DashboardView
        data={data}
        onNavigate={onNavigate}
        onAddTransaction={() => setComposer('transaction')}
      />
    ) : view === 'transactions' ? (
      <TransactionsView
        data={data}
        onAddTransaction={() => setComposer('transaction')}
        onAddCheckpoint={() => setComposer('checkpoint')}
        onAddAccount={() => setComposer('account')}
        onEditTransaction={(transaction) => {
          setEditingTransaction(transaction);
          setComposer('transaction');
        }}
        onDeleteTransaction={(transaction) =>
          void deleteRecord('transactions', transaction.id, transaction.merchant)
        }
        onOpenTransaction={setViewingTransaction}
      />
    ) : view === 'budgets' ? (
      <BudgetsView data={data} onAddBudget={() => setComposer('budget')} />
    ) : view === 'assets' ? (
      <AssetsView
        data={data}
        onRefresh={onRefresh}
        onAddAsset={() => setComposer('asset')}
        onEditAsset={(asset) => {
          setEditingAsset(asset);
          setComposer('asset');
        }}
        onDeleteAsset={(asset) => void deleteRecord('assets', asset.id, asset.name)}
      />
    ) : view === 'goals' ? (
      <GoalsView data={data} />
    ) : (
      <SettingsView
        remote={remote}
        onRefresh={onRefresh}
        onStartOnboarding={() => setOnboardingOpen(true)}
        onMessage={setSettingsMessage}
        settingsMessage={settingsMessage}
        profile={profile}
      />
    );
  return (
    <>
      {content}
      {composer && (
        <FinanceComposer
          kind={composer}
          data={data}
          remote={remote}
          transaction={editingTransaction}
          asset={editingAsset}
          onClose={closeComposer}
          onSaved={saved}
        />
      )}
      {viewingTransaction && (
        <TransactionDetails
          transaction={viewingTransaction}
          remote={remote}
          onClose={() => setViewingTransaction(null)}
          onEdit={() => {
            setEditingTransaction(viewingTransaction);
            setViewingTransaction(null);
            setComposer('transaction');
          }}
        />
      )}
      {onboardingOpen && (
        <WelcomeWalkthrough
          accounts={data.accounts}
          onClose={() => {
            localStorage.setItem(onboardingStorageKey(userId), 'complete');
            setOnboardingOpen(false);
          }}
          onSaved={() => {
            onRefresh();
          }}
        />
      )}
    </>
  );
}

function onboardingStorageKey(userId: string) {
  return `piggybudget:onboarding:${userId}`;
}

type TransactionAttachment = {
  id: string;
  file: string;
  collectionId: string;
  collectionName: string;
  url: string;
};

function validateTransactionFiles(files: File[]) {
  if (files.length > 5 || files.some((file) => file.size > 5 * 1024 * 1024)) {
    throw new Error('Upload up to 5 images, each no larger than 5 MB.');
  }
  if (
    files.some(
      (file) => !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type),
    )
  ) {
    throw new Error('Use JPEG, PNG, GIF, or WebP images.');
  }
}

async function uploadTransactionFiles(transactionId: string, files: File[]) {
  if (!files.length) return;
  validateTransactionFiles(files);
  const body = new FormData();
  files.forEach((file) => body.append('files', file));
  const response = await apiFetch(`/api/finance/transactions/${transactionId}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pb.authStore.token}` },
    body,
  });
  if (!response.ok)
    throw new Error((await response.text()) || 'Could not upload transaction images.');
}

function TransactionDetails({
  transaction,
  remote,
  onClose,
  onEdit,
}: {
  transaction: Transaction;
  remote: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  const [attachments, setAttachments] = useState<TransactionAttachment[]>([]);
  const [loading, setLoading] = useState(remote);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);
  const closeAction = useRef<(() => void) | null>(null);

  const loadAttachments = async () => {
    if (!remote) return;
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch(`/api/finance/transactions/${transaction.id}/attachments`, {
        headers: { Authorization: `Bearer ${pb.authStore.token}` },
      });
      if (!response.ok) throw new Error('Could not load transaction images.');
      const records = (await response.json()) as Omit<TransactionAttachment, 'url'>[];
      const token = records.length ? await pb.files.getToken() : '';
      setAttachments(
        records.map((record) => ({
          ...record,
          url: pb.files.getURL(record as RecordModel, record.file, { token }),
        })),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load transaction images.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAttachments();
  }, [transaction.id, remote]);

  const close = (action: () => void = onClose) => {
    if (closing) return;
    closeAction.current = action;
    setClosing(true);
  };
  const finishClose = (event: React.AnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !closing) return;
    closeAction.current?.();
  };
  const upload = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    setError('');
    try {
      await uploadTransactionFiles(transaction.id, files);
      await loadAttachments();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not upload transaction images.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className={`composer-overlay transaction-details-overlay ${closing ? 'is-closing' : ''}`}
      onAnimationEnd={finishClose}
    >
      <button
        className="composer-backdrop"
        type="button"
        onClick={() => close()}
        aria-label="Close transaction details"
      />
      <section
        className="composer-card transaction-details-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-detail-title"
      >
        <div className="composer-heading">
          <div>
            <h2 id="transaction-detail-title">{transaction.merchant}</h2>
            <span>{formatDate(transaction.date)}</span>
          </div>
          <button className="icon-button" type="button" onClick={() => close()} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <dl className="transaction-detail-list">
          <div>
            <dt>Amount</dt>
            <dd>{formatMoney(transaction.amount)}</dd>
          </div>
          <div>
            <dt>Account</dt>
            <dd>{transaction.account}</dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>{transaction.category}</dd>
          </div>
          {transaction.note && (
            <div>
              <dt>Note</dt>
              <dd>{transaction.note}</dd>
            </div>
          )}
          {transaction.description && (
            <div>
              <dt>Description</dt>
              <dd>{transaction.description}</dd>
            </div>
          )}
        </dl>
        {transaction.receipt?.startsWith('data:image/') && (
          <div className="transaction-detail-receipt">
            <strong>Receipt</strong>
            <img src={transaction.receipt} alt={`Receipt for ${transaction.merchant}`} />
          </div>
        )}
        <section className="transaction-attachments">
          <div className="transaction-attachments-heading">
            <strong>Pictures</strong>
            {remote && (
              <label className="button transaction-upload-button">
                {uploading ? 'Uploading…' : 'Add pictures'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  multiple
                  disabled={uploading}
                  onChange={(event) => {
                    void upload(Array.from(event.target.files ?? []));
                    event.currentTarget.value = '';
                  }}
                />
              </label>
            )}
          </div>
          {!remote ? (
            <p>Save this transaction to attach pictures.</p>
          ) : loading ? (
            <p>Loading pictures…</p>
          ) : attachments.length ? (
            <div className="transaction-attachment-grid">
              {attachments.map((attachment) => (
                <a href={attachment.url} target="_blank" rel="noreferrer" key={attachment.id}>
                  <img src={attachment.url} alt={`Attachment for ${transaction.merchant}`} />
                </a>
              ))}
            </div>
          ) : (
            <p>No pictures attached.</p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </section>
        <div className="composer-actions">
          <button className="button" type="button" onClick={() => close()}>
            Close
          </button>
          <button className="button button-primary" type="button" onClick={() => close(onEdit)}>
            Edit transaction
          </button>
        </div>
      </section>
    </div>
  );
}

function SettingsView({
  remote,
  onRefresh,
  onStartOnboarding,
  onMessage,
  settingsMessage,
  profile,
}: {
  remote: boolean;
  onRefresh: () => void;
  onStartOnboarding: () => void;
  onMessage: (message: string) => void;
  settingsMessage: string;
  profile: UserProfile;
}) {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Keep Piggybudget feeling like your own."
        action={
          <button className="button" type="button" onClick={onRefresh}>
            <RefreshCw size={15} /> {remote ? 'Refresh synced data' : 'Try to sync data'}
          </button>
        }
      />
      <section className="settings-grid">
        <article className="panel settings-card">
          <div className="profile-large">{profile.initials}</div>
          <div>
            <h2>{profile.name}</h2>
            <p>{profile.email || 'No email on file'}</p>
            <button
              className="text-button"
              type="button"
              onClick={() => onMessage('Profile editing will be available soon.')}
            >
              Edit profile <ArrowRight size={14} />
            </button>
          </div>
        </article>
        {import.meta.env.DEV && (
          <article className="panel settings-card">
            <div className="small-panel-icon">
              <Landmark size={17} />
            </div>
            <div>
              <h3>Developer settings</h3>
              <p>Restart the welcome walkthrough and configure the default account.</p>
              <button className="text-button" type="button" onClick={onStartOnboarding}>
                Start onboarding <ArrowRight size={14} />
              </button>
            </div>
          </article>
        )}
        <article className="panel settings-card">
          <div className="small-panel-icon">
            <SlidersHorizontal size={17} />
          </div>
          <div>
            <h3>Preferences</h3>
            <p>
              Currency · USD
              <br />
              Week starts on Monday
              <br />
              Notifications · On
            </p>
            <button
              className="text-button"
              type="button"
              onClick={() => onMessage('Preferences saved locally.')}
            >
              Manage preferences <ArrowRight size={14} />
            </button>
          </div>
        </article>
        {settingsMessage && (
          <div className="settings-message">
            <Check size={15} /> {settingsMessage}
          </div>
        )}
      </section>
    </>
  );
}

function WelcomeWalkthrough({
  accounts,
  onClose,
  onSaved,
}: {
  accounts: BudgetData['accounts'];
  onClose: () => void;
  onSaved: () => void;
}) {
  const defaultAccount = accounts.find((account) => account.isDefault) ?? accounts[0];
  const [step, setStep] = useState<'welcome' | 'account' | 'complete'>('welcome');
  const [name, setName] = useState(defaultAccount?.name ?? 'Everyday checking');
  const [type, setType] = useState(defaultAccount?.type.toLowerCase() ?? 'checking');
  const [currency, setCurrency] = useState(defaultAccount?.currency ?? 'USD');
  const [openingBalance, setOpeningBalance] = useState(String(defaultAccount?.openingBalance ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const saveDefaultAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(
        `/api/finance/accounts${defaultAccount ? `/${defaultAccount.id}` : ''}`,
        {
          method: defaultAccount ? 'PATCH' : 'POST',
          headers: {
            Authorization: `Bearer ${pb.authStore.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: name.trim(),
            type,
            currency: currency.trim().toUpperCase(),
            opening_balance: Number(openingBalance),
            is_default: true,
          }),
        },
      );
      if (!response.ok) throw new Error((await response.text()) || 'Could not save the account.');
      for (const account of accounts) {
        if (account.id === defaultAccount?.id || !account.isDefault) continue;
        const unsetResponse = await apiFetch(`/api/finance/accounts/${account.id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${pb.authStore.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ is_default: false }),
        });
        if (!unsetResponse.ok) {
          throw new Error((await unsetResponse.text()) || 'Could not update the default account.');
        }
      }
      onSaved();
      setStep('complete');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer-overlay">
      <button className="composer-backdrop" type="button" onClick={onClose} aria-label="Close" />
      <section
        className="composer-card welcome-walkthrough"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-walkthrough-title"
      >
        {step === 'welcome' ? (
          <>
            <div className="composer-heading">
              <div>
                <h2 id="welcome-walkthrough-title">Welcome to Piggybudget</h2>
                <span>Set up the account you use most.</span>
              </div>
              <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <p className="page-description">
              Your default account is selected automatically when you add a transaction. You can
              change this setup any time in Developer settings.
            </p>
            <div className="composer-actions">
              <button className="button" type="button" onClick={onClose}>
                Later
              </button>
              <button
                className="button button-primary"
                type="button"
                onClick={() => setStep('account')}
              >
                Configure account <ArrowRight size={14} />
              </button>
            </div>
          </>
        ) : step === 'complete' ? (
          <>
            <div className="composer-heading">
              <div>
                <h2 id="welcome-walkthrough-title">You’re ready</h2>
                <span>{name} is now your default account.</span>
              </div>
              <CheckCircle2 size={20} />
            </div>
            <div className="composer-actions">
              <button className="button button-primary" type="button" onClick={onClose}>
                Open Piggybudget
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={(event) => void saveDefaultAccount(event)}>
            <div className="composer-heading">
              <div>
                <h2 id="welcome-walkthrough-title">Configure your default account</h2>
                <span>This account will be preselected for new transactions.</span>
              </div>
              <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <label>
              Account name
              <input required value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              Account type
              <select value={type} onChange={(event) => setType(event.target.value)}>
                <option value="checking">Checking</option>
                <option value="cash">Cash</option>
                <option value="savings">Savings</option>
                <option value="credit">Credit card</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Currency
              <input
                required
                maxLength={3}
                value={currency}
                onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              />
            </label>
            <label>
              Starting balance
              <input
                required
                step="0.01"
                type="number"
                value={openingBalance}
                onChange={(event) => setOpeningBalance(event.target.value)}
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="composer-actions">
              <button className="button" type="button" onClick={() => setStep('welcome')}>
                Back
              </button>
              <button className="button button-primary" type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save default account'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

async function scanReceipt(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) return '';
  const Detector = (
    window as Window & {
      TextDetector?: new () => {
        detect: (image: ImageBitmap) => Promise<Array<{ rawValue?: string }>>;
      };
    }
  ).TextDetector;
  if (!Detector || typeof createImageBitmap !== 'function') return '';
  try {
    const image = await createImageBitmap(file);
    try {
      const results = await new Detector().detect(image);
      return results.map((result) => result.rawValue ?? '').join('\\n');
    } finally {
      image.close();
    }
  } catch {
    return '';
  }
}

function FinanceComposer({
  kind,
  data,
  remote,
  transaction,
  asset,
  onClose,
  onSaved,
}: {
  kind: 'account' | 'transaction' | 'checkpoint' | 'asset' | 'budget';
  data: BudgetData;
  remote: boolean;
  transaction: Transaction | null;
  asset: Asset | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const defaultAccount = data.accounts.find((item) => item.isDefault) ?? data.accounts[0];
  const [account, setAccount] = useState(transaction?.accountId ?? defaultAccount?.id ?? '');
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState('Checking');
  const [currency, setCurrency] = useState('USD');
  const [date, setDate] = useState(
    transaction?.date ?? asset?.purchaseDate ?? new Date().toISOString().slice(0, 10),
  );
  const [amount, setAmount] = useState(
    transaction ? String(transaction.amount) : asset ? String(asset.value) : '',
  );
  const [payee, setPayee] = useState(transaction?.merchant ?? '');
  const [type, setType] = useState<'expense' | 'income'>(
    transaction?.kind === 'income' ? 'income' : 'expense',
  );
  const [note, setNote] = useState(transaction?.note ?? asset?.notes ?? '');
  const [description, setDescription] = useState(transaction?.description ?? '');
  const [receivable, setReceivable] = useState(transaction?.receivable ?? '');
  const [purchaseTransaction, setPurchaseTransaction] = useState(asset?.purchaseTransaction ?? '');
  const [category, setCategory] = useState(transaction?.category ?? '');
  const [budget, setBudget] = useState(transaction?.budgetId ?? '');
  const [tags, setTags] = useState(transaction?.tags?.join(', ') ?? '');
  const [receipt, setReceipt] = useState(transaction?.receipt ?? '');
  const [receiptScanMessage, setReceiptScanMessage] = useState('');
  const [pictureFiles, setPictureFiles] = useState<File[]>([]);
  const [savedTransactionId, setSavedTransactionId] = useState<string | null>(
    transaction?.id ?? null,
  );
  const [assetName, setAssetName] = useState(asset?.name ?? '');
  const [assetType, setAssetType] = useState(asset?.type ?? 'Other');
  const [purchasePrice, setPurchasePrice] = useState(
    String(asset?.purchasePrice ?? asset?.cost ?? ''),
  );
  const [targetSalePrice, setTargetSalePrice] = useState(String(asset?.targetSalePrice ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);
  const closeAction = useRef<(() => void) | null>(null);
  const beginClose = (action: () => void = onClose) => {
    if (closing) return;
    closeAction.current = action;
    setClosing(true);
  };
  const finishClose = (event: React.AnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !closing) return;
    closeAction.current?.();
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const numericAmount = Number(amount);
    const body =
      kind === 'account'
        ? { name: accountName, type: accountType, currency, opening_balance: numericAmount }
        : kind === 'budget'
          ? {
              name: category.trim(),
              category: category.trim(),
              amount: numericAmount,
              start_date: `${date.slice(0, 7)}-01`,
              end_date: new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0))
                .toISOString()
                .slice(0, 10),
              notes: note,
            }
          : kind === 'checkpoint'
            ? { account, date, balance: numericAmount, note }
            : kind === 'asset'
              ? {
                  name: assetName,
                  type: assetType,
                  value: numericAmount,
                  purchase_price: Number(purchasePrice) || 0,
                  purchase_date: date,
                  purchase_transaction: purchaseTransaction,
                  target_sale_price: Number(targetSalePrice) || 0,
                  currency,
                  notes: note,
                }
              : {
                  account,
                  date,
                  amount: type === 'expense' ? -Math.abs(numericAmount) : Math.abs(numericAmount),
                  type,
                  payee,
                  description,
                  receivable,
                  category,
                  budget,
                  tags: tags
                    .split(',')
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                  receipt,
                  notes: note,
                };
    try {
      const resource =
        kind === 'account'
          ? 'accounts'
          : kind === 'budget'
            ? 'budgets'
            : kind === 'checkpoint'
              ? 'checkpoints'
              : kind === 'asset'
                ? 'assets'
                : 'transactions';
      const editedId =
        kind === 'transaction'
          ? (transaction?.id ?? savedTransactionId ?? undefined)
          : kind === 'asset'
            ? asset?.id
            : undefined;
      if (kind === 'transaction' && pictureFiles.length) validateTransactionFiles(pictureFiles);
      const response = await apiFetch(`/api/finance/${resource}${editedId ? `/${editedId}` : ''}`, {
        method: editedId ? 'PUT' : 'POST',
        headers: {
          Authorization: `Bearer ${pb.authStore.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error((await response.text()) || 'Could not save this record.');
      if (kind === 'transaction' && pictureFiles.length) {
        const savedRecord = (await response.json()) as { id: string };
        const transactionId = editedId ?? savedRecord.id;
        setSavedTransactionId(transactionId);
        await uploadTransactionFiles(transactionId, pictureFiles);
      }
      beginClose(onSaved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this record.');
    } finally {
      setBusy(false);
    }
  };
  const isAccount = kind === 'account';
  const isAsset = kind === 'asset';
  const isBudget = kind === 'budget';
  const canSave = isAccount
    ? Boolean(accountName.trim())
    : remote &&
      (isAsset
        ? Boolean(assetName.trim())
        : isBudget
          ? Boolean(category.trim())
          : kind === 'transaction'
            ? Boolean(account)
            : Boolean(account));
  return (
    <div className={`composer-overlay ${closing ? 'is-closing' : ''}`} onAnimationEnd={finishClose}>
      <button
        className="composer-backdrop"
        type="button"
        onClick={() => beginClose()}
        aria-label="Close composer"
      />
      <form className="composer-card" onSubmit={submit}>
        <div className="composer-heading">
          <div>
            <h2>
              {isAccount
                ? 'Add an account'
                : isBudget
                  ? 'Create a monthly budget'
                  : isAsset
                    ? `${asset ? 'Edit' : 'Add'} asset`
                    : kind === 'checkpoint'
                      ? 'Record a checkpoint'
                      : `${transaction ? 'Edit' : 'Add'} transaction`}
            </h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => beginClose()}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        {!isAccount && !remote && (
          <p className="form-error">Add an account first. Sample balances are read-only.</p>
        )}
        {isBudget ? (
          <>
            <label>
              Bucket name
              <input
                required
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="e.g. Groceries"
              />
            </label>
            <label>
              Monthly amount
              <input
                required
                min="0.01"
                step="0.01"
                type="number"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <label>
              Month
              <input
                type="month"
                value={date.slice(0, 7)}
                onChange={(event) => setDate(`${event.target.value}-01`)}
              />
            </label>
          </>
        ) : isAsset ? (
          <>
            <label>
              Asset name
              <input
                required
                value={assetName}
                onChange={(event) => setAssetName(event.target.value)}
                placeholder="e.g. Camera"
              />
            </label>
            <label>
              Type
              <input
                value={assetType}
                onChange={(event) => setAssetType(event.target.value)}
                placeholder="e.g. Vehicle, inventory, investment"
              />
            </label>
            <label>
              Current value
              <input
                required
                min="0"
                step="0.01"
                type="number"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <label>
              Purchase price
              <input
                min="0"
                step="0.01"
                type="number"
                value={purchasePrice}
                onChange={(event) => setPurchasePrice(event.target.value)}
              />
            </label>
            <label>
              Purchase date
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <label>
              Purchase transaction
              <select
                value={purchaseTransaction}
                onChange={(event) => setPurchaseTransaction(event.target.value)}
              >
                <option value="">No linked transaction</option>
                {data.transactions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.date} · {item.merchant} · {formatMoney(item.amount)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Target sale price
              <input
                min="0"
                step="0.01"
                type="number"
                value={targetSalePrice}
                onChange={(event) => setTargetSalePrice(event.target.value)}
              />
            </label>
          </>
        ) : isAccount ? (
          <>
            <label>
              Account name
              <input
                required
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                placeholder="e.g. Checking"
              />
            </label>
            <label>
              Account type
              <select value={accountType} onChange={(event) => setAccountType(event.target.value)}>
                <option>Checking</option>
                <option>Cash</option>
                <option>Savings</option>
                <option>PayPal</option>
                <option>Other</option>
              </select>
            </label>
            <label>
              Currency
              <input
                required
                maxLength={3}
                value={currency}
                onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              />
            </label>
          </>
        ) : (
          <>
            <label>
              Account
              <select required value={account} onChange={(event) => setAccount(event.target.value)}>
                {data.accounts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {!isAsset && (
          <label>
            {isAccount ? 'Current balance' : kind === 'checkpoint' ? 'Actual balance' : 'Amount'}
            <input
              required
              min="0"
              step="0.01"
              type="number"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
            />
          </label>
        )}
        {!isAccount && !isAsset && (
          <label>
            Date
            <input
              required
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
        )}
        {kind === 'transaction' && (
          <>
            <label>
              Type
              <select
                value={type}
                onChange={(event) => setType(event.target.value as 'expense' | 'income')}
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </label>
            <label>
              Payee or source
              <input
                value={payee}
                onChange={(event) => setPayee(event.target.value)}
                placeholder="e.g. Grocery store"
              />
            </label>
            <label>
              Description
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Details for receipt matching or later review"
              />
            </label>
            <label>
              Category
              <input
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="e.g. Groceries"
              />
            </label>
            <label>
              Budget bucket
              <select value={budget} onChange={(event) => setBudget(event.target.value)}>
                <option value="">No budget</option>
                {data.budgets.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.category}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Receivable / person
              <input
                value={receivable}
                onChange={(event) => setReceivable(event.target.value)}
                placeholder="Name to link money lent and repayments"
              />
            </label>
            <label>
              Tags (comma separated)
              <input
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="work, reimbursable"
              />
            </label>
            <label>
              Receipt upload
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setReceiptScanMessage('');
                  const reader = new FileReader();
                  reader.onload = () => setReceipt(String(reader.result ?? ''));
                  reader.readAsDataURL(file);
                  void scanReceipt(file).then((text) => {
                    if (!text) {
                      setReceiptScanMessage(
                        'Receipt saved. Automatic text scanning is not supported in this browser; enter the details above.',
                      );
                      return;
                    }
                    const lines = text
                      .split(/\\n+/)
                      .map((line) => line.trim())
                      .filter(Boolean);
                    const amountMatch = text.match(
                      /(?:[$€£]\\s*)?([0-9]+[.,][0-9]{2})\\s*(?:[$€£])?/,
                    );
                    const dateMatch = text.match(/\\b(20\\d{2})[-/.](\\d{1,2})[-/.](\\d{1,2})\\b/);
                    const merchant = lines.find((line) => !/[0-9]{2,}/.test(line));
                    if (merchant) setPayee(merchant.slice(0, 120));
                    if (amountMatch) setAmount(amountMatch[1].replace(',', '.'));
                    if (dateMatch) {
                      const [, year, month, day] = dateMatch;
                      setDate(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
                    }
                    setReceiptScanMessage(
                      amountMatch || merchant
                        ? 'Text scanned. Check the details before saving.'
                        : 'Receipt saved, but no transaction details were found. Enter them above.',
                    );
                  });
                }}
              />
            </label>
            {receiptScanMessage && <p role="status">{receiptScanMessage}</p>}
            <label>
              Transaction pictures
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                multiple
                onChange={(event) => setPictureFiles(Array.from(event.target.files ?? []))}
              />
            </label>
            {pictureFiles.length > 0 && (
              <p>
                {pictureFiles.length} picture{pictureFiles.length === 1 ? '' : 's'} ready to upload.
              </p>
            )}
            {receipt && (
              <div className="receipt-preview">
                {receipt.startsWith('data:image/') ? (
                  <img
                    src={receipt}
                    alt="Receipt preview"
                    style={{ maxWidth: '100%', maxHeight: 220 }}
                  />
                ) : (
                  <a href={receipt} target="_blank" rel="noreferrer">
                    View saved receipt
                  </a>
                )}
                <button className="text-button" type="button" onClick={() => setReceipt('')}>
                  Remove receipt
                </button>
              </div>
            )}
          </>
        )}{' '}
        {!isAccount && (
          <label>
            Note
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional context"
              rows={3}
            />
          </label>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="composer-actions">
          <button className="button" type="button" onClick={() => beginClose()}>
            Cancel
          </button>
          <button className="button button-primary" type="submit" disabled={busy || !canSave}>
            {busy
              ? 'Saving…'
              : isAccount
                ? 'Save account'
                : isBudget
                  ? 'Save budget'
                  : kind === 'checkpoint'
                    ? 'Save checkpoint'
                    : isAsset
                      ? 'Save asset'
                      : transaction
                        ? 'Save changes'
                        : 'Save transaction'}
          </button>
        </div>
      </form>
    </div>
  );
}

export { DashboardView };
