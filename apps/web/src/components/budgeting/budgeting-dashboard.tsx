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
import { useTheme } from 'next-themes';
import type { SidebarTab } from '../sidebar';
import type { UserProfile } from '../../profile';
import { apiFetch } from '../../api/client';
import { pb } from '../../api/pocketbase';
import type {
  Account,
  Asset,
  AssetGroup,
  AssetPosition,
  Budget,
  BudgetData,
  Goal,
  FinanceRecordTarget,
  Transaction,
  TransactionKind,
} from './data';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

export type BudgetView = SidebarTab;

type UserPreferences = {
  currency: string;
  weekStart: 'monday' | 'sunday';
  dateFormat: 'locale' | 'day-first' | 'iso';
  numberFormat: 'locale' | 'en-US' | 'de-DE';
  theme: 'system' | 'light' | 'dark';
  notifications: boolean;
};

const defaultPreferences: UserPreferences = {
  currency: 'USD',
  weekStart: 'monday',
  dateFormat: 'locale',
  numberFormat: 'locale',
  theme: 'system',
  notifications: true,
};

function preferencesKey(userId: string) {
  return `piggybudget:preferences:${userId}`;
}

function readPreferences(userId = pb.authStore.record?.id ?? ''): UserPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(preferencesKey(userId)) ?? '{}') as Partial<UserPreferences>;
    return {
      currency: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'].includes(saved.currency ?? '')
        ? saved.currency!
        : defaultPreferences.currency,
      weekStart: saved.weekStart === 'sunday' ? 'sunday' : 'monday',
      dateFormat: ['day-first', 'iso'].includes(saved.dateFormat ?? '')
        ? saved.dateFormat as UserPreferences['dateFormat']
        : 'locale',
      numberFormat: ['en-US', 'de-DE'].includes(saved.numberFormat ?? '')
        ? saved.numberFormat as UserPreferences['numberFormat']
        : 'locale',
      theme: ['light', 'dark'].includes(saved.theme ?? '')
        ? saved.theme as UserPreferences['theme']
        : 'system',
      notifications: saved.notifications !== false,
    };
  } catch {
    return defaultPreferences;
  }
}

type Props = {
  view: BudgetView;
  userId: string;
  data: BudgetData;
  remote: boolean;
  loading: boolean;
  onRefresh: () => void;
  onNavigate: (view: BudgetView) => void;
  profile: UserProfile;
  recordTarget: FinanceRecordTarget | null;
  onRecordTargetHandled: () => void;
};

export function formatMoney(value: number, compact = false) {
  const preferences = readPreferences();
  const locale = preferences.numberFormat === 'locale' ? undefined : preferences.numberFormat;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: preferences.currency,
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 2,
  }).format(value);
}

export function formatDate(date: string) {
  const { dateFormat } = readPreferences();
  if (dateFormat === 'iso') return date.slice(0, 10);
  const locale = dateFormat === 'day-first' ? 'en-GB' : undefined;
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(
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
          {transaction.category || 'Uncategorized'} · {transaction.account}
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

type DashboardPeriod = 'this-month' | 'last-month' | 'this-week' | 'last-7-days' | 'last-30-days';

function dateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function periodRange(period: DashboardPeriod, weekStart: UserPreferences['weekStart']) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const end = new Date(today);
  const start = new Date(today);
  if (period === 'this-month') start.setDate(1);
  if (period === 'last-month') {
    start.setDate(1);
    start.setMonth(start.getMonth() - 1);
    end.setDate(0);
  }
  if (period === 'last-7-days') start.setDate(start.getDate() - 6);
  if (period === 'last-30-days') start.setDate(start.getDate() - 29);
  if (period === 'this-week') {
    const offset = weekStart === 'monday' ? (today.getDay() + 6) % 7 : today.getDay();
    start.setDate(start.getDate() - offset);
  }
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const previousEnd = new Date(start);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - days + 1);
  return { start, end, previousStart, previousEnd, days };
}

function CashFlowChart({
  transactions,
  start,
  end,
  onSelectDay,
}: {
  transactions: Transaction[];
  start: Date;
  end: Date;
  onSelectDay: (date: string) => void;
}) {
  const days = Array.from(
    { length: Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1 },
    (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = dateKey(date);
      const matchingTransactions = transactions.filter((transaction) => transaction.date === key);
      return {
        dateKey: key,
        date,
        label:
          Math.round((end.getTime() - start.getTime()) / 86_400_000) < 7
            ? new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date)
            : `${date.getMonth() + 1}/${date.getDate()}`,
        income: matchingTransactions
          .filter((transaction) => transaction.kind === 'income')
          .reduce((sum, transaction) => sum + transaction.amount, 0),
        expenses: matchingTransactions
          .filter((transaction) => transaction.kind === 'expense')
          .reduce((sum, transaction) => sum + transaction.amount, 0),
      };
    },
  );
  const scale = Math.max(
    2000,
    Math.ceil(Math.max(...days.flatMap((day) => [day.income, day.expenses])) / 1000) * 1000,
  );
  return (
    <div
      className="cashflow-chart"
      aria-label={`Cash flow from ${dateKey(start)} through ${dateKey(end)}`}
    >
      <div className="chart-y-labels">
        <span>{formatMoney(scale, true)}</span>
        <span>{formatMoney(scale / 2, true)}</span>
        <span>$0</span>
      </div>
      {days.some((day) => day.income > 0 || day.expenses > 0) ? (
        <div className="chart-bars" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
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
                    onClick={() => onSelectDay(day.dateKey)}
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
                    onClick={() => onSelectDay(day.dateKey)}
                  />
                </TooltipTrigger>
                <TooltipContent>{`${day.label} expenses: ${formatMoney(day.expenses)}`}</TooltipContent>
              </Tooltip>
            </div>
            <button
              className="chart-day-label"
              type="button"
              onClick={() => onSelectDay(day.dateKey)}
              aria-label={`Open transactions for ${new Intl.DateTimeFormat('en-US', { dateStyle: 'full' }).format(day.date)}`}
            >
              {day.label}
            </button>
          </div>
          ))}
        </div>
      ) : (
        <div className="chart-empty">No income or expenses in this date range.</div>
      )}
    </div>
  );
}

function FinanceHelper({
  data,
  reconciliation,
  onNavigate,
  onOpenTransaction,
}: {
  data: BudgetData;
  reconciliation: BudgetData['reconciliation'];
  onNavigate: (view: BudgetView) => void;
  onOpenTransaction: (transaction: Transaction) => void;
}) {
  const [answer, setAnswer] = useState<'changes' | 'spend' | null>(null);
  const expenses = data.transactions.filter((item) => item.kind === 'expense');
  const categoryTotals = new Map<string, number>();
  for (const transaction of expenses) {
    const category = transaction.category || 'Uncategorized';
    categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + transaction.amount);
  }
  const largestCategory = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])[0];
  const largestExpense = [...expenses].sort((a, b) => b.amount - a.amount)[0];
  const remainingBudget = data.budgets.reduce((sum, budget) => sum + budget.limit - budget.spent, 0);
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
        <button type="button" onClick={() => setAnswer('changes')}>
          What changed this month? <ArrowRight size={14} />
        </button>
        <button type="button" onClick={() => setAnswer('spend')}>
          How much can I spend? <ArrowRight size={14} />
        </button>
      </div>
      {answer === 'changes' && (
        <div className="helper-answer">
          {largestCategory
            ? `${largestCategory[0]} is your largest expense category at ${formatMoney(largestCategory[1])} across ${expenses.length} loaded expense${expenses.length === 1 ? '' : 's'}.`
            : 'There are no loaded expense transactions to compare yet.'}
          {largestExpense && (
            <button className="text-button" type="button" onClick={() => onOpenTransaction(largestExpense)}>
              Open largest expense: {largestExpense.merchant} <ArrowRight size={14} />
            </button>
          )}
        </div>
      )}
      {answer === 'spend' && (
        <div className="helper-answer">
          {data.budgets.length
            ? `${formatMoney(remainingBudget)} remains across ${data.budgets.length} loaded budgets. This is the sum of each budget limit minus its recorded spending.`
            : 'Add a budget to see how much remains to spend.'}
          <button className="text-button" type="button" onClick={() => onNavigate('budgets')}>
            Open budgets <ArrowRight size={14} />
          </button>
        </div>
      )}
      <small className="helper-note">No bank connection needed.</small>
    </aside>
  );
}

function DashboardView({
  data,
  profile,
  onNavigate,
  onAddTransaction,
  onOpenTransaction,
}: {
  data: BudgetData;
  profile: UserProfile;
  onNavigate: (view: BudgetView) => void;
  onAddTransaction: () => void;
  onOpenTransaction: (transaction: Transaction) => void;
}) {
  const [period, setPeriod] = useState<DashboardPeriod>('this-month');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const range = periodRange(period, readPreferences().weekStart);
  const currentTransactions = data.transactions.filter(
    (transaction) => transaction.date >= dateKey(range.start) && transaction.date <= dateKey(range.end),
  );
  const previousTransactions = data.transactions.filter(
    (transaction) =>
      transaction.date >= dateKey(range.previousStart) &&
      transaction.date <= dateKey(range.previousEnd),
  );
  const income = currentTransactions
    .filter((item) => item.kind === 'income')
    .reduce((sum, item) => sum + item.amount, 0);
  const expenses = currentTransactions
    .filter((item) => item.kind === 'expense')
    .reduce((sum, item) => sum + item.amount, 0);
  const previousNet = previousTransactions
    .filter((item) => item.kind === 'income')
    .reduce((sum, item) => sum + item.amount, 0) -
    previousTransactions
      .filter((item) => item.kind === 'expense')
      .reduce((sum, item) => sum + item.amount, 0);
  const netChange = income - expenses - previousNet;
  const firstName = profile.name.trim().split(/\s+/)[0] || 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const recent = data.transactions.slice(0, 5);
  const selectedDayTransactions = selectedDay
    ? currentTransactions.filter((transaction) => transaction.date === selectedDay)
    : [];
  return (
    <>
      <PageHeader
        title={`${greeting}, ${firstName}`}
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
              <select
                className="select-button"
                aria-label="Cash flow date range"
                value={period}
                onChange={(event) => setPeriod(event.target.value as DashboardPeriod)}
              >
                <option value="this-month">This month</option>
                <option value="last-month">Last month</option>
                <option value="this-week">This week</option>
                <option value="last-7-days">Last 7 days</option>
                <option value="last-30-days">Last 30 days</option>
              </select>
            }
          />
          <div className="cashflow-total">
            <strong>{formatMoney(income - expenses)}</strong>
            <span className={netChange < 0 ? 'cashflow-change is-down' : 'cashflow-change'}>
              <ArrowUpRight size={14} /> {formatMoney(Math.abs(netChange))}{' '}
              {netChange < 0 ? 'less' : 'more'} than the previous period
            </span>
          </div>
          <CashFlowChart
            transactions={currentTransactions}
            start={range.start}
            end={range.end}
            onSelectDay={setSelectedDay}
          />
          {selectedDay && (
            <div className="chart-day-transactions">
              <div className="chart-day-transactions-heading">
                <strong>{new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(`${selectedDay}T12:00:00`))}</strong>
                <button className="icon-button" type="button" onClick={() => setSelectedDay(null)} aria-label="Close day transactions"><X size={15} /></button>
              </div>
              {selectedDayTransactions.length ? selectedDayTransactions.map((transaction) => (
                <button className="chart-transaction-link" type="button" key={transaction.id} onClick={() => onOpenTransaction(transaction)}>
                  <span>{transaction.merchant}</span><strong>{formatMoney(transaction.amount)}</strong>
                </button>
              )) : <p>No transactions were recorded on this day.</p>}
            </div>
          )}
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
        <FinanceHelper
          data={{ ...data, transactions: currentTransactions }}
          reconciliation={data.reconciliation}
          onNavigate={onNavigate}
          onOpenTransaction={onOpenTransaction}
        />
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
              <TransactionRow
                key={transaction.id}
                transaction={transaction}
                onOpen={() => onOpenTransaction(transaction)}
              />
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

type TransactionFilters = {
  account: string;
  kind: 'all' | TransactionKind;
  category: string;
  tagQuery: string;
  fromDate: string;
  toDate: string;
  minAmount: string;
  maxAmount: string;
  uncategorized: boolean;
  cleared: 'all' | 'cleared' | 'uncleared';
  reconciled: 'all' | 'reconciled' | 'unreconciled';
};

type SavedTransactionView = { id: string; name: string; filters: TransactionFilters };

const emptyTransactionFilters: TransactionFilters = {
  account: 'All accounts',
  kind: 'all',
  category: 'All categories',
  tagQuery: '',
  fromDate: '',
  toDate: '',
  minAmount: '',
  maxAmount: '',
  uncategorized: false,
  cleared: 'all',
  reconciled: 'all',
};

function TransactionsView({
  data,
  userId,
  onAddTransaction,
  onAddCheckpoint,
  onAddAccount,
  onEditTransaction,
  onDeleteTransaction,
  onOpenTransaction,
}: {
  data: BudgetData;
  userId: string;
  onAddTransaction: () => void;
  onAddCheckpoint: () => void;
  onAddAccount: () => void;
  onEditTransaction: (transaction: Transaction) => void;
  onDeleteTransaction: (transaction: Transaction) => void;
  onOpenTransaction: (transaction: Transaction) => void;
}) {
  const [filters, setFilters] = useState<TransactionFilters>(emptyTransactionFilters);
  const [sort, setSort] = useState<'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc'>('date-desc');
  const [page, setPage] = useState(1);
  const [addPopoverOpen, setAddPopoverOpen] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedTransactionView[]>([]);
  const [loadedViewsKey, setLoadedViewsKey] = useState('');
  const [savedViewsOpen, setSavedViewsOpen] = useState(false);
  const pageSize = 25;
  const savedViewsKey = `piggybudget:transaction-views:${userId}`;
  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem(savedViewsKey) ?? '[]');
      setSavedViews(Array.isArray(value) ? value : []);
    } catch {
      setSavedViews([]);
    }
    setLoadedViewsKey(savedViewsKey);
  }, [savedViewsKey]);
  useEffect(() => {
    if (loadedViewsKey === savedViewsKey) {
      localStorage.setItem(savedViewsKey, JSON.stringify(savedViews));
    }
  }, [loadedViewsKey, savedViews, savedViewsKey]);
  useEffect(() => setPage(1), [filters, sort]);
  const activeFilterCount =
    Number(filters.account !== 'All accounts') +
    Number(filters.kind !== 'all') +
    Number(filters.category !== 'All categories') +
    Number(Boolean(filters.tagQuery.trim())) +
    Number(Boolean(filters.fromDate)) +
    Number(Boolean(filters.toDate)) +
    Number(Boolean(filters.minAmount)) +
    Number(Boolean(filters.maxAmount)) +
    Number(filters.uncategorized) +
    Number(filters.cleared !== 'all') +
    Number(filters.reconciled !== 'all');
  const clearFilters = () => {
    setFilters(emptyTransactionFilters);
  };
  const filtered = useMemo(
    () => {
      const result = data.transactions.filter((transaction) => {
        const matchesAccount =
          filters.account === 'All accounts' || transaction.account === filters.account;
        const matchesKind = filters.kind === 'all' || transaction.kind === filters.kind;
        const matchesCategory = filters.uncategorized
          ? !transaction.category
          : filters.category === 'All categories' || transaction.category === filters.category;
        const matchesTag =
          !filters.tagQuery ||
          (transaction.tags ?? []).some((tag) =>
            tag.toLowerCase().includes(filters.tagQuery.toLowerCase()),
          );
        const matchesDate =
          (!filters.fromDate || transaction.date >= filters.fromDate) &&
          (!filters.toDate || transaction.date <= filters.toDate);
        const matchesAmount =
          (!filters.minAmount || transaction.amount >= Number(filters.minAmount)) &&
          (!filters.maxAmount || transaction.amount <= Number(filters.maxAmount));
        const matchesCleared =
          filters.cleared === 'all' ||
          Boolean(transaction.cleared) === (filters.cleared === 'cleared');
        const matchesReconciled =
          filters.reconciled === 'all' ||
          Boolean(transaction.reconciled) === (filters.reconciled === 'reconciled');
        return (
          matchesAccount &&
          matchesKind &&
          matchesCategory &&
          matchesTag &&
          matchesDate &&
          matchesAmount &&
          matchesCleared &&
          matchesReconciled
        );
      });
      return result.sort((a, b) => {
        if (sort === 'date-asc') return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
        if (sort === 'amount-desc') return b.amount - a.amount || b.date.localeCompare(a.date);
        if (sort === 'amount-asc') return a.amount - b.amount || b.date.localeCompare(a.date);
        return b.date.localeCompare(a.date) || b.id.localeCompare(a.id);
      });
    },
    [data.transactions, filters, sort],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);
  const saveView = () => {
    const name = window.prompt('Name this saved view');
    if (!name?.trim()) return;
    setSavedViews((current) => [
      ...current,
      { id: crypto.randomUUID(), name: name.trim(), filters: { ...filters } },
    ]);
  };
  const renameView = (view: SavedTransactionView) => {
    const name = window.prompt('Rename saved view', view.name);
    if (!name?.trim()) return;
    setSavedViews((current) =>
      current.map((item) => (item.id === view.id ? { ...item, name: name.trim() } : item)),
    );
  };
  return (
    <>
      <PageHeader title="Transactions" />
      <MoneyLentPanel transactions={data.transactions} />
      <section className="transactions-section">
        <div className="transaction-toolbar">
          <div className="transaction-toolbar-actions">
            <label className="transaction-sort-control">
              Sort
              <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                <option value="date-desc">Newest date</option>
                <option value="date-asc">Oldest date</option>
                <option value="amount-desc">Highest amount</option>
                <option value="amount-asc">Lowest amount</option>
              </select>
            </label>
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
                  <select
                    value={filters.account}
                    onChange={(event) => setFilters({ ...filters, account: event.target.value })}
                  >
                    <option>All accounts</option>
                    {data.accounts.map((item) => (
                      <option key={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
                <div className="transaction-filter-field">
                  <span>Type</span>
                  <div className="filter-group" role="group" aria-label="Transaction type">
                    {(['all', 'expense', 'income', 'transfer', 'adjustment'] as const).map(
                      (option) => (
                        <button
                          key={option}
                          className={filters.kind === option ? 'is-active' : ''}
                          type="button"
                          onClick={() => setFilters({ ...filters, kind: option })}
                        >
                          {option === 'all'
                            ? 'All'
                            : option === 'expense'
                              ? 'Expenses'
                              : option === 'income'
                                ? 'Income'
                                : option === 'transfer'
                                  ? 'Transfers'
                                  : 'Adjustments'}
                        </button>
                      ),
                    )}
                  </div>
                </div>
                <label className="transaction-filter-field">
                  Category
                  <select
                    value={filters.category}
                    disabled={filters.uncategorized}
                    onChange={(event) => setFilters({ ...filters, category: event.target.value })}
                  >
                    <option>All categories</option>
                    {[...new Set(data.transactions.map((item) => item.category))]
                      .sort()
                      .filter(Boolean)
                      .map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                  </select>
                </label>
                <label className="transaction-filter-checkbox">
                  <input
                    type="checkbox"
                    checked={filters.uncategorized}
                    onChange={(event) =>
                      setFilters({ ...filters, uncategorized: event.target.checked })
                    }
                  />
                  Uncategorized only
                </label>
                <label className="transaction-filter-field">
                  Tag
                  <input
                    value={filters.tagQuery}
                    onChange={(event) => setFilters({ ...filters, tagQuery: event.target.value })}
                    placeholder="Filter by tag"
                  />
                </label>
                <div className="transaction-date-filters">
                  <label className="transaction-filter-field">
                    From
                    <input
                      type="date"
                      value={filters.fromDate}
                      onChange={(event) =>
                        setFilters({ ...filters, fromDate: event.target.value })
                      }
                      aria-label="From date"
                    />
                  </label>
                  <label className="transaction-filter-field">
                    To
                    <input
                      type="date"
                      value={filters.toDate}
                      onChange={(event) =>
                        setFilters({ ...filters, toDate: event.target.value })
                      }
                      aria-label="To date"
                    />
                  </label>
                </div>
                <div className="transaction-date-filters">
                  <label className="transaction-filter-field">
                    Min amount
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={filters.minAmount}
                      onChange={(event) =>
                        setFilters({ ...filters, minAmount: event.target.value })
                      }
                    />
                  </label>
                  <label className="transaction-filter-field">
                    Max amount
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={filters.maxAmount}
                      onChange={(event) =>
                        setFilters({ ...filters, maxAmount: event.target.value })
                      }
                    />
                  </label>
                </div>
                <label className="transaction-filter-field">
                  Cleared
                  <select
                    value={filters.cleared}
                    onChange={(event) =>
                      setFilters({
                        ...filters,
                        cleared: event.target.value as TransactionFilters['cleared'],
                      })
                    }
                  >
                    <option value="all">All</option>
                    <option value="cleared">Cleared</option>
                    <option value="uncleared">Uncleared</option>
                  </select>
                </label>
                <label className="transaction-filter-field">
                  Reconciliation
                  <select
                    value={filters.reconciled}
                    onChange={(event) =>
                      setFilters({
                        ...filters,
                        reconciled: event.target.value as TransactionFilters['reconciled'],
                      })
                    }
                  >
                    <option value="all">All</option>
                    <option value="reconciled">Reconciled</option>
                    <option value="unreconciled">Unreconciled</option>
                  </select>
                </label>
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
            pageItems.map((transaction) => (
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
          <span>
            {filtered.length
              ? `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filtered.length)}`
              : 'Showing 0'} of {filtered.length} filtered transactions · {data.transactions.length} total
          </span>
          <div className="transaction-footer-actions">
            <button
              className="button button-quiet pagination-button"
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              Previous
            </button>
            <span>Page {page} of {pageCount}</span>
            <button
              className="button button-quiet pagination-button"
              type="button"
              disabled={page >= pageCount}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </button>
            <Popover open={savedViewsOpen} onOpenChange={setSavedViewsOpen}>
              <PopoverTrigger asChild>
                <button className="text-button" type="button">
                  <Filter size={14} /> Saved views {savedViews.length ? `(${savedViews.length})` : ''}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="saved-views-popover">
                <div className="transaction-filter-heading">
                  <strong>Saved views</strong>
                  <button className="text-button" type="button" onClick={saveView}>Save current</button>
                </div>
                {savedViews.length ? (
                  savedViews.map((view) => (
                    <div className="saved-view-row" key={view.id}>
                      <button
                        className="saved-view-apply"
                        type="button"
                        onClick={() => {
                          setFilters(view.filters);
                          setSavedViewsOpen(false);
                        }}
                      >
                        {view.name}
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Rename ${view.name}`}
                        onClick={() => renameView(view)}
                      >
                        Rename
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Delete ${view.name}`}
                        onClick={() => {
                          if (window.confirm(`Delete saved view “${view.name}”?`)) {
                            setSavedViews((items) => items.filter((item) => item.id !== view.id));
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="page-description">Save your filters to reuse them here.</p>
                )}
              </PopoverContent>
            </Popover>
          </div>
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

function GoalsView({ data, onRefresh }: { data: BudgetData; onRefresh: () => void }) {
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [composerGoal, setComposerGoal] = useState<Goal | null | undefined>(undefined);
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
  const goals = data.goals.filter((goal) => !goal.archived);
  const saveGoal = async (goal: Goal | null, values: GoalFormValues) => {
    const response = await apiFetch(`/api/finance/goals${goal ? `/${goal.id}` : ''}`, {
      method: goal ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${pb.authStore.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: values.name,
        target_amount: Number(values.target),
        current_amount: Number(values.current),
        target_date: values.deadline,
        notes: values.notes,
        status: values.status,
        completed: values.status === 'completed',
      }),
    });
    if (!response.ok) throw new Error((await response.text()) || 'Could not save this goal.');
    setComposerGoal(undefined);
    setSelectedGoal(null);
    onRefresh();
  };
  const updateGoal = async (goal: Goal, values: Record<string, unknown>, action: string) => {
    const response = await apiFetch(`/api/finance/goals/${goal.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${pb.authStore.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(values),
    });
    if (!response.ok) {
      window.alert((await response.text()) || `Could not ${action} ${goal.name}.`);
      return false;
    }
    setSelectedGoal(null);
    onRefresh();
    return true;
  };
  const deleteGoal = async (goal: Goal) => {
    if (!window.confirm(`Delete ${goal.name}? This cannot be undone.`)) return;
    const response = await apiFetch(`/api/finance/goals/${goal.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${pb.authStore.token}` },
    });
    if (!response.ok) {
      window.alert((await response.text()) || `Could not delete ${goal.name}.`);
      return;
    }
    setSelectedGoal(null);
    onRefresh();
  };
  const orderedGoals = [...data.goals].sort((a, b) => {
    if (a.status === 'completed' && b.status !== 'completed') return 1;
    if (b.status === 'completed' && a.status !== 'completed') return -1;
    if (!a.deadline || a.deadline === 'No deadline') return 1;
    if (!b.deadline || b.deadline === 'No deadline') return -1;
    return a.deadline.localeCompare(b.deadline);
  });
  return (
    <>
      <PageHeader
        title="Goals"
        description="Small, steady progress adds up to a life you choose."
        action={
          <button
            className="button button-primary"
            type="button"
            onClick={() => setComposerGoal(null)}
          >
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
              {formatMoney(goals.reduce((sum, goal) => sum + goal.current, 0))} saved toward
              your goals
            </strong>
            <p>You are making good progress. Keep the momentum going.</p>
          </div>
        </div>
        <button
          className="button button-quiet"
          type="button"
          onClick={() => setTimelineOpen((open) => !open)}
          aria-expanded={timelineOpen}
        >
          <CalendarDays size={15} /> View timeline
        </button>
      </section>
      {timelineOpen && (
        <section className="panel goal-timeline" aria-label="Goal timeline">
          <SectionHeading title="Goal timeline" />
          {orderedGoals.length ? (
            orderedGoals.map((goal) => {
              const overdue =
                goal.deadline !== 'No deadline' &&
                goal.deadline < new Date().toISOString().slice(0, 10) &&
                goal.status !== 'completed';
              const state = goal.archived
                ? 'Archived'
                : goal.status === 'paused'
                  ? 'Paused'
                  : goal.status === 'completed'
                    ? 'Completed'
                    : overdue
                      ? 'Overdue'
                      : 'Upcoming';
              return (
                <button
                  className="goal-timeline-row"
                  type="button"
                  key={goal.id}
                  onClick={() => setSelectedGoal(goal)}
                >
                  <span className="goal-timeline-mark" style={{ background: goal.color }} />
                  <strong>{goal.name}</strong>
                  <span>
                    {state}
                    {goal.deadline !== 'No deadline' ? ` · ${goal.deadline}` : ''}
                  </span>
                  <ArrowRight size={14} />
                </button>
              );
            })
          ) : (
            <p className="page-description">Create a goal to see it on your timeline.</p>
          )}
        </section>
      )}
      <div className="goal-grid">
        {goals.map((goal) => (
          <GoalCard key={goal.id} goal={goal} onOpen={() => setSelectedGoal(goal)} />
        ))}
        <button className="goal-add-card" type="button" onClick={() => setComposerGoal(null)}>
          <span>
            <Plus size={20} />
          </span>
          <strong>Start a new goal</strong>
          <small>Trips, projects, or peace of mind</small>
        </button>
      </div>
      {composerGoal !== undefined && (
        <GoalComposer goal={composerGoal} onClose={() => setComposerGoal(undefined)} onSave={saveGoal} />
      )}
      {selectedGoal && (
        <GoalDetails
          goal={selectedGoal}
          onClose={() => setSelectedGoal(null)}
          onEdit={() => setComposerGoal(selectedGoal)}
          onDelete={() => void deleteGoal(selectedGoal)}
          onArchive={() =>
            void updateGoal(
              selectedGoal,
              { archived: !selectedGoal.archived },
              selectedGoal.archived ? 'restore' : 'archive',
            )
          }
          onPause={() =>
            void updateGoal(
              selectedGoal,
              { status: selectedGoal.status === 'paused' ? 'active' : 'paused' },
              'update',
            )
          }
        />
      )}
    </>
  );
}

function GoalCard({ goal, onOpen }: { goal: Goal; onOpen: () => void }) {
  const progress = goal.target ? (goal.current / goal.target) * 100 : 0;
  return (
    <article className="goal-card">
      <div className="goal-card-top">
        <span className="goal-mark" style={{ background: goal.color }}>
          <Target size={17} />
        </span>
        <button
          className="icon-button"
          aria-label={`Open goal actions for ${goal.name}`}
          type="button"
          onClick={onOpen}
        >
          <MoreHorizontal size={17} />
        </button>
      </div>
      <h3>
        <button className="goal-name-button" type="button" onClick={onOpen}>
          {goal.name}
        </button>
      </h3>
      <div className="goal-amount">
        <strong>{formatMoney(goal.current)}</strong>
        <span>of {formatMoney(goal.target)}</span>
      </div>
      <ProgressBar value={progress} color={goal.color} />
      <div className="goal-card-footer">
        <span>{Math.round(progress)}% complete</span>
        <span>
          {goal.status === 'paused'
            ? 'Paused'
            : goal.deadline === 'No deadline'
              ? 'No target date'
              : `Target ${goal.deadline}`}
        </span>
      </div>
      {progress >= 50 && (
        <div className="goal-note">
          <CheckCircle2 size={14} /> Nice work — halfway there
        </div>
      )}
    </article>
  );
}

type GoalFormValues = {
  name: string;
  current: string;
  target: string;
  deadline: string;
  notes: string;
  status: 'active' | 'paused' | 'completed';
};

function GoalComposer({
  goal,
  onClose,
  onSave,
}: {
  goal: Goal | null;
  onClose: () => void;
  onSave: (goal: Goal | null, values: GoalFormValues) => Promise<void>;
}) {
  const [name, setName] = useState(goal?.name ?? '');
  const [current, setCurrent] = useState(String(goal?.current ?? 0));
  const [target, setTarget] = useState(String(goal?.target ?? ''));
  const [deadline, setDeadline] = useState(goal?.deadline === 'No deadline' ? '' : goal?.deadline ?? '');
  const [notes, setNotes] = useState(goal?.notes ?? '');
  const [status, setStatus] = useState<GoalFormValues['status']>(goal?.status ?? 'active');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave(goal, {
        name: name.trim(),
        current,
        target,
        deadline,
        notes: notes.trim(),
        status,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this goal.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="composer-overlay">
      <button className="composer-backdrop" type="button" onClick={onClose} aria-label="Close" />
      <form
        className="composer-card goal-composer"
        onSubmit={(event) => void submit(event)}
        role="dialog"
        aria-modal="true"
        aria-labelledby="goal-composer-title"
      >
        <div className="composer-heading">
          <div>
            <h2 id="goal-composer-title">{goal ? 'Edit goal' : 'Create a goal'}</h2>
            <span>Track a target and when you hope to reach it.</span>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <label>
          Goal name
          <input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="form-grid">
          <label>
            Saved so far
            <input
              required
              type="number"
              min="0"
              step="0.01"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </label>
          <label>
            Target amount
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            />
          </label>
        </div>
        <label>
          Target date
          <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
        </label>
        {goal && (
          <label>
            Status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as GoalFormValues['status'])}
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
            </select>
          </label>
        )}
        <label>
          Notes
          <textarea rows={3} maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="composer-actions">
          <button className="button" type="button" onClick={onClose}>Cancel</button>
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save goal'}
          </button>
        </div>
      </form>
    </div>
  );
}

function GoalDetails({
  goal,
  onClose,
  onEdit,
  onDelete,
  onArchive,
  onPause,
}: {
  goal: Goal;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onPause: () => void;
}) {
  const progress = goal.target > 0 ? Math.min(100, Math.max(0, goal.current / goal.target * 100)) : 0;
  const overdue = goal.deadline !== 'No deadline' && goal.deadline < new Date().toISOString().slice(0, 10) && goal.status !== 'completed';
  return (
    <div className="composer-overlay">
      <button className="composer-backdrop" type="button" onClick={onClose} aria-label="Close" />
      <section
        className="composer-card goal-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="goal-detail-title"
      >
        <div className="composer-heading">
          <div>
            <h2 id="goal-detail-title">{goal.name}</h2>
            <span>
              {goal.archived
                ? 'Archived'
                : overdue
                  ? 'Overdue'
                  : goal.status === 'paused'
                    ? 'Paused'
                    : goal.status === 'completed'
                      ? 'Completed'
                      : goal.deadline === 'No deadline'
                        ? 'No target date'
                        : `Target ${goal.deadline}`}
            </span>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="goal-detail-total">
          <strong>{formatMoney(goal.current)}</strong>
          <span> saved of {formatMoney(goal.target)}</span>
        </div>
        <ProgressBar value={progress} color={goal.color} />
        <p className="page-description">
          Progress is saved amount ÷ target amount, capped at 100%.{' '}
          {Math.max(0, goal.target - goal.current) > 0
            ? `${formatMoney(Math.max(0, goal.target - goal.current))} left to reach your target.`
            : 'You have reached this target.'}
        </p>
        {goal.notes && <p className="goal-detail-notes">{goal.notes}</p>}
        <div className="goal-detail-actions">
          <button className="button button-primary" type="button" onClick={onEdit}>Edit goal</button>
          {!goal.archived && (
            <button className="button" type="button" onClick={onPause}>
              {goal.status === 'paused' ? 'Resume' : 'Pause'}
            </button>
          )}
          <button className="button" type="button" onClick={onArchive}>
            {goal.archived ? 'Restore' : 'Archive'}
          </button>
          <button className="button button-danger" type="button" onClick={onDelete}>Delete</button>
        </div>
      </section>
    </div>
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
  recordTarget,
  onRecordTargetHandled,
}: Props) {
  const [settingsMessage, setSettingsMessage] = useState('');
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [accountManagerOpen, setAccountManagerOpen] = useState(false);
  const [preferredAccountId, setPreferredAccountId] = useState<string | null>(null);
  const [composer, setComposer] = useState<
    'account' | 'transaction' | 'checkpoint' | 'asset' | 'budget' | null
  >(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [viewingTransaction, setViewingTransaction] = useState<Transaction | null>(null);
  const [recordDetailsTarget, setRecordDetailsTarget] = useState<FinanceRecordTarget | null>(null);
  useEffect(() => {
    if (!userId || !remote || data.accounts.length > 0) return;
    if (localStorage.getItem(onboardingStorageKey(userId)) !== 'complete') {
      setOnboardingOpen(true);
    }
  }, [data.accounts.length, remote, userId]);
  useEffect(() => {
    if (!recordTarget || loading) return;
    if (recordTarget.type === 'transaction') {
      const transaction = data.transactions.find((item) => item.id === recordTarget.id);
      if (transaction) setViewingTransaction(transaction);
      else setRecordDetailsTarget(recordTarget);
    } else {
      setRecordDetailsTarget(recordTarget);
    }
    onRecordTargetHandled();
  }, [data, loading, onRecordTargetHandled, recordTarget]);
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
    setPreferredAccountId(null);
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
        profile={profile}
        onNavigate={onNavigate}
        onAddTransaction={() => setComposer('transaction')}
        onOpenTransaction={setViewingTransaction}
      />
    ) : view === 'transactions' ? (
      <TransactionsView
        data={data}
        userId={userId}
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
      <GoalsView data={data} onRefresh={onRefresh} />
    ) : (
      <SettingsView
        userId={userId}
        data={data}
        remote={remote}
        onRefresh={onRefresh}
        onStartOnboarding={() => setOnboardingOpen(true)}
        onMessage={setSettingsMessage}
        settingsMessage={settingsMessage}
        profile={profile}
        onManageAccounts={() => setAccountManagerOpen(true)}
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
          preferredAccountId={preferredAccountId}
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
      {recordDetailsTarget && (
        <FinanceRecordDetails
          target={recordDetailsTarget}
          data={data}
          onClose={() => setRecordDetailsTarget(null)}
          onOpenTransaction={(transaction) => {
            setRecordDetailsTarget(null);
            setViewingTransaction(transaction);
          }}
        />
      )}
      {accountManagerOpen && (
        <AccountsSettingsDialog
          accounts={data.accounts}
          remote={remote}
          onClose={() => setAccountManagerOpen(false)}
          onRefresh={onRefresh}
          onAddAccount={() => {
            setAccountManagerOpen(false);
            setComposer('account');
          }}
          onRecordCheckpoint={(accountId) => {
            setAccountManagerOpen(false);
            setPreferredAccountId(accountId);
            setComposer('checkpoint');
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
  userId,
  data,
  remote,
  onRefresh,
  onStartOnboarding,
  onMessage,
  settingsMessage,
  profile,
  onManageAccounts,
}: {
  userId: string;
  data: BudgetData;
  remote: boolean;
  onRefresh: () => void;
  onStartOnboarding: () => void;
  onMessage: (message: string) => void;
  settingsMessage: string;
  profile: UserProfile;
  onManageAccounts: () => void;
}) {
  const { setTheme } = useTheme();
  const [profileOpen, setProfileOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferences, setPreferences] = useState(() => readPreferences(userId));
  useEffect(() => setPreferences(readPreferences(userId)), [userId]);
  const savePreferences = (next: UserPreferences) => {
    localStorage.setItem(preferencesKey(userId), JSON.stringify(next));
    setPreferences(next);
    setTheme(next.theme);
    window.dispatchEvent(new CustomEvent('piggybudget:preferences', { detail: next }));
    setPreferencesOpen(false);
    onMessage('Preferences saved.');
  };
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
              onClick={() => setProfileOpen(true)}
            >
              Edit profile <ArrowRight size={14} />
            </button>
          </div>
        </article>
        <article className="panel settings-card">
          <div className="small-panel-icon">
            <Landmark size={17} />
          </div>
          <div>
            <h3>Accounts</h3>
            <p>
              {data.accounts.length} account{data.accounts.length === 1 ? '' : 's'} ·{' '}
              {formatMoney(
                data.accounts
                  .filter((account) => !account.archived)
                  .reduce((sum, account) => sum + account.balance, 0),
              )}{' '}
              total balance
            </p>
            <button className="text-button" type="button" onClick={onManageAccounts}>
              Manage accounts <ArrowRight size={14} />
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
              Currency · {preferences.currency}
              <br />
              Week starts on {preferences.weekStart === 'monday' ? 'Monday' : 'Sunday'}
              <br />
              Date and number format · {preferences.dateFormat} / {preferences.numberFormat}
              <br />
              Notifications · {preferences.notifications ? 'On' : 'Off'}
            </p>
            <button
              className="text-button"
              type="button"
              onClick={() => setPreferencesOpen(true)}
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
      {profileOpen && (
        <ProfileSettingsDialog
          userId={userId}
          profile={profile}
          onClose={() => setProfileOpen(false)}
          onSaved={(message) => {
            setProfileOpen(false);
            onMessage(message);
          }}
        />
      )}
      {preferencesOpen && (
        <PreferencesDialog
          preferences={preferences}
          onClose={() => setPreferencesOpen(false)}
          onSave={savePreferences}
        />
      )}
    </>
  );
}

function FinanceRecordDetails({
  target,
  data,
  onClose,
  onOpenTransaction,
}: {
  target: FinanceRecordTarget;
  data: BudgetData;
  onClose: () => void;
  onOpenTransaction: (transaction: Transaction) => void;
}) {
  const transaction =
    target.type === 'transaction'
      ? data.transactions.find((item) => item.id === target.id)
      : undefined;
  const account =
    target.type === 'account' ? data.accounts.find((item) => item.id === target.id) : undefined;
  const budget =
    target.type === 'budget' ? data.budgets.find((item) => item.id === target.id) : undefined;
  const asset = target.type === 'asset' ? data.assets.find((item) => item.id === target.id) : undefined;
  const goal = target.type === 'goal' ? data.goals.find((item) => item.id === target.id) : undefined;
  const relatedTransactions = transaction
    ? [transaction]
    : account
      ? data.transactions.filter((item) => item.accountId === account.id)
      : budget
        ? data.transactions.filter((item) => item.budgetId === budget.id)
        : asset?.purchaseTransaction
          ? data.transactions.filter((item) => item.id === asset.purchaseTransaction)
          : [];
  const title =
    transaction?.merchant ??
    account?.name ??
    budget?.category ??
    asset?.name ??
    goal?.name ??
    'Record not available';
  const recordType = `${target.type[0].toUpperCase()}${target.type.slice(1)}`;

  return (
    <div className="composer-overlay">
      <button className="composer-backdrop" type="button" onClick={onClose} aria-label="Close" />
      <section
        className="composer-card record-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="search-record-title"
      >
        <div className="composer-heading">
          <div>
            <h2 id="search-record-title">{title}</h2>
            <span>{recordType} details</span>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {transaction && (
          <dl className="transaction-detail-list">
            <DetailRow label="Date" value={formatDate(transaction.date)} />
            <DetailRow label="Amount" value={formatMoney(transaction.amount)} />
            <DetailRow label="Account" value={transaction.account} />
            <DetailRow label="Category" value={transaction.category || 'Uncategorized'} />
            {transaction.note && <DetailRow label="Note" value={transaction.note} />}
          </dl>
        )}
        {account && (
          <dl className="transaction-detail-list">
            <DetailRow label="Type" value={account.type} />
            <DetailRow label="Balance" value={formatMoney(account.balance)} />
            <DetailRow label="Currency" value={account.currency ?? 'USD'} />
            <DetailRow label="Default account" value={account.isDefault ? 'Yes' : 'No'} />
            <DetailRow label="Status" value={account.archived ? 'Archived' : 'Active'} />
          </dl>
        )}
        {budget && (
          <dl className="transaction-detail-list">
            <DetailRow label="Category" value={budget.category} />
            <DetailRow label="Spent" value={formatMoney(budget.spent)} />
            <DetailRow label="Limit" value={formatMoney(budget.limit)} />
            <DetailRow label="Remaining" value={formatMoney(budget.limit - budget.spent)} />
          </dl>
        )}
        {asset && (
          <dl className="transaction-detail-list">
            <DetailRow label="Type" value={asset.type} />
            <DetailRow label="Current value" value={formatMoney(asset.value)} />
            <DetailRow label="Purchase cost" value={formatMoney(asset.cost)} />
            <DetailRow label="Change" value={formatMoney(asset.value - asset.cost)} />
            <DetailRow
              label="Purchase date"
              value={asset.purchaseDate ? formatDate(asset.purchaseDate) : 'Not recorded'}
            />
          </dl>
        )}
        {goal && (
          <>
            <div className="goal-detail-total">
              <strong>{formatMoney(goal.current)}</strong>
              <span> saved of {formatMoney(goal.target)}</span>
            </div>
            <ProgressBar
              value={goal.target > 0 ? (goal.current / goal.target) * 100 : 0}
              color={goal.color}
            />
            <p className="page-description">
              Progress is saved amount divided by target amount. Target date: {goal.deadline}.
            </p>
            {goal.notes && <p className="goal-detail-notes">{goal.notes}</p>}
          </>
        )}
        {relatedTransactions.length > 0 && (
          <div className="record-related-transactions">
            <strong>{transaction ? 'Transaction' : 'Related transactions'}</strong>
            {relatedTransactions.slice(0, 8).map((item) => (
              <button
                className="chart-transaction-link"
                type="button"
                key={item.id}
                onClick={() => onOpenTransaction(item)}
              >
                <span>{item.merchant} · {formatDate(item.date)}</span>
                <strong>{formatMoney(item.amount)}</strong>
              </button>
            ))}
          </div>
        )}
        {!transaction && !account && !budget && !asset && !goal && (
          <div className="empty-state">
            <Search size={20} />
            <strong>This record is no longer loaded.</strong>
            <span>Refresh the page and try the search again.</span>
          </div>
        )}
        <div className="composer-actions">
          <button className="button button-primary" type="button" onClick={onClose}>
            Close details
          </button>
        </div>
      </section>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function AccountsSettingsDialog({
  accounts,
  remote,
  onClose,
  onRefresh,
  onAddAccount,
  onRecordCheckpoint,
}: {
  accounts: Account[];
  remote: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onAddAccount: () => void;
  onRecordCheckpoint: (accountId: string) => void;
}) {
  const [editing, setEditing] = useState<Account | null>(null);
  const [error, setError] = useState('');

  const patchAccount = async (account: Account, values: Record<string, unknown>) => {
    if (values.is_default === true) {
      for (const current of accounts) {
        if (!current.isDefault || current.id === account.id) continue;
        const unset = await apiFetch(`/api/finance/accounts/${current.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_default: false }),
        });
        if (!unset.ok) throw new Error((await unset.text()) || 'Could not update the default account.');
      }
    }
    const response = await apiFetch(`/api/finance/accounts/${account.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!response.ok) throw new Error((await response.text()) || `Could not update ${account.name}.`);
    onRefresh();
  };

  const runAccountAction = async (account: Account, values: Record<string, unknown>) => {
    setError('');
    try {
      await patchAccount(account, values);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not update ${account.name}.`);
    }
  };

  return (
    <div className="composer-overlay">
      <button className="composer-backdrop" type="button" onClick={onClose} aria-label="Close" />
      <section className="composer-card account-manager" role="dialog" aria-modal="true" aria-labelledby="accounts-settings-title">
        <div className="composer-heading">
          <div><h2 id="accounts-settings-title">Accounts</h2><span>Manage account details, defaults, balances, and checkpoints.</span></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {!remote && <p className="page-description">Saved accounts are unavailable. Refresh after your connection returns to manage them.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="account-manager-list">
          {accounts.length ? accounts.map((account) => (
            <article className={`account-manager-row ${account.archived ? 'is-archived' : ''}`} key={account.id}>
              <div className="account-manager-copy">
                <strong>{account.name}{account.isDefault ? ' · Default' : ''}</strong>
                <span>{account.type} · {account.currency ?? 'USD'}{account.archived ? ' · Archived' : ''}</span>
                <b>{formatMoney(account.balance)}</b>
              </div>
              <div className="account-manager-actions">
                <button className="text-button" type="button" disabled={!remote} onClick={() => setEditing(account)}>Edit</button>
                {!account.isDefault && !account.archived && <button className="text-button" type="button" disabled={!remote} onClick={() => void runAccountAction(account, { is_default: true })}>Set default</button>}
                <button className="text-button" type="button" disabled={!remote} onClick={() => void runAccountAction(account, { archived: !account.archived, ...(account.isDefault ? { is_default: false } : {}) })}>{account.archived ? 'Restore' : 'Archive'}</button>
                {!account.archived && <button className="text-button" type="button" disabled={!remote} onClick={() => onRecordCheckpoint(account.id)}>Checkpoint</button>}
              </div>
            </article>
          )) : <p className="page-description">Add an account to track its balance and reconcile statements.</p>}
        </div>
        <div className="composer-actions">
          <button className="button" type="button" onClick={onClose}>Close</button>
          <button className="button button-primary" type="button" onClick={onAddAccount} disabled={!remote}>Add account</button>
        </div>
      </section>
      {editing && (
        <AccountEditor
          account={editing}
          onClose={() => setEditing(null)}
          onSave={async (values) => {
            await patchAccount(editing, values);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function AccountEditor({
  account,
  onClose,
  onSave,
}: {
  account: Account;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(account.name);
  const normalizedType = account.type.toLowerCase();
  const [type, setType] = useState(
    normalizedType.includes('credit')
      ? 'credit'
      : ['cash', 'savings', 'checking'].includes(normalizedType)
        ? normalizedType
        : 'other',
  );
  const [currency, setCurrency] = useState(account.currency ?? 'USD');
  const [openingBalance, setOpeningBalance] = useState(String(account.openingBalance ?? 0));
  const [notes, setNotes] = useState(account.notes ?? '');
  const [isDefault, setIsDefault] = useState(Boolean(account.isDefault && !account.archived));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave({
        name: name.trim(),
        type,
        currency: currency.trim().toUpperCase(),
        opening_balance: Number(openingBalance),
        notes: notes.trim(),
        is_default: !account.archived && isDefault,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not update ${account.name}.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="composer-overlay account-editor-overlay">
      <button className="composer-backdrop" type="button" onClick={onClose} aria-label="Close" />
      <form
        className="composer-card"
        onSubmit={(event) => void submit(event)}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-editor-title"
      >
        <div className="composer-heading">
          <div>
            <h2 id="account-editor-title">Edit account</h2>
            <span>Update its name, starting balance, or status.</span>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <label>
          Account name
          <input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
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
            minLength={3}
            pattern="[A-Za-z]{3}"
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
        </label>
        <label>
          Opening balance
          <input
            required
            type="number"
            step="0.01"
            value={openingBalance}
            onChange={(event) => setOpeningBalance(event.target.value)}
          />
        </label>
        <label>
          Notes
          <textarea rows={3} maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <label className="transaction-filter-checkbox">
          <input
            type="checkbox"
            checked={isDefault}
            disabled={account.archived}
            onChange={(event) => setIsDefault(event.target.checked)}
          />
          Default account
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="composer-actions"><button className="button" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save account'}</button></div>
      </form>
    </div>
  );
}

function ProfileSettingsDialog({
  userId,
  profile,
  onClose,
  onSaved,
}: {
  userId: string;
  profile: UserProfile;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(profile.name === 'Your profile' ? '' : profile.name);
  const [email, setEmail] = useState(profile.email);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requiresCurrentPassword = email.trim() !== profile.email || Boolean(newPassword);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword && newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    const updates: Record<string, string> = { display_name: name.trim() };
    if (email.trim() !== profile.email) updates.email = email.trim();
    if (requiresCurrentPassword) updates.oldPassword = currentPassword;
    if (newPassword) {
      updates.password = newPassword;
      updates.passwordConfirm = confirmPassword;
    }
    try {
      const record = await pb.collection('users').update(userId, updates);
      pb.authStore.save(pb.authStore.token, record as RecordModel);
      const message = email.trim() !== profile.email
        ? 'Profile saved. Check your email to confirm the address change.'
        : newPassword
          ? 'Profile and password saved.'
          : 'Profile saved.';
      onSaved(message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update your profile.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer-overlay">
      <button className="composer-backdrop" type="button" onClick={onClose} aria-label="Close" />
      <form
        className="composer-card"
        onSubmit={(event) => void save(event)}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-settings-title"
      >
        <div className="composer-heading">
          <div>
            <h2 id="profile-settings-title">Profile and security</h2>
            <span>Update your name, email, or password.</span>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <label>
          Display name
          <input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Email
          <input
            required
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        {requiresCurrentPassword && (
          <label>
            Current password
            <input
              required
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
        )}
        <label>
          New password <small>Leave blank to keep your current password.</small>
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </label>
        {newPassword && (
          <label>
            Confirm new password
            <input
              required
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="composer-actions">
          <button className="button" type="button" onClick={onClose}>Cancel</button>
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

function PreferencesDialog({
  preferences,
  onClose,
  onSave,
}: {
  preferences: UserPreferences;
  onClose: () => void;
  onSave: (preferences: UserPreferences) => void;
}) {
  const [draft, setDraft] = useState(preferences);
  return (
    <div className="composer-overlay">
      <button className="composer-backdrop" type="button" onClick={onClose} aria-label="Close" />
      <section
        className="composer-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preferences-title"
      >
        <div className="composer-heading">
          <div>
            <h2 id="preferences-title">Preferences</h2>
            <span>These choices are saved in this browser for your account.</span>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <label>
          Currency
          <select
            value={draft.currency}
            onChange={(event) => setDraft({ ...draft, currency: event.target.value })}
          >
            <option value="USD">USD · US dollar</option>
            <option value="EUR">EUR · Euro</option>
            <option value="GBP">GBP · Pound sterling</option>
            <option value="CAD">CAD · Canadian dollar</option>
            <option value="AUD">AUD · Australian dollar</option>
            <option value="JPY">JPY · Japanese yen</option>
          </select>
        </label>
        <label>
          Week starts on
          <select
            value={draft.weekStart}
            onChange={(event) =>
              setDraft({ ...draft, weekStart: event.target.value as UserPreferences['weekStart'] })
            }
          >
            <option value="monday">Monday</option>
            <option value="sunday">Sunday</option>
          </select>
        </label>
        <label>
          Date format
          <select
            value={draft.dateFormat}
            onChange={(event) =>
              setDraft({ ...draft, dateFormat: event.target.value as UserPreferences['dateFormat'] })
            }
          >
            <option value="locale">Local format</option>
            <option value="day-first">Day first</option>
            <option value="iso">YYYY-MM-DD</option>
          </select>
        </label>
        <label>
          Number format
          <select
            value={draft.numberFormat}
            onChange={(event) =>
              setDraft({ ...draft, numberFormat: event.target.value as UserPreferences['numberFormat'] })
            }
          >
            <option value="locale">Use browser locale</option>
            <option value="en-US">1,234.56</option>
            <option value="de-DE">1.234,56</option>
          </select>
        </label>
        <label>
          Theme
          <select
            value={draft.theme}
            onChange={(event) =>
              setDraft({ ...draft, theme: event.target.value as UserPreferences['theme'] })
            }
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className="transaction-filter-checkbox">
          <input
            type="checkbox"
            checked={draft.notifications}
            onChange={(event) => setDraft({ ...draft, notifications: event.target.checked })}
          />
          Show finance notifications
        </label>
        <div className="composer-actions">
          <button className="button" type="button" onClick={onClose}>Cancel</button>
          <button className="button button-primary" type="button" onClick={() => onSave(draft)}>
            Save preferences
          </button>
        </div>
      </section>
    </div>
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
  const defaultAccount =
    accounts.find((account) => account.isDefault && !account.archived) ??
    accounts.find((account) => !account.archived);
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
  preferredAccountId,
  onClose,
  onSaved,
}: {
  kind: 'account' | 'transaction' | 'checkpoint' | 'asset' | 'budget';
  data: BudgetData;
  remote: boolean;
  transaction: Transaction | null;
  asset: Asset | null;
  preferredAccountId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const availableAccounts = data.accounts.filter(
    (item) => !item.archived || item.id === transaction?.accountId,
  );
  const defaultAccount =
    availableAccounts.find((item) => item.isDefault) ?? availableAccounts[0];
  const [account, setAccount] = useState(
    transaction?.accountId ?? preferredAccountId ?? defaultAccount?.id ?? '',
  );
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState('Checking');
  const [currency, setCurrency] = useState(readPreferences().currency);
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
                {availableAccounts.map((item) => (
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
