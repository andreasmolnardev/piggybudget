import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowDownUp,
  ArrowRight,
  ArrowRightLeft,
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
import { apiBaseUrl, apiFetch } from '../../api/client';
import { pb } from '../../api/pocketbase';
import type {
  Account,
  Asset,
  AssetGroup,
  AssetPosition,
  Budget,
  BudgetData,
  Goal,
  GoalContribution,
  RecurringGoalContribution,
  FinanceRecordTarget,
  RecurringTransaction,
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

type PendingDeletion = {
  key: string;
  name: string;
  timer: number;
  execute: () => Promise<void>;
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

function recurringCadence(rule: Pick<RecurringTransaction, 'frequency' | 'interval'>) {
  const unit = {
    daily: 'day',
    weekly: 'week',
    monthly: 'month',
    yearly: 'year',
  }[rule.frequency];
  const interval = rule.interval > 1 ? `${rule.interval} ` : '';
  const plural = rule.interval > 1 ? 's' : '';

  return `Every ${interval}${unit}${plural}`;
}

function readPreferences(userId = pb.authStore.record?.id ?? ''): UserPreferences {
  try {
    const saved = JSON.parse(
      localStorage.getItem(preferencesKey(userId)) ?? '{}',
    ) as Partial<UserPreferences>;
    return {
      currency: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'].includes(saved.currency ?? '')
        ? saved.currency!
        : defaultPreferences.currency,
      weekStart: saved.weekStart === 'sunday' ? 'sunday' : 'monday',
      dateFormat: ['day-first', 'iso'].includes(saved.dateFormat ?? '')
        ? (saved.dateFormat as UserPreferences['dateFormat'])
        : 'locale',
      numberFormat: ['en-US', 'de-DE'].includes(saved.numberFormat ?? '')
        ? (saved.numberFormat as UserPreferences['numberFormat'])
        : 'locale',
      theme: ['light', 'dark'].includes(saved.theme ?? '')
        ? (saved.theme as UserPreferences['theme'])
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
      {kind === 'transfer' ? (
        <ArrowRightLeft size={16} />
      ) : kind === 'income' ? (
        <ArrowDownLeft size={16} />
      ) : (
        <ArrowUpRight size={16} />
      )}
    </span>
  );
}

function TransactionRow({
  transaction,
  onOpen,
  onEdit,
  onDelete,
  onDuplicate,
  onToggleCleared,
  showDate = true,
  dashboardCard = false,
}: {
  transaction: Transaction;
  onOpen?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onToggleCleared?: () => void;
  showDate?: boolean;
  dashboardCard?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const transactionDetails = dashboardCard
    ? [
        ...(showDate ? [formatDate(transaction.date)] : []),
        transaction.account,
        transaction.category || 'Uncategorized',
      ].join(' · ')
    : `${transaction.category || 'Uncategorized'} · ${transaction.account}`;
  return (
    <div
      className={`transaction-row transaction-entry${
        dashboardCard ? ' dashboard-recent-transaction' : ''
      }`}
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
        <span>{transactionDetails}</span>
      </div>
      {showDate && !dashboardCard && <time>{formatDate(transaction.date)}</time>}
      <strong className={`transaction-amount ${transaction.kind}`}>
        {(transaction.signedAmount ?? (transaction.kind === 'income' ? 1 : -1)) >= 0 ? '+' : '−'}
        {formatMoney(transaction.amount)}
      </strong>
      {onEdit && onDelete && (onDuplicate || onToggleCleared) ? (
        <span className="transaction-row-menu-wrap">
          <button
            className="icon-button row-menu"
            aria-label={`More options for ${transaction.merchant}`}
            aria-expanded={menuOpen}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((open) => !open);
            }}
          >
            <MoreHorizontal size={17} />
          </button>
          {menuOpen && (
            <span
              className="transaction-row-menu"
              role="menu"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onOpen?.();
                }}
              >
                View
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onEdit();
                }}
              >
                Edit
              </button>
              {onDuplicate && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onDuplicate();
                  }}
                >
                  Duplicate
                </button>
              )}
              {onToggleCleared && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onToggleCleared();
                  }}
                >
                  {transaction.cleared ? 'Mark uncleared' : 'Mark cleared'}
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
              >
                Delete
              </button>
            </span>
          )}
        </span>
      ) : onEdit && onDelete ? (
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

function BudgetLine({
  budget,
  onOpen,
  onEdit,
  onArchive,
  onDelete,
}: {
  budget: Budget;
  onOpen?: () => void;
  onEdit?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
}) {
  const percentage = budget.limit ? (budget.spent / budget.limit) * 100 : 0;
  return (
    <div className="budget-line">
      <div className="budget-line-heading">
        <span className="budget-dot" style={{ background: budget.color }} />
        {onOpen ? (
          <button className="budget-line-open" type="button" onClick={onOpen}>
            {budget.category}
          </button>
        ) : (
          <strong>{budget.category}</strong>
        )}
        {onOpen ? (
          <button
            className="budget-line-amount budget-line-open"
            type="button"
            onClick={onOpen}
            aria-label={`Open ${budget.category} budget and transactions`}
          >
            {formatMoney(budget.spent)} <em>/ {formatMoney(budget.limit)}</em>
          </button>
        ) : (
          <span className="budget-line-amount">
            {formatMoney(budget.spent)} <em>/ {formatMoney(budget.limit)}</em>
          </span>
        )}
      </div>
      <ProgressBar value={percentage} color={budget.color} />
      <small>
        {Math.max(0, budget.limit - budget.spent) > 0
          ? `${formatMoney(budget.limit - budget.spent)} left`
          : 'Over budget'}
      </small>
      {(onEdit || onArchive || onDelete) && (
        <div className="budget-line-actions">
          {onEdit && (
            <button className="text-button" type="button" onClick={onEdit}>
              Edit
            </button>
          )}
          {onArchive && (
            <button className="text-button" type="button" onClick={onArchive}>
              {budget.archived ? 'Restore' : 'Archive'}
            </button>
          )}
          {onDelete && (
            <button className="text-button button-danger" type="button" onClick={onDelete}>
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ReconciliationCard({
  reconciliation,
  transactions,
  onOpenTransaction,
  onAddTransaction,
  onRecordCheckpoint,
  compact = false,
}: {
  reconciliation: BudgetData['reconciliation'];
  transactions: Transaction[];
  onOpenTransaction: (transaction: Transaction) => void;
  onAddTransaction: () => void;
  onRecordCheckpoint: (accountId: string) => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showDetails, setShowDetails] = useState(false);
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
  const windowTransactions = transactions
    .filter(
      (transaction) =>
        transaction.accountId === reconciliation.accountId &&
        (!reconciliation.from || transaction.date > reconciliation.from) &&
        (!reconciliation.to || transaction.date <= reconciliation.to),
    )
    .sort((left, right) => left.date.localeCompare(right.date));
  return (
    <>
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
          <button className="text-button" type="button" onClick={() => setShowDetails(true)}>
            Review checkpoints and transactions <ArrowRight size={14} />
          </button>
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
            <span>
              {reconciliation.actualDelta === 0
                ? '—'
                : `${Math.max(0, Math.min(100, Math.round((Math.abs(reconciliation.transactionDelta) / Math.abs(reconciliation.actualDelta)) * 100)))}%`}
            </span>
            <small>checked</small>
          </div>
        )}
      </article>
      {showDetails && (
        <div className="composer-overlay">
          <button
            className="composer-backdrop"
            type="button"
            onClick={() => setShowDetails(false)}
            aria-label="Close"
          />
          <section
            className="composer-card record-detail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reconciliation-details-title"
          >
            <div className="composer-heading">
              <div>
                <h2 id="reconciliation-details-title">{reconciliation.account} reconciliation</h2>
                <span>
                  {reconciliation.from ? formatDate(reconciliation.from) : 'Opening balance'} to{' '}
                  {reconciliation.to ? formatDate(reconciliation.to) : 'latest checkpoint'}
                </span>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setShowDetails(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <dl className="transaction-detail-list">
              <DetailRow
                label="Starting checkpoint balance"
                value={formatMoney(reconciliation.fromBalance)}
              />
              <DetailRow
                label="Ending checkpoint balance"
                value={formatMoney(reconciliation.toBalance)}
              />
              <DetailRow
                label="Checkpoint balance change"
                value={formatMoney(reconciliation.actualDelta)}
              />
              <DetailRow
                label="Recorded transaction change"
                value={formatMoney(reconciliation.transactionDelta)}
              />
              <DetailRow
                label="Unexplained difference"
                value={formatMoney(reconciliation.actualDelta - reconciliation.transactionDelta)}
              />
            </dl>
            <h3>Transactions in this window</h3>
            {windowTransactions.length ? (
              <div className="record-related-list">
                {windowTransactions.map((transaction) => (
                  <button
                    className="record-related-row"
                    type="button"
                    key={transaction.id}
                    onClick={() => {
                      setShowDetails(false);
                      onOpenTransaction(transaction);
                    }}
                  >
                    <span>
                      {formatDate(transaction.date)} · {transaction.merchant}
                    </span>
                    <strong>
                      {formatMoney(
                        transaction.signedAmount ??
                          (transaction.kind === 'income'
                            ? transaction.amount
                            : -transaction.amount),
                      )}
                    </strong>
                  </button>
                ))}
              </div>
            ) : (
              <p className="page-description">
                No transactions were recorded between these checkpoints.
              </p>
            )}
            <div className="composer-actions">
              <button
                className="button"
                type="button"
                onClick={() => {
                  setShowDetails(false);
                  onRecordCheckpoint(reconciliation.accountId);
                }}
              >
                Record checkpoint
              </button>
              <button
                className="button button-primary"
                type="button"
                onClick={() => {
                  setShowDetails(false);
                  onAddTransaction();
                }}
              >
                Add or correct transaction
              </button>
            </div>
          </section>
        </div>
      )}
    </>
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
        <div
          className="chart-bars"
          style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
        >
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
  const remainingBudget = data.budgets.reduce(
    (sum, budget) => sum + budget.limit - budget.spent,
    0,
  );
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
            <button
              className="text-button"
              type="button"
              onClick={() => onOpenTransaction(largestExpense)}
            >
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
  onAddAccount,
  onAddCheckpoint,
  onOpenTransaction,
  onEditTransaction,
  onDeleteTransaction,
  onDuplicateTransaction,
  onToggleCleared,
  onOpenBudget,
}: {
  data: BudgetData;
  profile: UserProfile;
  onNavigate: (view: BudgetView) => void;
  onAddTransaction: () => void;
  onAddAccount: () => void;
  onAddCheckpoint: () => void;
  onOpenTransaction: (transaction: Transaction) => void;
  onEditTransaction: (transaction: Transaction) => void;
  onDeleteTransaction: (transaction: Transaction) => void;
  onDuplicateTransaction: (transaction: Transaction) => void;
  onToggleCleared: (transaction: Transaction) => void;
  onOpenBudget: (budget: Budget) => void;
}) {
  const dashboardPeriodKey = `piggybudget:dashboard-period:${pb.authStore.record?.id ?? ''}`;
  const [period, setPeriod] = useState<DashboardPeriod>(() => {
    try {
      const saved = sessionStorage.getItem(dashboardPeriodKey);
      return ['this-month', 'last-month', 'this-week', 'last-7-days', 'last-30-days'].includes(
        saved ?? '',
      )
        ? (saved as DashboardPeriod)
        : 'this-month';
    } catch {
      return 'this-month';
    }
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  useEffect(() => {
    try {
      sessionStorage.setItem(dashboardPeriodKey, period);
    } catch {
      // Keep the dashboard usable when browser storage is unavailable.
    }
  }, [dashboardPeriodKey, period]);
  const range = periodRange(period, readPreferences().weekStart);
  const currentTransactions = data.transactions.filter(
    (transaction) =>
      transaction.date >= dateKey(range.start) && transaction.date <= dateKey(range.end),
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
  const previousNet =
    previousTransactions
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
        action={
          <AddFinanceEntryPopover
            trigger={
              <button className="button button-primary" type="button">
                <Plus size={16} /> New
              </button>
            }
            onAddTransaction={onAddTransaction}
            onAddAccount={onAddAccount}
            onAddCheckpoint={onAddCheckpoint}
          />
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
                <strong>
                  {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(
                    new Date(`${selectedDay}T12:00:00`),
                  )}
                </strong>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => setSelectedDay(null)}
                  aria-label="Close day transactions"
                >
                  <X size={15} />
                </button>
              </div>
              {selectedDayTransactions.length ? (
                selectedDayTransactions.map((transaction) => (
                  <button
                    className="chart-transaction-link"
                    type="button"
                    key={transaction.id}
                    onClick={() => onOpenTransaction(transaction)}
                  >
                    <span>{transaction.merchant}</span>
                    <strong>{formatMoney(transaction.amount)}</strong>
                  </button>
                ))
              ) : (
                <p>No transactions were recorded on this day.</p>
              )}
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
                dashboardCard
                onOpen={() => onOpenTransaction(transaction)}
                onEdit={() => onEditTransaction(transaction)}
                onDelete={() => onDeleteTransaction(transaction)}
                onDuplicate={() => onDuplicateTransaction(transaction)}
                onToggleCleared={() => onToggleCleared(transaction)}
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
              <BudgetLine key={budget.id} budget={budget} onOpen={() => onOpenBudget(budget)} />
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

function parseCsvRows(source: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function transactionCsv(transactions: Transaction[]) {
  const values = [
    ['date', 'payee', 'amount', 'type', 'account', 'category', 'notes', 'transfer_id'],
    ...transactions.map((transaction) => [
      transaction.date,
      transaction.merchant,
      transaction.signedAmount ??
        (transaction.kind === 'expense' ? -transaction.amount : transaction.amount),
      transaction.kind,
      transaction.accountId ?? transaction.account,
      transaction.category,
      transaction.note ?? '',
      transaction.transferId ?? '',
    ]),
  ];
  return values
    .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
    .join('\r\n');
}

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

type TransactionSort = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc';

function readTransactionViewState(userId: string): {
  filters: TransactionFilters;
  sort: TransactionSort;
} {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(`piggybudget:transaction-state:${userId}`) ?? '{}',
    ) as { filters?: Partial<TransactionFilters>; sort?: string };
    const sort = ['date-desc', 'date-asc', 'amount-desc', 'amount-asc'].includes(saved.sort ?? '')
      ? (saved.sort as TransactionSort)
      : 'date-desc';
    return {
      filters: { ...emptyTransactionFilters, ...saved.filters },
      sort,
    };
  } catch {
    return { filters: emptyTransactionFilters, sort: 'date-desc' };
  }
}

function AddFinanceEntryPopover({
  trigger,
  onAddTransaction,
  onAddAccount,
  onAddCheckpoint,
}: {
  trigger: ReactNode;
  onAddTransaction: () => void;
  onAddAccount: () => void;
  onAddCheckpoint: () => void;
}) {
  const [open, setOpen] = useState(false);
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="transaction-add-popover">
        <button type="button" onClick={() => choose(onAddTransaction)}>
          <Plus size={15} /> Add transaction
        </button>
        <button type="button" onClick={() => choose(onAddAccount)}>
          <Landmark size={15} /> Add account
        </button>
        <button type="button" onClick={() => choose(onAddCheckpoint)}>
          <CheckCircle2 size={15} /> Add checkpoint
        </button>
      </PopoverContent>
    </Popover>
  );
}

function TransactionsView({
  data,
  userId,
  remote,
  onAddTransaction,
  onAddCheckpoint,
  onAddAccount,
  onEditTransaction,
  onDeleteTransaction,
  onToggleCleared,
  onOpenTransaction,
  onRenameReceivable,
  onRefresh,
}: {
  data: BudgetData;
  userId: string;
  remote: boolean;
  onAddTransaction: () => void;
  onAddCheckpoint: () => void;
  onAddAccount: () => void;
  onEditTransaction: (transaction: Transaction) => void;
  onDeleteTransaction: (transaction: Transaction) => void;
  onToggleCleared: (transaction: Transaction) => void;
  onOpenTransaction: (transaction: Transaction) => void;
  onRenameReceivable: (person: string, nextName: string) => Promise<boolean>;
  onRefresh: () => void;
}) {
  const [filters, setFilters] = useState<TransactionFilters>(
    () => readTransactionViewState(userId).filters,
  );
  const [sort, setSort] = useState<TransactionSort>(() => readTransactionViewState(userId).sort);
  const [stateUserId, setStateUserId] = useState(userId);
  const [page, setPage] = useState(1);
  const [savedViews, setSavedViews] = useState<SavedTransactionView[]>([]);
  const [loadedViewsKey, setLoadedViewsKey] = useState('');
  const [savedViewsOpen, setSavedViewsOpen] = useState(false);
  const [recurringMessage, setRecurringMessage] = useState('');
  const [openRecurringMenu, setOpenRecurringMenu] = useState<string | null>(null);
  const pageSize = 25;
  useEffect(() => {
    if (stateUserId === userId) return;
    const saved = readTransactionViewState(userId);
    setFilters(saved.filters);
    setSort(saved.sort);
    setStateUserId(userId);
  }, [stateUserId, userId]);
  useEffect(() => {
    if (stateUserId !== userId) return;
    try {
      sessionStorage.setItem(
        `piggybudget:transaction-state:${userId}`,
        JSON.stringify({ filters, sort }),
      );
    } catch {
      // Keep filtering usable when browser storage is unavailable.
    }
  }, [filters, sort, stateUserId, userId]);
  const changeRecurringRule = async (rule: RecurringTransaction, active?: boolean) => {
    if (
      active === undefined &&
      !window.confirm(`Delete recurring transaction “${rule.merchant}”?`)
    ) {
      return;
    }
    const response = await apiFetch(`/api/finance/recurring_transactions/${rule.id}`, {
      method: active === undefined ? 'DELETE' : 'PATCH',
      headers: {
        Authorization: `Bearer ${pb.authStore.token}`,
        'Content-Type': 'application/json',
      },
      ...(active === undefined ? {} : { body: JSON.stringify({ active }) }),
    });
    if (!response.ok) {
      setRecurringMessage((await response.text()) || 'Could not update recurring transaction.');
      return;
    }
    setRecurringMessage('Recurring transaction updated.');
    onRefresh();
  };
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
  const filtered = useMemo(() => {
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
  }, [data.transactions, filters, sort]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);
  const transactionsByDate = new Map<string, Transaction[]>();
  pageItems.forEach((transaction) => {
    const transactions = transactionsByDate.get(transaction.date) ?? [];
    transactions.push(transaction);
    transactionsByDate.set(transaction.date, transactions);
  });
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
      <PageHeader
        title="Transactions"
        action={
          <div className="transaction-header-actions">
            <div className="transaction-header-control">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className="icon-button transaction-header-action"
                    type="button"
                    aria-label="Sort transactions"
                    title="Sort transactions"
                  >
                    <ArrowDownUp size={18} />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="transaction-sort-popover">
                  <label className="transaction-filter-field">
                    Sort by
                    <select
                      value={sort}
                      onChange={(event) => setSort(event.target.value as typeof sort)}
                    >
                      <option value="date-desc">Newest date</option>
                      <option value="date-asc">Oldest date</option>
                      <option value="amount-desc">Highest amount</option>
                      <option value="amount-asc">Lowest amount</option>
                    </select>
                  </label>
                </PopoverContent>
              </Popover>
            </div>
            <div className="transaction-header-control">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className="icon-button transaction-header-action transaction-filter-trigger"
                    type="button"
                    aria-label="Filter transactions"
                    title="Filter transactions"
                  >
                    <Filter size={18} />
                    {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="transaction-filter-popover">
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
                        onChange={(event) => setFilters({ ...filters, fromDate: event.target.value })}
                        aria-label="From date"
                      />
                    </label>
                    <label className="transaction-filter-field">
                      To
                      <input
                        type="date"
                        value={filters.toDate}
                        onChange={(event) => setFilters({ ...filters, toDate: event.target.value })}
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
            </div>
            <div className="transaction-header-control">
              <AddFinanceEntryPopover
                trigger={
                  <button
                    className="icon-button transaction-header-action transaction-add-trigger"
                    type="button"
                    aria-label="Add finance entry"
                  >
                    <Plus size={19} />
                  </button>
                }
                onAddTransaction={onAddTransaction}
                onAddAccount={onAddAccount}
                onAddCheckpoint={onAddCheckpoint}
              />
            </div>
          </div>
        }
      />
      <MoneyLentPanel
        transactions={data.transactions}
        userId={userId}
        onOpenTransaction={onOpenTransaction}
        onRenamePerson={onRenameReceivable}
      />
      <section className="transactions-section">
        <details className="transaction-recurring-panel">
          <summary className="transaction-filter-heading">
            <strong id="recurring-transactions-title">Recurring transactions</strong>
            <span className="transaction-recurring-summary-meta">
              <span>
                {data.recurringTransactions.length}{' '}
                {data.recurringTransactions.length === 1 ? 'rule' : 'rules'}
              </span>
              <ChevronDown size={16} aria-hidden="true" />
            </span>
          </summary>
          {data.recurringTransactions.length ? (
            <div className="transaction-list transaction-cards recurring-transaction-list">
              {data.recurringTransactions.map((rule) => (
                <div className="transaction-row recurring-transaction-row" key={rule.id}>
                  <span className="transaction-icon income">
                    <RefreshCw size={15} />
                  </span>
                  <div className="transaction-main">
                    <strong>{rule.merchant}</strong>
                    <span>
                      {rule.account} · {recurringCadence(rule)}
                    </span>
                  </div>
                  <time>Next {formatDate(rule.nextDate)}</time>
                  <strong className="transaction-amount income">
                    {rule.amount < 0 ? '−' : '+'}
                    {formatMoney(Math.abs(rule.amount))}
                  </strong>
                  <span className="transaction-row-menu-wrap recurring-transaction-menu-wrap">
                    <button
                      className="icon-button row-menu"
                      aria-label={`More options for recurring ${rule.merchant}`}
                      aria-expanded={openRecurringMenu === rule.id}
                      type="button"
                      onClick={() =>
                        setOpenRecurringMenu((open) => (open === rule.id ? null : rule.id))
                      }
                    >
                      <MoreHorizontal size={17} />
                    </button>
                    {openRecurringMenu === rule.id && (
                      <span className="transaction-row-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOpenRecurringMenu(null);
                            void changeRecurringRule(rule, !rule.active);
                          }}
                        >
                          {rule.active ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOpenRecurringMenu(null);
                            void changeRecurringRule(rule);
                          }}
                        >
                          Delete
                        </button>
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="page-description">Set a transaction to repeat when you create it.</p>
          )}
          {recurringMessage && (
            <p className="page-description" role="status">
              {recurringMessage}
            </p>
          )}
        </details>
        <div className="transaction-date-groups">
          {filtered.length ? (
            [...transactionsByDate].map(([date, transactions]) => (
              <section className="transaction-date-group" key={date}>
                <h3 className="transaction-date-heading">{formatDate(date)}</h3>
                <div className="transaction-list transaction-table transaction-cards">
                  {transactions.map((transaction) => (
                    <TransactionRow
                      key={transaction.id}
                      transaction={transaction}
                      onOpen={() => onOpenTransaction(transaction)}
                      onEdit={() => onEditTransaction(transaction)}
                      onDelete={() => onDeleteTransaction(transaction)}
                      onToggleCleared={() => onToggleCleared(transaction)}
                      showDate={false}
                    />
                  ))}
                </div>
              </section>
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
              : 'Showing 0'}{' '}
            of {filtered.length} filtered transactions · {data.transactions.length} total
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
            <span>
              Page {page} of {pageCount}
            </span>
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
                  <Filter size={14} /> Saved views{' '}
                  {savedViews.length ? `(${savedViews.length})` : ''}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="saved-views-popover">
                <div className="transaction-filter-heading">
                  <strong>Saved views</strong>
                  <button className="text-button" type="button" onClick={saveView}>
                    Save current
                  </button>
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

function MoneyLentPanel({
  transactions,
  userId,
  onOpenTransaction,
  onRenamePerson,
}: {
  transactions: Transaction[];
  userId: string;
  onOpenTransaction: (transaction: Transaction) => void;
  onRenamePerson: (person: string, nextName: string) => Promise<boolean>;
}) {
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
      .map(([person, balance]) => ({
        person,
        balance,
        transactions: transactions.filter(
          (transaction) => transaction.receivable?.trim() === person,
        ),
      }));
  }, [transactions]);
  const [editingPerson, setEditingPerson] = useState<string | null>(null);
  const [personName, setPersonName] = useState('');
  const [historyPerson, setHistoryPerson] = useState<string | null>(null);
  const [repaymentPerson, setRepaymentPerson] = useState<string | null>(null);
  const [repaymentAmount, setRepaymentAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [reminders, setReminders] = useState<Record<string, string>>({});
  const [reminderBusy, setReminderBusy] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void apiFetch('/api/finance/receivable-reminders')
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load repayment reminders.');
        const records = (await response.json()) as Array<{ person: string; due_date: string }>;
        if (cancelled) return;
        const loaded = Object.fromEntries(
          records.map((record) => [record.person, record.due_date.slice(0, 10)]),
        ) as Record<string, string>;
        const legacyKey = `piggybudget-receivable-reminders:${userId}`;
        let legacy: Record<string, string> = {};
        try {
          legacy = JSON.parse(localStorage.getItem(legacyKey) ?? '{}') as Record<string, string>;
        } catch {
          legacy = {};
        }
        let migrated = true;
        for (const [person, date] of Object.entries(legacy)) {
          const alreadySaved = Object.keys(loaded).some(
            (savedPerson) => savedPerson.toLowerCase() === person.toLowerCase(),
          );
          if (alreadySaved || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
          const saveResponse = await apiFetch('/api/finance/receivable-reminders', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ person, dueDate: date }),
          });
          if (saveResponse.ok) loaded[person] = date;
          else migrated = false;
        }
        if (migrated) localStorage.removeItem(legacyKey);
        if (!cancelled) setReminders(loaded);
      })
      .catch(() => {
        if (!cancelled) setReminders({});
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  const setReminder = async (person: string, date: string) => {
    setReminderBusy(person);
    try {
      const response = await apiFetch('/api/finance/receivable-reminders', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person, dueDate: date }),
      });
      if (!response.ok) throw new Error((await response.text()) || 'Could not save reminder.');
      setReminders((current) => {
        const next = { ...current };
        if (date) next[person] = date;
        else delete next[person];
        return next;
      });
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : 'Could not save reminder.');
    } finally {
      setReminderBusy(null);
    }
  };
  const recordRepayment = async (person: string, balance: number, related: Transaction[]) => {
    const account = related.find((transaction) => transaction.accountId)?.accountId;
    const amount = Number(repaymentAmount);
    if (!account || !Number.isFinite(amount) || amount <= 0 || amount > balance + 0.005) {
      window.alert(
        !account
          ? 'This person needs a linked account before recording a repayment.'
          : 'Repayment must be greater than zero and no more than the amount still owed.',
      );
      return;
    }
    setBusy(true);
    try {
      const response = await apiFetch('/api/finance/transactions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pb.authStore.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          account,
          date: dateKey(new Date()),
          amount,
          type: 'income',
          payee: `Repayment from ${person}`,
          description: `Repayment from ${person}`,
          category: 'Income',
          receivable: person,
        }),
      });
      if (!response.ok) {
        window.alert((await response.text()) || 'Could not record the repayment.');
        return;
      }
      setRepaymentPerson(null);
      setRepaymentAmount('');
      window.dispatchEvent(new Event('piggybudget:refresh'));
    } catch {
      window.alert('Could not record the repayment. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };
  if (!people.length) return null;
  return (
    <section className="panel" aria-label="Money lent">
      <SectionHeading title="Money lent" />
      <p className="page-description">
        Add a person to a transaction to track money lent. Repayments should use the same name.
      </p>
      <div className="asset-list">
        {people.map(({ person, balance, transactions: related }) => (
          <div className="asset-row" key={person}>
            <span className="asset-mark">
              <HandCoins size={16} />
            </span>
            <div className="asset-main">
              <strong>{person}</strong>
              <span>Still owed</span>
            </div>
            <strong>{formatMoney(balance)}</strong>
            <div className="money-lent-actions">
              <button
                className="text-button"
                type="button"
                onClick={() => setHistoryPerson(historyPerson === person ? null : person)}
              >
                {historyPerson === person ? 'Hide transactions' : `${related.length} transactions`}
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setEditingPerson(person);
                  setPersonName(person);
                }}
              >
                Rename
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setRepaymentPerson(repaymentPerson === person ? null : person);
                  setRepaymentAmount('');
                }}
              >
                Record repayment
              </button>
            </div>
            {editingPerson === person && (
              <form
                className="money-lent-inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void onRenamePerson(person, personName.trim()).then((saved) => {
                    if (saved) setEditingPerson(null);
                  });
                }}
              >
                <input
                  required
                  aria-label={`New name for ${person}`}
                  value={personName}
                  onChange={(event) => setPersonName(event.target.value)}
                />
                <button className="text-button" type="submit">
                  Save name
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setEditingPerson(null)}
                >
                  Cancel
                </button>
              </form>
            )}
            {repaymentPerson === person && (
              <form
                className="money-lent-inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void recordRepayment(person, balance, related);
                }}
              >
                <label>
                  Amount received
                  <input
                    required
                    type="number"
                    min="0.01"
                    max={balance}
                    step="0.01"
                    value={repaymentAmount}
                    onChange={(event) => setRepaymentAmount(event.target.value)}
                  />
                </label>
                <button className="text-button" type="submit" disabled={busy}>
                  {busy ? 'Saving…' : 'Save repayment'}
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setRepaymentPerson(null)}
                >
                  Cancel
                </button>
              </form>
            )}
            {historyPerson === person && (
              <div className="money-lent-history">
                {related.map((transaction) => (
                  <button
                    className="chart-transaction-link"
                    type="button"
                    key={transaction.id}
                    onClick={() => onOpenTransaction(transaction)}
                  >
                    <span>
                      {transaction.merchant} · {formatDate(transaction.date)}
                    </span>
                    <strong>
                      {transaction.kind === 'income' ? '−' : '+'}
                      {formatMoney(transaction.amount)}
                    </strong>
                  </button>
                ))}
              </div>
            )}
            <div className="money-lent-reminder">
              <label>
                Remind me
                <input
                  aria-label={`Reminder date for ${person}`}
                  type="date"
                  min={new Date().toISOString().slice(0, 10)}
                  value={reminders[person] ?? ''}
                  disabled={reminderBusy === person}
                  onChange={(event) => void setReminder(person, event.target.value)}
                />
              </label>
              {reminders[person] && (
                <button
                  className="text-button"
                  type="button"
                  disabled={reminderBusy === person}
                  onClick={() => void setReminder(person, '')}
                >
                  Clear reminder
                </button>
              )}
            </div>
            <small className="page-description">
              Saved to your account; a notification appears when due.
            </small>
            {reminders[person] && reminders[person] <= new Date().toISOString().slice(0, 10) && (
              <span role="status">Reminder due</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

type BudgetPeriod = 'month' | 'quarter' | 'year';

function selectedBudgetRange(monthValue: string, period: BudgetPeriod) {
  const [year, month] = monthValue.split('-').map(Number);
  const firstMonth =
    period === 'year' ? 1 : period === 'quarter' ? Math.floor((month - 1) / 3) * 3 + 1 : month;
  const lastMonth = period === 'year' ? 12 : period === 'quarter' ? firstMonth + 2 : month;
  const start = new Date(year, firstMonth - 1, 1);
  const end = new Date(year, lastMonth, 0);
  return { start: dateKey(start), end: dateKey(end), year, firstMonth, lastMonth };
}

function budgetPeriodLabel(range: ReturnType<typeof selectedBudgetRange>, period: BudgetPeriod) {
  if (period === 'year') return String(range.year);
  if (period === 'quarter') return `Q${Math.floor((range.firstMonth - 1) / 3) + 1} ${range.year}`;
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
    new Date(range.year, range.firstMonth - 1, 1),
  );
}

function BudgetsView({
  userId,
  data,
  onAddBudget,
  onEditBudget,
  onArchiveBudget,
  onDeleteBudget,
  onOpenBudget,
  onOpenTransaction,
  onAddTransactionForAccount,
  onRecordCheckpoint,
}: {
  userId: string;
  data: BudgetData;
  onAddBudget: () => void;
  onEditBudget: (budget: Budget) => void;
  onArchiveBudget: (budget: Budget) => void;
  onDeleteBudget: (budget: Budget) => void;
  onOpenBudget: (budget: Budget) => void;
  onOpenTransaction: (transaction: Transaction) => void;
  onAddTransactionForAccount: (accountId: string) => void;
  onRecordCheckpoint: (accountId: string) => void;
}) {
  const viewStateKey = `piggybudget:budget-view:${userId}`;
  const [viewState, setViewState] = useState<{
    monthValue: string;
    period: BudgetPeriod;
    showArchived: boolean;
  }>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(viewStateKey) ?? '{}') as {
        monthValue?: string;
        period?: BudgetPeriod;
        showArchived?: boolean;
      };
      return {
        monthValue: /^\d{4}-(0[1-9]|1[0-2])$/.test(saved.monthValue ?? '')
          ? saved.monthValue!
          : dateKey(new Date()).slice(0, 7),
        period: ['month', 'quarter', 'year'].includes(saved.period ?? '') ? saved.period! : 'month',
        showArchived: Boolean(saved.showArchived),
      };
    } catch {
      return { monthValue: dateKey(new Date()).slice(0, 7), period: 'month', showArchived: false };
    }
  });
  const { monthValue, period, showArchived } = viewState;
  const setMonthValue = (value: string) =>
    setViewState((current) => ({ ...current, monthValue: value }));
  const setPeriod = (value: BudgetPeriod) =>
    setViewState((current) => ({ ...current, period: value }));
  const setShowArchived = (value: boolean) =>
    setViewState((current) => ({ ...current, showArchived: value }));
  useEffect(() => {
    try {
      sessionStorage.setItem(viewStateKey, JSON.stringify(viewState));
    } catch {
      // Keep the budget controls usable when browser storage is unavailable.
    }
  }, [viewState, viewStateKey]);
  const range = selectedBudgetRange(monthValue, period);
  const periodName = budgetPeriodLabel(range, period);
  const budgets = data.budgets
    .filter((budget) => Boolean(budget.archived) === showArchived)
    .filter(
      (budget) =>
        (!budget.startDate || budget.startDate <= range.end) &&
        (!budget.endDate || budget.endDate >= range.start),
    )
    .map((budget) => ({
      ...budget,
      spent: data.transactions
        .filter((transaction) => transaction.kind === 'expense')
        .filter((transaction) => transaction.date >= range.start && transaction.date <= range.end)
        .filter((transaction) =>
          transaction.budgetId
            ? transaction.budgetId === budget.id
            : transaction.category.toLowerCase() === budget.category.toLowerCase(),
        )
        .reduce((sum, transaction) => sum + transaction.amount, 0),
    }));
  const totalSpent = budgets.reduce((sum, budget) => sum + budget.spent, 0);
  const totalLimit = budgets.reduce((sum, budget) => sum + budget.limit, 0);
  const percentUsed = totalLimit > 0 ? Math.round((totalSpent / totalLimit) * 100) : 0;
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
          <small>for {periodName}</small>
        </article>
        <article className="budget-summary-card is-highlight">
          <span>Spent so far</span>
          <strong>{formatMoney(totalSpent)}</strong>
          <small>{percentUsed}% of plan</small>
        </article>
        <article className="budget-summary-card">
          <span>Left to spend</span>
          <strong>{formatMoney(totalLimit - totalSpent)}</strong>
          <small>across {budgets.length} categories</small>
        </article>
      </div>
      <div className="dashboard-grid budgets-layout">
        <section className="panel">
          <SectionHeading
            title={`${periodName} budgets`}
            action={
              <div className="budget-period-controls">
                <input
                  aria-label="Budget month"
                  type="month"
                  value={monthValue}
                  onChange={(event) =>
                    setMonthValue(event.target.value || dateKey(new Date()).slice(0, 7))
                  }
                />
                <select
                  className="select-button"
                  aria-label="Budget period"
                  value={period}
                  onChange={(event) => setPeriod(event.target.value as BudgetPeriod)}
                >
                  <option value="month">Monthly</option>
                  <option value="quarter">Quarterly</option>
                  <option value="year">Yearly</option>
                </select>
              </div>
            }
          />
          <button
            className="text-button budget-archive-toggle"
            type="button"
            onClick={() => setShowArchived(!showArchived)}
          >
            {showArchived ? 'Show active budgets' : 'Show archived budgets'}
          </button>
          <div className="budget-list budget-list-large">
            {budgets.map((budget) => (
              <BudgetLine
                key={budget.id}
                budget={budget}
                onOpen={() => onOpenBudget(budget)}
                onEdit={() => onEditBudget(budget)}
                onArchive={() => onArchiveBudget(budget)}
                onDelete={() => onDeleteBudget(budget)}
              />
            ))}
          </div>
          {!budgets.length && (
            <div className="empty-state">
              <CalendarDays size={20} />
              <strong>No budgets for {periodName}</strong>
              <span>Create a budget for this period to track category spending.</span>
            </div>
          )}
          <button className="add-line-button" type="button" onClick={onAddBudget}>
            <Plus size={15} /> Add category
          </button>
        </section>
        <div className="stacked-cards">
          <ReconciliationCard
            reconciliation={data.reconciliation}
            transactions={data.transactions}
            onOpenTransaction={onOpenTransaction}
            onAddTransaction={() =>
              onAddTransactionForAccount(data.reconciliation?.accountId ?? '')
            }
            onRecordCheckpoint={onRecordCheckpoint}
            compact
          />
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
              <p>Review the checkpoint balances and transactions in the reconciliation card.</p>
            </div>
          </article>
        </div>
      </div>
    </>
  );
}

function AssetsView({
  userId,
  data,
  remote,
  onRefresh,
  onAddAsset,
  onEditAsset,
  onDeleteAsset,
}: {
  userId: string;
  data: BudgetData;
  remote: boolean;
  onRefresh: () => void;
  onAddAsset: () => void;
  onEditAsset: (asset: Asset) => void;
  onDeleteAsset: (asset: Asset) => void;
}) {
  const [historyAsset, setHistoryAsset] = useState<Asset | null>(null);
  const historyRangeKey = `piggybudget:asset-history-range:${userId}`;
  const [historyRange, setHistoryRange] = useState<'3m' | '1y' | 'all'>(() => {
    try {
      const saved = sessionStorage.getItem(historyRangeKey);
      return ['3m', '1y', 'all'].includes(saved ?? '') ? (saved as '3m' | '1y' | 'all') : '1y';
    } catch {
      return '1y';
    }
  });
  const [portfolioSnapshots, setPortfolioSnapshots] = useState<
    Array<{ asset: string; position: string; source: string; value: number; as_of: string }>
  >([]);
  useEffect(() => {
    try {
      sessionStorage.setItem(historyRangeKey, historyRange);
    } catch {
      // Keep the history control usable when browser storage is unavailable.
    }
  }, [historyRange, historyRangeKey]);
  useEffect(() => {
    let cancelled = false;
    if (!remote) return;
    void apiFetch('/api/finance/asset-valuations')
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load portfolio history.');
        const records = (await response.json()) as Array<{
          asset: string;
          position: string;
          source: string;
          value: number;
          as_of: string;
        }>;
        if (!cancelled) setPortfolioSnapshots(records);
      })
      .catch(() => {
        if (!cancelled) setPortfolioSnapshots([]);
      });
    return () => {
      cancelled = true;
    };
  }, [data.assets, data.assetPositions, remote]);
  const activeGroupIds = new Set(
    data.assetGroups.filter((group) => !group.archived).map((group) => group.id),
  );
  const activePositions = data.assetPositions.filter(
    (position) => !position.archived && activeGroupIds.has(position.group),
  );
  const groupsWithPositions = new Set(activePositions.map((position) => position.group));
  const standaloneAssets = data.assets.filter(
    (asset) => !asset.assetGroup || !groupsWithPositions.has(asset.assetGroup),
  );
  const assetsWithCost = standaloneAssets.filter((asset) => asset.costKnown !== false);
  const positionsWithCost = activePositions.filter((position) => position.costKnown !== false);
  const missingCostCount =
    standaloneAssets.length -
    assetsWithCost.length +
    activePositions.length -
    positionsWithCost.length;
  const totalValue =
    standaloneAssets.reduce((sum, asset) => sum + asset.value, 0) +
    activePositions.reduce((sum, position) => sum + position.value, 0);
  const totalCost =
    assetsWithCost.reduce((sum, asset) => sum + asset.cost, 0) +
    positionsWithCost.reduce((sum, position) => sum + position.purchasePrice, 0);
  const trackedReturn =
    assetsWithCost.reduce((sum, asset) => sum + asset.value - asset.cost, 0) +
    positionsWithCost.reduce((sum, position) => sum + position.value - position.purchasePrice, 0);
  const roi = totalCost ? (trackedReturn / totalCost) * 100 : 0;
  const compositionTotals = new Map<string, number>();
  for (const item of [
    ...standaloneAssets.map((asset) => ({ type: asset.type || 'Other', value: asset.value })),
    ...activePositions.map((position) => ({
      type: position.type || 'Other',
      value: position.value,
    })),
  ]) {
    compositionTotals.set(item.type, (compositionTotals.get(item.type) ?? 0) + item.value);
  }
  const composition = [...compositionTotals.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  const compositionColors = ['#5f8d7e', '#be8a54', '#8e82b9', '#6b9ab8', '#d68b5e', '#789c63'];
  let compositionOffset = 0;
  const compositionStops = composition.map(([type, value], index) => {
    const start = compositionOffset;
    compositionOffset += totalValue ? (value / totalValue) * 100 : 0;
    return `${compositionColors[index % compositionColors.length]} ${start}% ${compositionOffset}%`;
  });
  const compositionShare =
    totalValue && composition.length ? (composition[0][1] / totalValue) * 100 : 0;
  const activeSourceKeys = new Set([
    ...standaloneAssets.map((asset) => `asset:${asset.id}`),
    ...activePositions.map((position) => `position:${position.id}`),
  ]);
  const snapshotsBySource = new Map<string, Array<{ date: string; value: number }>>();
  for (const snapshot of portfolioSnapshots) {
    const sourceId = snapshot.source === 'position' ? snapshot.position : snapshot.asset;
    const key = `${snapshot.source}:${sourceId}`;
    if (!activeSourceKeys.has(key)) continue;
    const values = snapshotsBySource.get(key) ?? [];
    values.push({ date: snapshot.as_of.slice(0, 10), value: snapshot.value });
    snapshotsBySource.set(key, values);
  }
  for (const values of snapshotsBySource.values())
    values.sort((a, b) => a.date.localeCompare(b.date));
  const snapshotDates = [
    ...new Set(
      portfolioSnapshots
        .filter((snapshot) =>
          activeSourceKeys.has(
            `${snapshot.source}:${snapshot.source === 'position' ? snapshot.position : snapshot.asset}`,
          ),
        )
        .map((snapshot) => snapshot.as_of.slice(0, 10)),
    ),
  ].sort();
  const portfolioHistory = snapshotDates.map((date) => {
    let value = 0;
    for (const snapshots of snapshotsBySource.values()) {
      const previous = snapshots.filter((snapshot) => snapshot.date <= date);
      const latest = previous[previous.length - 1];
      if (latest) value += latest.value;
    }
    return { date, value };
  });
  const historyCutoff = new Date();
  if (historyRange === '3m') historyCutoff.setMonth(historyCutoff.getMonth() - 3);
  if (historyRange === '1y') historyCutoff.setFullYear(historyCutoff.getFullYear() - 1);
  const visibleHistory =
    historyRange === 'all'
      ? portfolioHistory
      : portfolioHistory.filter((point) => point.date >= dateKey(historyCutoff));
  const sparklineValues = visibleHistory.slice(-14).map((point) => point.value);
  const sparklineMin = Math.min(...sparklineValues);
  const sparklineMax = Math.max(...sparklineValues);
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
              <ArrowUpRight size={14} />
              {totalCost
                ? `${roi.toFixed(1)}% return on tracked cost`
                : 'Add purchase cost to track return'}
            </small>
          </div>
          <div
            className="asset-donut"
            style={{
              background: compositionStops.length
                ? `conic-gradient(${compositionStops.join(', ')})`
                : 'var(--border)',
            }}
          >
            <div>
              <strong>{compositionShare.toFixed(0)}%</strong>
              <small>{composition[0]?.[0] ?? 'No values'}</small>
            </div>
          </div>
        </section>
        <section className="panel roi-panel">
          <div className="small-panel-icon is-green">
            <TrendingUp size={17} />
          </div>
          <span>Portfolio ROI</span>
          <strong>
            {totalCost
              ? `${trackedReturn >= 0 ? '+' : '−'}${formatMoney(Math.abs(trackedReturn))}`
              : 'Cost data needed'}
          </strong>
          <small className={missingCostCount ? 'asset-cost-warning' : undefined}>
            {missingCostCount
              ? `${missingCostCount} item${missingCostCount === 1 ? '' : 's'} missing purchase cost`
              : 'Return since you started tracking'}
          </small>
          <label className="asset-history-range">
            <span className="sr-only">Valuation history range</span>
            <select
              value={historyRange}
              onChange={(event) => setHistoryRange(event.target.value as typeof historyRange)}
            >
              <option value="3m">3 months</option>
              <option value="1y">1 year</option>
              <option value="all">All history</option>
            </select>
          </label>
          {sparklineValues.length ? (
            <div className="mini-sparkline" aria-label="Portfolio value history">
              {sparklineValues.map((value, index) => {
                const height =
                  sparklineMax === sparklineMin
                    ? 50
                    : 20 + ((value - sparklineMin) / (sparklineMax - sparklineMin)) * 80;
                return (
                  <i
                    key={`${visibleHistory.slice(-14)[index]?.date}-${index}`}
                    style={{ height: `${height}%` }}
                  />
                );
              })}
            </div>
          ) : (
            <small className="asset-history-empty">
              Value history will appear as assets change.
            </small>
          )}
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
              onHistory={() => setHistoryAsset(asset)}
              onEdit={() => onEditAsset(asset)}
              onDelete={() => onDeleteAsset(asset)}
            />
          ))}
          {!data.assets.length && !activePositions.length && (
            <div className="empty-state asset-empty-state">
              <TrendingUp size={20} />
              <strong>Start tracking your assets</strong>
              <span>
                Purchase cost tracks gains, current value tracks net worth, and target sale price is
                your estimate.
              </span>
              <button className="button button-primary" type="button" onClick={onAddAsset}>
                <Plus size={14} /> Add your first asset
              </button>
            </div>
          )}
        </div>
      </section>
      <AssetGroupsSection
        groups={data.assetGroups}
        positions={data.assetPositions}
        onRefresh={onRefresh}
      />
      {historyAsset && (
        <AssetValuationHistoryDialog
          asset={historyAsset}
          remote={remote}
          onClose={() => setHistoryAsset(null)}
        />
      )}
    </>
  );
}

function AssetRow({
  asset,
  onHistory,
  onEdit,
  onDelete,
}: {
  asset: Asset;
  onHistory: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const costKnown = asset.costKnown !== false;
  const returnValue = costKnown ? asset.value - asset.cost : 0;
  const returnPercentage = costKnown && asset.cost ? (returnValue / asset.cost) * 100 : 0;
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
          {` · Value date ${asset.asOf ? formatDate(asset.asOf) : 'not set'}`}
          {asset.targetSalePrice ? ` · Target sale ${formatMoney(asset.targetSalePrice)}` : ''}
        </span>
      </div>
      <div className="asset-bar">
        <ProgressBar value={(asset.value / 50000) * 100} color={asset.color} />
      </div>
      <div className="asset-numbers">
        <strong>{formatMoney(asset.value)}</strong>
        {costKnown ? (
          <span className={returnValue < 0 ? 'negative' : 'positive'}>
            {returnValue < 0 ? '−' : '+'}
            {Math.abs(returnPercentage).toFixed(1)}%{' '}
            <small>({formatMoney(Math.abs(returnValue))})</small>
          </span>
        ) : (
          <span className="asset-cost-missing">Purchase cost not set</span>
        )}
      </div>
      <span className="row-actions">
        <button className="text-button" type="button" onClick={onHistory}>
          History
        </button>
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

function AssetValuationHistoryDialog({
  asset,
  remote,
  onClose,
}: {
  asset: Asset;
  remote: boolean;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<Array<{ id: string; value: number; as_of: string }>>([]);
  const [loading, setLoading] = useState(remote);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (!remote) return;
    void apiFetch(`/api/finance/assets/${asset.id}/valuations`)
      .then(async (response) => {
        if (!response.ok)
          throw new Error((await response.text()) || 'Could not load valuation history.');
        const records = (await response.json()) as Array<{
          id: string;
          value: number;
          as_of: string;
        }>;
        if (!cancelled) setHistory(records);
      })
      .catch((caught) => {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : 'Could not load valuation history.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [asset.id, remote]);
  return (
    <div className="composer-overlay">
      <button className="composer-backdrop" type="button" onClick={onClose} aria-label="Close" />
      <section
        className="composer-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-history-title"
      >
        <div className="composer-heading">
          <div>
            <h2 id="asset-history-title">{asset.name} valuation history</h2>
            <span>Saved values over time</span>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {loading ? (
          <p className="page-description">Loading valuations…</p>
        ) : error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : history.length ? (
          <div className="asset-valuation-history">
            {history.map((item, index) => {
              const previous = history[index + 1];
              const change = previous ? item.value - previous.value : undefined;
              return (
                <div className="saved-view-row" key={item.id}>
                  <span>{formatDate(item.as_of.slice(0, 10))}</span>
                  <strong>{formatMoney(item.value)}</strong>
                  {change !== undefined && (
                    <small className={change < 0 ? 'negative' : 'positive'}>
                      {change >= 0 ? '+' : '−'}
                      {formatMoney(Math.abs(change))}
                    </small>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="page-description">No valuation snapshots have been saved yet.</p>
        )}
        <div className="composer-actions">
          <button className="button" type="button" onClick={onClose}>
            Close
          </button>
          <button className="button button-primary" type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </section>
    </div>
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
  const [showArchived, setShowArchived] = useState(false);
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
          <div className="asset-group-heading-actions">
            <button
              className="text-button"
              type="button"
              onClick={() => setShowArchived((value) => !value)}
            >
              {showArchived ? 'Show active' : 'Show archived'}
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => setCreating((value) => !value)}
            >
              <Plus size={14} /> Add group
            </button>
          </div>
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
      {groups.some((group) => Boolean(group.archived) === showArchived) ? (
        <div className="asset-group-grid">
          {groups
            .filter((group) => Boolean(group.archived) === showArchived)
            .map((group) => (
              <AssetGroupCard
                key={group.id}
                group={group}
                allPositions={positions.filter((position) => position.group === group.id)}
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
  allPositions,
  positions,
  onRefresh,
}: {
  group: AssetGroup;
  allPositions: AssetPosition[];
  positions: AssetPosition[];
  onRefresh: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [targetSalePrice, setTargetSalePrice] = useState('');
  const [editingPosition, setEditingPosition] = useState<AssetPosition | null>(null);
  const [positionName, setPositionName] = useState('');
  const [positionValue, setPositionValue] = useState('');
  const [positionPurchasePrice, setPositionPurchasePrice] = useState('');
  const [positionTargetSalePrice, setPositionTargetSalePrice] = useState('');
  const [groupName, setGroupName] = useState(group.name);
  const [editingGroup, setEditingGroup] = useState(false);
  const [groupBusy, setGroupBusy] = useState(false);
  const [showArchivedPositions, setShowArchivedPositions] = useState(false);
  const visiblePositions = allPositions.filter(
    (position) => Boolean(position.archived) === showArchivedPositions,
  );
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
        as_of: dateKey(new Date()),
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
  const updatePosition = async (event: React.FormEvent, position: AssetPosition) => {
    event.preventDefault();
    const response = await apiFetch(`/api/finance/asset-positions/${position.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${pb.authStore.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: positionName.trim(),
        value: Number(positionValue),
        purchase_price: Number(positionPurchasePrice),
        target_sale_price: Number(positionTargetSalePrice),
        as_of: dateKey(new Date()),
      }),
    });
    if (!response.ok) {
      window.alert((await response.text()) || 'Could not update holding.');
      return;
    }
    setEditingPosition(null);
    onRefresh();
  };
  const archivePosition = async (position: AssetPosition) => {
    const response = await apiFetch(`/api/finance/asset-positions/${position.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${pb.authStore.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ archived: !position.archived }),
    });
    if (!response.ok) {
      window.alert((await response.text()) || 'Could not update holding status.');
      return;
    }
    onRefresh();
  };
  const deletePosition = async (position: AssetPosition) => {
    if (!window.confirm(`Delete ${position.name}? This cannot be undone.`)) return;
    const response = await apiFetch(`/api/finance/asset-positions/${position.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${pb.authStore.token}` },
    });
    if (!response.ok) {
      window.alert((await response.text()) || 'Could not delete holding.');
      return;
    }
    onRefresh();
  };
  const saveGroupName = async (event: React.FormEvent) => {
    event.preventDefault();
    setGroupBusy(true);
    const response = await apiFetch(`/api/finance/asset-groups/${group.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${pb.authStore.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: groupName.trim() }),
    });
    setGroupBusy(false);
    if (!response.ok) {
      window.alert((await response.text()) || 'Could not rename group.');
      return;
    }
    setEditingGroup(false);
    onRefresh();
  };
  const archiveGroup = async () => {
    const response = await apiFetch(`/api/finance/asset-groups/${group.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${pb.authStore.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ archived: !group.archived }),
    });
    if (!response.ok) {
      window.alert((await response.text()) || 'Could not update group status.');
      return;
    }
    onRefresh();
  };
  const deleteGroup = async () => {
    if (allPositions.length) {
      window.alert('Delete this group’s holdings before deleting the group.');
      return;
    }
    if (!window.confirm(`Delete ${group.name}? This cannot be undone.`)) return;
    const response = await apiFetch(`/api/finance/asset-groups/${group.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${pb.authStore.token}` },
    });
    if (!response.ok) {
      window.alert((await response.text()) || 'Could not delete group.');
      return;
    }
    onRefresh();
  };
  return (
    <article className="asset-group-card">
      <header>
        <div className="asset-group-head-copy">
          {editingGroup ? (
            <form className="asset-group-rename" onSubmit={(event) => void saveGroupName(event)}>
              <input
                required
                aria-label="Asset group name"
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
              />
              <button className="text-button" type="submit" disabled={groupBusy}>
                {groupBusy ? 'Saving…' : 'Save'}
              </button>
              <button className="text-button" type="button" onClick={() => setEditingGroup(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <>
              <h3>{group.name}</h3>
              <span>
                {positions.length} active holdings{group.archived ? ' · Archived group' : ''}
              </span>
            </>
          )}
        </div>
        <div className="asset-group-actions">
          <button className="text-button" type="button" onClick={() => setEditingGroup(true)}>
            Rename
          </button>
          <button className="text-button" type="button" onClick={() => void archiveGroup()}>
            {group.archived ? 'Restore' : 'Archive'}
          </button>
          <button
            className="text-button button-danger"
            type="button"
            onClick={() => void deleteGroup()}
          >
            Delete
          </button>
          {!group.archived && (
            <button
              className="text-button"
              type="button"
              onClick={() => setAdding((open) => !open)}
            >
              <Plus size={14} /> Add holding
            </button>
          )}
        </div>
      </header>
      <button
        className="text-button asset-archived-toggle"
        type="button"
        onClick={() => setShowArchivedPositions((current) => !current)}
      >
        {showArchivedPositions ? 'Show active holdings' : 'Show archived holdings'}
      </button>
      {visiblePositions.map((position) => (
        <div className="asset-position" key={position.id}>
          {editingPosition?.id === position.id ? (
            <form
              className="asset-position-edit"
              onSubmit={(event) => void updatePosition(event, position)}
            >
              <input
                required
                aria-label="Holding name"
                value={positionName}
                onChange={(event) => setPositionName(event.target.value)}
              />
              <input
                required
                aria-label="Current value"
                type="number"
                min="0"
                step="0.01"
                value={positionValue}
                onChange={(event) => setPositionValue(event.target.value)}
              />
              <input
                required
                aria-label="Purchase value"
                type="number"
                min="0"
                step="0.01"
                value={positionPurchasePrice}
                onChange={(event) => setPositionPurchasePrice(event.target.value)}
              />
              <input
                required
                aria-label="Target sale value"
                type="number"
                min="0"
                step="0.01"
                value={positionTargetSalePrice}
                onChange={(event) => setPositionTargetSalePrice(event.target.value)}
              />
              <button className="text-button" type="submit">
                Save
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => setEditingPosition(null)}
              >
                Cancel
              </button>
            </form>
          ) : (
            <>
              <strong>{position.name}</strong>
              <span>
                {position.costKnown === false
                  ? 'Buy value not set'
                  : `Buy ${formatMoney(position.purchasePrice)}`}
                {' · Sell '}
                {formatMoney(position.targetSalePrice)}
                {position.asOf
                  ? ` · Value date ${formatDate(position.asOf)}`
                  : ' · Value date not set'}
              </span>
              <b>{formatMoney(position.value)}</b>
              <div className="asset-position-actions">
                <button
                  className="text-button"
                  type="button"
                  onClick={() => {
                    setEditingPosition(position);
                    setPositionName(position.name);
                    setPositionValue(String(position.value));
                    setPositionPurchasePrice(String(position.purchasePrice));
                    setPositionTargetSalePrice(String(position.targetSalePrice));
                  }}
                >
                  Edit holding
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => void archivePosition(position)}
                >
                  {position.archived ? 'Restore' : 'Archive'}
                </button>
                <button
                  className="text-button button-danger"
                  type="button"
                  onClick={() => void deletePosition(position)}
                >
                  Delete
                </button>
              </div>
            </>
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

function GoalsView({
  data,
  onRefresh,
  onOpenTransaction,
}: {
  data: BudgetData;
  onRefresh: () => void;
  onOpenTransaction: (transaction: Transaction) => void;
}) {
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [composerGoal, setComposerGoal] = useState<Goal | null | undefined>(undefined);
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
  const [contributionType, setContributionType] = useState<GoalContribution['type'] | null>(null);
  const [recurringGoalOpen, setRecurringGoalOpen] = useState(false);
  const goals = data.goals.filter((goal) => !goal.archived);
  useEffect(() => {
    if (!selectedGoal) return;
    setSelectedGoal(data.goals.find((goal) => goal.id === selectedGoal.id) ?? null);
  }, [data.goals, selectedGoal?.id]);
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
  const saveContribution = async (
    goal: Goal,
    values: {
      type: GoalContribution['type'];
      amount: string;
      date: string;
      account: string;
      transaction: string;
      notes: string;
    },
  ) => {
    const response = await apiFetch(`/api/finance/goals/${goal.id}/contributions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: values.type,
        amount: Number(values.amount),
        date: values.date,
        account: values.account,
        transaction: values.transaction,
        notes: values.notes,
      }),
    });
    if (!response.ok) {
      throw new Error((await response.text()) || 'Could not save the goal contribution.');
    }
    setContributionType(null);
    onRefresh();
  };
  const saveRecurringContribution = async (
    goal: Goal,
    values: {
      amount: string;
      account: string;
      frequency: RecurringGoalContribution['frequency'];
      interval: string;
      startDate: string;
      endDate: string;
      notes: string;
    },
  ) => {
    const response = await apiFetch(`/api/finance/goals/${goal.id}/recurring-contributions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: Number(values.amount),
        account: values.account,
        frequency: values.frequency,
        interval: Number(values.interval),
        start_date: values.startDate,
        end_date: values.endDate,
        notes: values.notes,
      }),
    });
    if (!response.ok) {
      throw new Error((await response.text()) || 'Could not schedule this contribution.');
    }
    setRecurringGoalOpen(false);
    onRefresh();
  };
  const updateRecurringContribution = async (
    schedule: RecurringGoalContribution,
    active?: boolean,
  ) => {
    if (active === undefined && !window.confirm('Delete this recurring contribution schedule?')) {
      return;
    }
    const response = await apiFetch(`/api/finance/recurring-goal-contributions/${schedule.id}`, {
      method: active === undefined ? 'DELETE' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      ...(active === undefined ? {} : { body: JSON.stringify({ active }) }),
    });
    if (!response.ok) {
      window.alert((await response.text()) || 'Could not update the recurring contribution.');
      return;
    }
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
              {formatMoney(goals.reduce((sum, goal) => sum + goal.current, 0))} saved toward your
              goals
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
        <GoalComposer
          goal={composerGoal}
          onClose={() => setComposerGoal(undefined)}
          onSave={saveGoal}
        />
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
          contributions={data.goalContributions.filter((item) => item.goalId === selectedGoal.id)}
          recurringContributions={data.recurringGoalContributions.filter(
            (item) => item.goalId === selectedGoal.id,
          )}
          accounts={data.accounts}
          transactions={data.transactions}
          onAddContribution={setContributionType}
          onAddRecurringContribution={() => setRecurringGoalOpen(true)}
          onUpdateRecurringContribution={updateRecurringContribution}
          onOpenTransaction={(transaction) => {
            setSelectedGoal(null);
            onOpenTransaction(transaction);
          }}
        />
      )}
      {contributionType && selectedGoal && (
        <GoalContributionDialog
          goal={selectedGoal}
          type={contributionType}
          accounts={data.accounts}
          transactions={data.transactions}
          onClose={() => setContributionType(null)}
          onSave={(values) => saveContribution(selectedGoal, values)}
        />
      )}
      {recurringGoalOpen && selectedGoal && (
        <RecurringGoalContributionDialog
          goal={selectedGoal}
          accounts={data.accounts}
          onClose={() => setRecurringGoalOpen(false)}
          onSave={(values) => saveRecurringContribution(selectedGoal, values)}
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
  const [deadline, setDeadline] = useState(
    goal?.deadline === 'No deadline' ? '' : (goal?.deadline ?? ''),
  );
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
          <input
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
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
          <input
            type="date"
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
          />
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
          <textarea
            rows={3}
            maxLength={1000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="composer-actions">
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save goal'}
          </button>
        </div>
      </form>
    </div>
  );
}

function GoalContributionDialog({
  goal,
  type,
  accounts,
  transactions,
  onClose,
  onSave,
}: {
  goal: Goal;
  type: GoalContribution['type'];
  accounts: Account[];
  transactions: Transaction[];
  onClose: () => void;
  onSave: (values: {
    type: GoalContribution['type'];
    amount: string;
    date: string;
    account: string;
    transaction: string;
    notes: string;
  }) => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(dateKey(new Date()));
  const [account, setAccount] = useState('');
  const [transaction, setTransaction] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave({ type, amount, date, account, transaction, notes: notes.trim() });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this entry.');
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
        aria-labelledby="goal-contribution-title"
      >
        <div className="composer-heading">
          <div>
            <h2 id="goal-contribution-title">
              {type === 'contribution' ? 'Add contribution' : 'Record withdrawal'}
            </h2>
            <span>{goal.name}</span>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <label>
          Amount
          <input
            required
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label>
          Date
          <input
            required
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <label>
          Linked account <small>Optional</small>
          <select value={account} onChange={(event) => setAccount(event.target.value)}>
            <option value="">No linked account</option>
            {accounts
              .filter((item) => !item.archived)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Linked transaction <small>Optional</small>
          <select value={transaction} onChange={(event) => setTransaction(event.target.value)}>
            <option value="">No linked transaction</option>
            {transactions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.date} · {item.merchant} · {formatMoney(item.amount)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Notes
          <textarea
            rows={3}
            maxLength={1000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="composer-actions">
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : type === 'contribution' ? 'Save contribution' : 'Save withdrawal'}
          </button>
        </div>
      </form>
    </div>
  );
}

function RecurringGoalContributionDialog({
  goal,
  accounts,
  onClose,
  onSave,
}: {
  goal: Goal;
  accounts: Account[];
  onClose: () => void;
  onSave: (values: {
    amount: string;
    account: string;
    frequency: RecurringGoalContribution['frequency'];
    interval: string;
    startDate: string;
    endDate: string;
    notes: string;
  }) => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [account, setAccount] = useState('');
  const [frequency, setFrequency] = useState<RecurringGoalContribution['frequency']>('monthly');
  const [interval, setInterval] = useState('1');
  const [startDate, setStartDate] = useState(dateKey(new Date()));
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave({
        amount,
        account,
        frequency,
        interval,
        startDate,
        endDate,
        notes: notes.trim(),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not schedule this contribution.');
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
        aria-labelledby="recurring-goal-title"
      >
        <div className="composer-heading">
          <div>
            <h2 id="recurring-goal-title">Schedule contributions</h2>
            <span>{goal.name}</span>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <label>
          Amount each time
          <input
            required
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            Repeat
            <select
              value={frequency}
              onChange={(event) =>
                setFrequency(event.target.value as RecurringGoalContribution['frequency'])
              }
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
          <label>
            Every
            <input
              required
              type="number"
              min="1"
              max="365"
              step="1"
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
            />
          </label>
        </div>
        <label>
          Linked account <small>Optional</small>
          <select value={account} onChange={(event) => setAccount(event.target.value)}>
            <option value="">No linked account</option>
            {accounts
              .filter((item) => !item.archived)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            First contribution
            <input
              required
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label>
            Stop after <small>Optional</small>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
        </div>
        <label>
          Notes
          <textarea
            rows={2}
            maxLength={1000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="composer-actions">
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Schedule contributions'}
          </button>
        </div>
      </form>
    </div>
  );
}

function GoalDetails({
  goal,
  contributions,
  recurringContributions,
  accounts,
  transactions,
  onClose,
  onEdit,
  onDelete,
  onArchive,
  onPause,
  onAddContribution,
  onAddRecurringContribution,
  onUpdateRecurringContribution,
  onOpenTransaction,
}: {
  goal: Goal;
  contributions: GoalContribution[];
  recurringContributions: RecurringGoalContribution[];
  accounts: Account[];
  transactions: Transaction[];
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onPause: () => void;
  onAddContribution: (type: GoalContribution['type']) => void;
  onAddRecurringContribution: () => void;
  onUpdateRecurringContribution: (schedule: RecurringGoalContribution, active?: boolean) => void;
  onOpenTransaction: (transaction: Transaction) => void;
}) {
  const progress =
    goal.target > 0 ? Math.min(100, Math.max(0, (goal.current / goal.target) * 100)) : 0;
  const overdue =
    goal.deadline !== 'No deadline' &&
    goal.deadline < new Date().toISOString().slice(0, 10) &&
    goal.status !== 'completed';
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
        <section className="goal-contribution-history" aria-label="Contribution history">
          <div className="goal-history-heading">
            <strong>Contribution history</strong>
            {!goal.archived && (
              <div>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => onAddContribution('contribution')}
                >
                  <Plus size={13} /> Add
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => onAddContribution('withdrawal')}
                >
                  Withdraw
                </button>
              </div>
            )}
          </div>
          {contributions.length ? (
            contributions.slice(0, 8).map((entry) => {
              const linkedTransaction = transactions.find(
                (item) => item.id === entry.transactionId,
              );
              const linkedAccount = accounts.find((item) => item.id === entry.accountId);
              return (
                <div className="goal-history-row" key={entry.id}>
                  <span>
                    <strong>{entry.type === 'contribution' ? 'Contribution' : 'Withdrawal'}</strong>
                    <small>
                      {formatDate(entry.date)}
                      {linkedAccount ? ` · ${linkedAccount.name}` : ''}
                    </small>
                    {entry.notes && <small>{entry.notes}</small>}
                  </span>
                  <div>
                    <b className={entry.type === 'withdrawal' ? 'is-withdrawal' : ''}>
                      {entry.type === 'withdrawal' ? '−' : '+'}
                      {formatMoney(entry.amount)}
                    </b>
                    {linkedTransaction && (
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => onOpenTransaction(linkedTransaction)}
                      >
                        View transaction
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <p className="page-description">No contributions have been recorded yet.</p>
          )}
        </section>
        <section className="goal-contribution-history" aria-label="Recurring contributions">
          <div className="goal-history-heading">
            <strong>Recurring contributions</strong>
            {!goal.archived && goal.status !== 'paused' && goal.status !== 'completed' && (
              <button className="text-button" type="button" onClick={onAddRecurringContribution}>
                <Plus size={13} /> Schedule
              </button>
            )}
          </div>
          {recurringContributions.length ? (
            recurringContributions.map((schedule) => {
              const account = accounts.find((item) => item.id === schedule.accountId);
              const unit = {
                daily: 'day',
                weekly: 'week',
                monthly: 'month',
                yearly: 'year',
              }[schedule.frequency];
              const cadence = `${schedule.interval > 1 ? `${schedule.interval} ` : ''}${unit}${schedule.interval > 1 ? 's' : ''}`;
              return (
                <div className="goal-history-row" key={schedule.id}>
                  <span>
                    <strong>
                      {formatMoney(schedule.amount)} every {cadence}
                    </strong>
                    <small>
                      {schedule.active ? `Next ${formatDate(schedule.nextDate)}` : 'Paused'}
                      {account ? ` · ${account.name}` : ''}
                      {schedule.endDate ? ` · Ends ${formatDate(schedule.endDate)}` : ''}
                    </small>
                  </span>
                  <div>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => onUpdateRecurringContribution(schedule, !schedule.active)}
                    >
                      {schedule.active ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      className="text-button button-danger"
                      type="button"
                      onClick={() => onUpdateRecurringContribution(schedule)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="page-description">No recurring contributions are scheduled.</p>
          )}
        </section>
        <div className="goal-detail-actions">
          <button className="button button-primary" type="button" onClick={onEdit}>
            Edit goal
          </button>
          {!goal.archived && (
            <button className="button" type="button" onClick={onPause}>
              {goal.status === 'paused' ? 'Resume' : 'Pause'}
            </button>
          )}
          <button className="button" type="button" onClick={onArchive}>
            {goal.archived ? 'Restore' : 'Archive'}
          </button>
          <button className="button button-danger" type="button" onClick={onDelete}>
            Delete
          </button>
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
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [viewingTransaction, setViewingTransaction] = useState<Transaction | null>(null);
  const [recordDetailsTarget, setRecordDetailsTarget] = useState<FinanceRecordTarget | null>(null);
  const [pendingDeletions, setPendingDeletions] = useState<PendingDeletion[]>([]);
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
    setEditingBudget(null);
    setPreferredAccountId(null);
  };
  const saved = () => {
    closeComposer();
    onRefresh();
  };
  const scheduleDeletion = (name: string, execute: () => Promise<void>) => {
    const pending: PendingDeletion = {
      key: crypto.randomUUID(),
      name,
      timer: 0,
      execute,
    };
    pending.timer = window.setTimeout(() => {
      void pending.execute().catch(() => window.alert(`Could not delete ${pending.name}.`));
      setPendingDeletions((current) => current.filter((item) => item.key !== pending.key));
    }, 8000);
    setPendingDeletions((current) => [...current, pending]);
  };
  const undoDeletion = (key: string) => {
    const pending = pendingDeletions.find((item) => item.key === key);
    if (!pending) return;
    window.clearTimeout(pending.timer);
    setPendingDeletions((current) => current.filter((item) => item.key !== key));
  };
  const deleteRecord = async (
    resource: 'transactions' | 'assets' | 'budgets',
    id: string,
    name: string,
  ) => {
    if (!window.confirm(`Delete ${name}? You can undo this for 8 seconds.`)) return;
    scheduleDeletion(name, async () => {
      const response = await apiFetch(`/api/finance/${resource}/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${pb.authStore.token}` },
      });
      if (!response.ok) {
        window.alert((await response.text()) || `Could not delete ${name}.`);
        return;
      }
      onRefresh();
    });
  };
  const toggleTransactionCleared = async (transaction: Transaction) => {
    const response = await apiFetch(`/api/finance/transactions/${transaction.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${pb.authStore.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cleared: !transaction.cleared }),
    });
    if (!response.ok) {
      window.alert((await response.text()) || 'Could not update the cleared status.');
      return;
    }
    onRefresh();
  };
  const deleteTransaction = async (transaction: Transaction) => {
    if (!transaction.splitGroup) {
      await deleteRecord('transactions', transaction.id, transaction.merchant);
      return;
    }
    if (
      !window.confirm(
        `Delete all parts of ${transaction.merchant}? You can undo this for 8 seconds.`,
      )
    ) {
      return;
    }
    scheduleDeletion(transaction.merchant, async () => {
      const response = await apiFetch(
        `/api/finance/transactions/splits/${encodeURIComponent(transaction.splitGroup!)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${pb.authStore.token}` },
        },
      );
      if (!response.ok) {
        window.alert((await response.text()) || 'Could not delete the split transaction.');
        return;
      }
      onRefresh();
    });
  };
  const archiveBudget = async (budget: Budget) => {
    const archived = !budget.archived;
    const response = await apiFetch(`/api/finance/budgets/${budget.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${pb.authStore.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ archived }),
    });
    if (!response.ok) {
      window.alert(
        (await response.text()) || `Could not ${archived ? 'archive' : 'restore'} this budget.`,
      );
      return;
    }
    onRefresh();
  };
  const duplicateTransaction = async (transaction: Transaction) => {
    const transferPeer = transaction.transferId
      ? data.transactions.find(
          (item) => item.transferId === transaction.transferId && item.id !== transaction.id,
        )
      : undefined;
    if (transaction.kind === 'transfer' && !transferPeer) {
      window.alert('This transfer is missing its paired account entry. Refresh and try again.');
      return;
    }
    const isSource = transaction.kind !== 'transfer' || (transaction.signedAmount ?? -1) < 0;
    const response = await apiFetch(
      transaction.kind === 'transfer' ? '/api/finance/transfers' : '/api/finance/transactions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pb.authStore.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          transaction.kind === 'transfer'
            ? {
                source_account: isSource ? transaction.accountId : transferPeer?.accountId,
                destination_account: isSource ? transferPeer?.accountId : transaction.accountId,
                date: transaction.date,
                amount: transaction.amount,
                notes: transaction.note ?? transaction.description ?? '',
              }
            : {
                account: transaction.accountId,
                date: transaction.date,
                amount:
                  transaction.signedAmount ??
                  (transaction.kind === 'expense' ? -transaction.amount : transaction.amount),
                type: transaction.kind,
                payee: transaction.merchant,
                description: transaction.description ?? '',
                category: transaction.category,
                budget: transaction.budgetId ?? '',
                tags: transaction.tags ?? [],
                notes: transaction.note ?? '',
              },
        ),
      },
    );
    if (!response.ok) {
      window.alert((await response.text()) || 'Could not duplicate this transaction.');
      return;
    }
    onRefresh();
  };
  const renameReceivable = async (person: string, nextName: string) => {
    if (!nextName.trim() || nextName.trim() === person) return false;
    const related = data.transactions.filter(
      (transaction) => transaction.receivable?.trim() === person,
    );
    try {
      const results = await Promise.all(
        related.map((transaction) =>
          apiFetch(`/api/finance/transactions/${transaction.id}`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${pb.authStore.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ receivable: nextName.trim() }),
          }),
        ),
      );
      const failed = results.find((response) => !response.ok);
      if (failed) {
        window.alert((await failed.text()) || 'Could not update every linked transaction.');
        onRefresh();
        return false;
      }
      onRefresh();
      return true;
    } catch {
      window.alert(
        'Could not update every linked transaction. Refresh to check the current names.',
      );
      onRefresh();
      return false;
    }
  };
  const content =
    view === 'dashboard' ? (
      <DashboardView
        data={data}
        profile={profile}
        onNavigate={onNavigate}
        onAddTransaction={() => setComposer('transaction')}
        onAddAccount={() => setComposer('account')}
        onAddCheckpoint={() => setComposer('checkpoint')}
        onOpenTransaction={setViewingTransaction}
        onEditTransaction={(transaction) => {
          setEditingTransaction(transaction);
          setComposer('transaction');
        }}
        onDeleteTransaction={(transaction) => void deleteTransaction(transaction)}
        onDuplicateTransaction={(transaction) => void duplicateTransaction(transaction)}
        onToggleCleared={(transaction) => void toggleTransactionCleared(transaction)}
        onOpenBudget={(budget) => setRecordDetailsTarget({ type: 'budget', id: budget.id })}
      />
    ) : view === 'transactions' ? (
      <TransactionsView
        data={data}
        userId={userId}
        remote={remote}
        onAddTransaction={() => setComposer('transaction')}
        onAddCheckpoint={() => setComposer('checkpoint')}
        onAddAccount={() => setComposer('account')}
        onEditTransaction={(transaction) => {
          setEditingTransaction(transaction);
          setComposer('transaction');
        }}
        onDeleteTransaction={(transaction) => void deleteTransaction(transaction)}
        onToggleCleared={(transaction) => void toggleTransactionCleared(transaction)}
        onOpenTransaction={setViewingTransaction}
        onRenameReceivable={renameReceivable}
        onRefresh={onRefresh}
      />
    ) : view === 'budgets' ? (
      <BudgetsView
        userId={userId}
        data={data}
        onAddBudget={() => {
          setEditingBudget(null);
          setComposer('budget');
        }}
        onEditBudget={(budget) => {
          setEditingBudget(budget);
          setComposer('budget');
        }}
        onArchiveBudget={(budget) => void archiveBudget(budget)}
        onDeleteBudget={(budget) => void deleteRecord('budgets', budget.id, budget.category)}
        onOpenTransaction={setViewingTransaction}
        onAddTransactionForAccount={(accountId) => {
          setPreferredAccountId(accountId || null);
          setEditingTransaction(null);
          setComposer('transaction');
        }}
        onRecordCheckpoint={(accountId) => {
          setPreferredAccountId(accountId);
          setComposer('checkpoint');
        }}
        onOpenBudget={(budget) => setRecordDetailsTarget({ type: 'budget', id: budget.id })}
      />
    ) : view === 'assets' ? (
      <AssetsView
        userId={userId}
        data={data}
        remote={remote}
        onRefresh={onRefresh}
        onAddAsset={() => setComposer('asset')}
        onEditAsset={(asset) => {
          setEditingAsset(asset);
          setComposer('asset');
        }}
        onDeleteAsset={(asset) => void deleteRecord('assets', asset.id, asset.name)}
      />
    ) : view === 'goals' ? (
      <GoalsView data={data} onRefresh={onRefresh} onOpenTransaction={setViewingTransaction} />
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
      {pendingDeletions.length > 0 && (
        <div className="delete-undo-region" aria-live="polite">
          {pendingDeletions.map((pending) => (
            <div className="delete-undo-toast" role="status" key={pending.key}>
              <span>{pending.name} will be deleted shortly.</span>
              <button
                className="text-button"
                type="button"
                onClick={() => undoDeletion(pending.key)}
              >
                Undo
              </button>
            </div>
          ))}
        </div>
      )}
      {composer && (
        <FinanceComposer
          kind={composer}
          data={data}
          remote={remote}
          transaction={editingTransaction}
          asset={editingAsset}
          budgetRecord={editingBudget}
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

async function uploadTransactionFiles(
  transactionId: string,
  files: File[],
  onProgress?: (percent: number) => void,
) {
  if (!files.length) return;
  validateTransactionFiles(files);
  const body = new FormData();
  files.forEach((file) => body.append('files', file));
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${apiBaseUrl()}/api/finance/transactions/${transactionId}/attachments`);
    request.setRequestHeader('Authorization', `Bearer ${pb.authStore.token}`);
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        if (request.status === 401) pb.authStore.clear();
        reject(new Error(request.responseText || 'Could not upload transaction images.'));
      }
    });
    request.addEventListener('error', () =>
      reject(new Error('Network error while uploading images.')),
    );
    request.addEventListener('abort', () => reject(new Error('Image upload was cancelled.')));
    request.send(body);
  });
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
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(remote);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deletingAttachment, setDeletingAttachment] = useState<string | null>(null);
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
    try {
      validateTransactionFiles(files);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not upload transaction images.');
      return;
    }
    setPendingFiles(files);
    setUploading(true);
    setUploadProgress(0);
    setError('');
    try {
      await uploadTransactionFiles(transaction.id, files, setUploadProgress);
      setPendingFiles([]);
      await loadAttachments();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not upload transaction images.');
    } finally {
      setUploading(false);
    }
  };
  const removeAttachment = async (attachment: TransactionAttachment) => {
    setDeletingAttachment(attachment.id);
    setError('');
    try {
      const response = await apiFetch(
        `/api/finance/transactions/${transaction.id}/attachments/${attachment.id}`,
        { method: 'DELETE' },
      );
      if (!response.ok)
        throw new Error((await response.text()) || 'Could not remove this picture.');
      setAttachments((items) => items.filter((item) => item.id !== attachment.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove this picture.');
    } finally {
      setDeletingAttachment(null);
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
        {transaction.receipt && !transaction.receipt.startsWith('data:image/') && (
          <div className="transaction-detail-receipt">
            <strong>Receipt</strong>
            <a href={transaction.receipt} download={`receipt-${transaction.id}`}>
              Download receipt
            </a>
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
                <div key={attachment.id}>
                  <a href={attachment.url} download={attachment.file}>
                    <img src={attachment.url} alt={`Attachment for ${transaction.merchant}`} />
                  </a>
                  <button
                    className="text-button"
                    type="button"
                    disabled={deletingAttachment === attachment.id}
                    onClick={() => void removeAttachment(attachment)}
                  >
                    {deletingAttachment === attachment.id ? 'Removing…' : 'Remove picture'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p>No pictures attached.</p>
          )}
          {uploading && <p role="status">Uploading pictures: {uploadProgress}%</p>}
          {!uploading && pendingFiles.length > 0 && (
            <div className="transaction-upload-retry" role="status">
              <span>Upload failed. {pendingFiles.length} picture(s) are ready to retry.</span>
              <button
                className="text-button"
                type="button"
                onClick={() => void upload(pendingFiles)}
              >
                Retry upload
              </button>
              <button className="text-button" type="button" onClick={() => setPendingFiles([])}>
                Clear
              </button>
            </div>
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

function TransactionCsvSettings({
  data,
  remote,
  onRefresh,
}: {
  data: BudgetData;
  remote: boolean;
  onRefresh: () => void;
}) {
  const [importingCsv, setImportingCsv] = useState(false);
  const [csvMessage, setCsvMessage] = useState('');
  const exportCsv = () => {
    const blob = new Blob([transactionCsv(data.transactions)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'piggybudget-transactions.csv';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const importCsv = async (file: File) => {
    setImportingCsv(true);
    setCsvMessage('');
    try {
      const rows = parseCsvRows(await file.text());
      const headers = rows.shift()?.map((header) => header.trim().toLowerCase()) ?? [];
      const column = (name: string) => headers.indexOf(name);
      if (
        column('date') < 0 ||
        column('payee') < 0 ||
        column('amount') < 0 ||
        column('account') < 0
      ) {
        setCsvMessage('CSV needs date, payee, amount, and account columns.');
        return;
      }
      let imported = 0;
      const failures: string[] = [];
      const importedTransfers = new Set<string>();
      for (const [index, row] of rows.entries()) {
        const accountValue = row[column('account')]?.trim() ?? '';
        const account = data.accounts.find(
          (item) =>
            item.id === accountValue || item.name.toLowerCase() === accountValue.toLowerCase(),
        );
        const date = row[column('date')]?.trim() ?? '';
        const parsedDate = new Date(`${date}T00:00:00Z`);
        const amount = Number(row[column('amount')]);
        const suppliedType = column('type') >= 0 ? row[column('type')]?.trim().toLowerCase() : '';
        const type = suppliedType || (amount < 0 ? 'expense' : 'income');
        if (type === 'transfer') {
          const transferId =
            column('transfer_id') >= 0 ? (row[column('transfer_id')]?.trim() ?? '') : '';
          if (importedTransfers.has(transferId)) continue;
          if (!transferId) {
            failures.push(String(index + 2));
            continue;
          }
          const peerIndex = rows.findIndex(
            (candidate) =>
              candidate !== row && candidate[column('transfer_id')]?.trim() === transferId,
          );
          const peer = peerIndex >= 0 ? rows[peerIndex] : undefined;
          const peerAmount = Number(peer?.[column('amount')]);
          const peerAccountValue = peer?.[column('account')]?.trim() ?? '';
          const peerAccount = data.accounts.find(
            (item) =>
              item.id === peerAccountValue ||
              item.name.toLowerCase() === peerAccountValue.toLowerCase(),
          );
          if (
            !account ||
            !peerAccount ||
            !peer ||
            account.id === peerAccount.id ||
            !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
            parsedDate.toISOString().slice(0, 10) !== date ||
            !Number.isFinite(amount) ||
            !Number.isFinite(peerAmount) ||
            amount === 0 ||
            peerAmount === 0 ||
            Math.sign(amount) === Math.sign(peerAmount)
          ) {
            failures.push(String(index + 2));
            importedTransfers.add(transferId);
            continue;
          }
          const source = amount < 0 ? account : peerAccount;
          const destination = amount < 0 ? peerAccount : account;
          const response = await apiFetch('/api/finance/transfers', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${pb.authStore.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              source_account: source.id,
              destination_account: destination.id,
              date,
              amount: Math.abs(amount),
              notes: column('notes') >= 0 ? (row[column('notes')]?.trim() ?? '') : '',
            }),
          });
          importedTransfers.add(transferId);
          if (response.ok) imported += 2;
          else failures.push(String(index + 2));
          continue;
        }
        if (
          !account ||
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          Number.isNaN(parsedDate.getTime()) ||
          parsedDate.toISOString().slice(0, 10) !== date ||
          !Number.isFinite(amount) ||
          amount === 0 ||
          !['expense', 'income', 'adjustment'].includes(type)
        ) {
          failures.push(String(index + 2));
          continue;
        }
        const response = await apiFetch('/api/finance/transactions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${pb.authStore.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            account: account.id,
            date,
            amount: type === 'expense' ? -Math.abs(amount) : amount,
            type,
            payee: row[column('payee')]?.trim() || 'Imported transaction',
            category: column('category') >= 0 ? (row[column('category')]?.trim() ?? '') : '',
            notes: column('notes') >= 0 ? (row[column('notes')]?.trim() ?? '') : '',
          }),
        });
        if (response.ok) imported += 1;
        else failures.push(String(index + 2));
      }
      setCsvMessage(
        failures.length
          ? `Imported ${imported}; skipped or failed rows ${failures.slice(0, 8).join(', ')}${failures.length > 8 ? ', …' : ''}.`
          : `Imported ${imported} transactions.`,
      );
      if (imported) onRefresh();
    } catch {
      setCsvMessage('Could not read this CSV file. Check the file and try again.');
    } finally {
      setImportingCsv(false);
    }
  };
  return (
    <article className="panel settings-card transaction-csv-settings">
      <div className="small-panel-icon">
        <ArrowRightLeft size={17} />
      </div>
      <div className="transaction-csv-settings-content">
        <h3>Transaction CSV</h3>
        <p>Import transactions from a CSV file or export all your transactions.</p>
        <div className="transaction-csv-actions">
          <button
            className="button"
            type="button"
            onClick={exportCsv}
            disabled={!remote || !data.transactions.length}
          >
            Export CSV
          </button>
          <label className={`button transaction-import-trigger ${remote ? '' : 'is-disabled'}`}>
            {importingCsv ? 'Importing…' : 'Import CSV'}
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="Import transactions from CSV"
              disabled={!remote || importingCsv}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importCsv(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
        </div>
        <p className="transaction-csv-help">
          CSV columns: date, payee, amount, and account. Optional columns: type, category, and
          notes. Account can be its name or ID. Transfer rows need both entries with the same
          transfer_id.
        </p>
        {csvMessage && (
          <p className="page-description csv-import-status" role="status">
            {csvMessage}
          </p>
        )}
      </div>
    </article>
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
            <button className="text-button" type="button" onClick={() => setProfileOpen(true)}>
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
        <TransactionCsvSettings data={data} remote={remote} onRefresh={onRefresh} />
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
            <button className="text-button" type="button" onClick={() => setPreferencesOpen(true)}>
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
  const asset =
    target.type === 'asset' ? data.assets.find((item) => item.id === target.id) : undefined;
  const goal =
    target.type === 'goal' ? data.goals.find((item) => item.id === target.id) : undefined;
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
            <DetailRow
              label="Amount"
              value={`${(transaction.signedAmount ?? (transaction.kind === 'income' ? 1 : -1)) >= 0 ? '+' : '−'}${formatMoney(transaction.amount)}`}
            />
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
                <span>
                  {item.merchant} · {formatDate(item.date)}
                </span>
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
        if (!unset.ok)
          throw new Error((await unset.text()) || 'Could not update the default account.');
      }
    }
    const response = await apiFetch(`/api/finance/accounts/${account.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!response.ok)
      throw new Error((await response.text()) || `Could not update ${account.name}.`);
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
      <section
        className="composer-card account-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="accounts-settings-title"
      >
        <div className="composer-heading">
          <div>
            <h2 id="accounts-settings-title">Accounts</h2>
            <span>Manage account details, defaults, balances, and checkpoints.</span>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {!remote && (
          <p className="page-description">
            Saved accounts are unavailable. Refresh after your connection returns to manage them.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="account-manager-list">
          {accounts.length ? (
            accounts.map((account) => (
              <article
                className={`account-manager-row ${account.archived ? 'is-archived' : ''}`}
                key={account.id}
              >
                <div className="account-manager-copy">
                  <strong>
                    {account.name}
                    {account.isDefault ? ' · Default' : ''}
                  </strong>
                  <span>
                    {account.type} · {account.currency ?? 'USD'}
                    {account.archived ? ' · Archived' : ''}
                  </span>
                  <b>{formatMoney(account.balance)}</b>
                </div>
                <div className="account-manager-actions">
                  <button
                    className="text-button"
                    type="button"
                    disabled={!remote}
                    onClick={() => setEditing(account)}
                  >
                    Edit
                  </button>
                  {!account.isDefault && !account.archived && (
                    <button
                      className="text-button"
                      type="button"
                      disabled={!remote}
                      onClick={() => void runAccountAction(account, { is_default: true })}
                    >
                      Set default
                    </button>
                  )}
                  <button
                    className="text-button"
                    type="button"
                    disabled={!remote}
                    onClick={() =>
                      void runAccountAction(account, {
                        archived: !account.archived,
                        ...(account.isDefault ? { is_default: false } : {}),
                      })
                    }
                  >
                    {account.archived ? 'Restore' : 'Archive'}
                  </button>
                  {!account.archived && (
                    <button
                      className="text-button"
                      type="button"
                      disabled={!remote}
                      onClick={() => onRecordCheckpoint(account.id)}
                    >
                      Checkpoint
                    </button>
                  )}
                </div>
              </article>
            ))
          ) : (
            <p className="page-description">
              Add an account to track its balance and reconcile statements.
            </p>
          )}
        </div>
        <div className="composer-actions">
          <button className="button" type="button" onClick={onClose}>
            Close
          </button>
          <button
            className="button button-primary"
            type="button"
            onClick={onAddAccount}
            disabled={!remote}
          >
            Add account
          </button>
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
  const [alertBelow, setAlertBelow] = useState(String(account.alertBelow ?? ''));
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
        alert_below: Number(alertBelow) || 0,
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
          <input
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
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
          Low balance alert (optional)
          <input
            type="number"
            min="0"
            step="0.01"
            value={alertBelow}
            onChange={(event) => setAlertBelow(event.target.value)}
            placeholder="Disabled"
          />
        </label>
        <label>
          Notes
          <textarea
            rows={3}
            maxLength={1000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
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
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="composer-actions">
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save account'}
          </button>
        </div>
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
      const message =
        email.trim() !== profile.email
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
          <input
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
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
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="composer-actions">
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
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
              setDraft({
                ...draft,
                dateFormat: event.target.value as UserPreferences['dateFormat'],
              })
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
              setDraft({
                ...draft,
                numberFormat: event.target.value as UserPreferences['numberFormat'],
              })
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
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
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
              manage accounts, preferences, and transaction CSV files in Settings.
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
      return results.map((result) => result.rawValue ?? '').join('\n');
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
  budgetRecord,
  preferredAccountId,
  onClose,
  onSaved,
}: {
  kind: 'account' | 'transaction' | 'checkpoint' | 'asset' | 'budget';
  data: BudgetData;
  remote: boolean;
  transaction: Transaction | null;
  asset: Asset | null;
  budgetRecord: Budget | null;
  preferredAccountId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const transferPeer = transaction?.transferId
    ? data.transactions.find(
        (item) => item.transferId === transaction.transferId && item.id !== transaction.id,
      )
    : undefined;
  const transferSourceId =
    transaction?.kind === 'transfer' && (transaction.signedAmount ?? -1) > 0
      ? transferPeer?.accountId
      : transaction?.accountId;
  const transferDestinationId =
    transaction?.kind === 'transfer' && (transaction.signedAmount ?? -1) > 0
      ? transaction.accountId
      : transferPeer?.accountId;
  const availableAccounts = data.accounts.filter(
    (item) =>
      !item.archived || item.id === transaction?.accountId || item.id === transferPeer?.accountId,
  );
  const defaultAccount = availableAccounts.find((item) => item.isDefault) ?? availableAccounts[0];
  const [account, setAccount] = useState(
    transferSourceId ?? preferredAccountId ?? defaultAccount?.id ?? '',
  );
  const [destinationAccount, setDestinationAccount] = useState(
    transferDestinationId ??
      data.accounts.find((item) => item.id !== transferSourceId && !item.archived)?.id ??
      '',
  );
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState('Checking');
  const [currency, setCurrency] = useState(readPreferences().currency);
  const [date, setDate] = useState(
    transaction?.date ??
      asset?.purchaseDate ??
      budgetRecord?.startDate ??
      new Date().toISOString().slice(0, 10),
  );
  const [valuationDate, setValuationDate] = useState(
    asset?.asOf ?? new Date().toISOString().slice(0, 10),
  );
  const [amount, setAmount] = useState(
    transaction
      ? String(transaction.amount)
      : asset
        ? String(asset.value)
        : budgetRecord
          ? String(budgetRecord.limit)
          : '',
  );
  const [payee, setPayee] = useState(transaction?.merchant ?? '');
  const [type, setType] = useState<TransactionKind>(transaction?.kind ?? 'expense');
  const [adjustmentDirection, setAdjustmentDirection] = useState<'increase' | 'decrease'>(
    (transaction?.signedAmount ?? 1) < 0 ? 'decrease' : 'increase',
  );
  const [repeat, setRepeat] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [splitLines, setSplitLines] = useState([
    { amount: '', category: '', budget: '' },
    { amount: '', category: '', budget: '' },
  ]);
  const [repeatFrequency, setRepeatFrequency] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>(
    'monthly',
  );
  const [repeatInterval, setRepeatInterval] = useState('1');
  const [repeatEndDate, setRepeatEndDate] = useState('');
  const [note, setNote] = useState(transaction?.note ?? asset?.notes ?? budgetRecord?.notes ?? '');
  const [description, setDescription] = useState(transaction?.description ?? '');
  const [receivable, setReceivable] = useState(transaction?.receivable ?? '');
  const [purchaseTransaction, setPurchaseTransaction] = useState(asset?.purchaseTransaction ?? '');
  const [category, setCategory] = useState(transaction?.category ?? budgetRecord?.category ?? '');
  const [budget, setBudget] = useState(transaction?.budgetId ?? '');
  const [tags, setTags] = useState(transaction?.tags?.join(', ') ?? '');
  const [receipt, setReceipt] = useState(transaction?.receipt ?? '');
  const [receiptScanMessage, setReceiptScanMessage] = useState('');
  const [pictureFiles, setPictureFiles] = useState<File[]>([]);
  const [pictureUploadFailed, setPictureUploadFailed] = useState(false);
  const [savedTransactionId, setSavedTransactionId] = useState<string | null>(
    transaction?.id ?? null,
  );
  const [assetName, setAssetName] = useState(asset?.name ?? '');
  const [assetType, setAssetType] = useState(asset?.type ?? 'Other');
  const [purchasePrice, setPurchasePrice] = useState(
    String(asset?.costKnown === false ? '' : (asset?.purchasePrice ?? asset?.cost ?? '')),
  );
  const [targetSalePrice, setTargetSalePrice] = useState(String(asset?.targetSalePrice ?? ''));
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
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
    const numericAmount = Number(amount);
    if (
      kind === 'budget' &&
      data.budgets.some(
        (item) =>
          !item.archived &&
          item.id !== budgetRecord?.id &&
          item.category.trim().toLowerCase() === category.trim().toLowerCase() &&
          (!item.startDate || item.startDate.slice(0, 7) === date.slice(0, 7)),
      )
    ) {
      setError('A budget already exists for this category and month.');
      return;
    }
    if (
      kind === 'transaction' &&
      type === 'transfer' &&
      (!destinationAccount || account === destinationAccount)
    ) {
      setError('Choose two different accounts for this transfer.');
      return;
    }
    if (
      repeat &&
      (type === 'transfer' ||
        !Number.isInteger(Number(repeatInterval)) ||
        Number(repeatInterval) < 1 ||
        Number(repeatInterval) > 365)
    ) {
      setError('Choose a repeat interval from 1 to 365.');
      return;
    }
    if (splitting) {
      const splitTotal = splitLines.reduce((sum, split) => sum + Number(split.amount), 0);
      if (
        splitLines.length < 2 ||
        splitLines.some(
          (split) =>
            !split.category.trim() ||
            !Number.isFinite(Number(split.amount)) ||
            Number(split.amount) <= 0,
        )
      ) {
        setError('Add at least two split entries with an amount and category.');
        return;
      }
      if (
        !Number.isFinite(numericAmount) ||
        numericAmount <= 0 ||
        !['expense', 'income'].includes(type)
      ) {
        setError('Split an expense or income with a valid total amount.');
        return;
      }
      if (Math.round(splitTotal * 100) !== Math.round(numericAmount * 100)) {
        setError('Split amounts must add up to the transaction total.');
        return;
      }
      if (repeat || pictureFiles.length) {
        setError('Split transactions cannot repeat or include uploaded pictures.');
        return;
      }
    }
    if (repeat && pictureFiles.length) {
      setError('Remove transaction pictures before saving a recurring rule.');
      return;
    }
    setBusy(true);
    setError('');
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
                  as_of: valuationDate,
                  purchase_transaction: purchaseTransaction,
                  target_sale_price: Number(targetSalePrice) || 0,
                  currency,
                  notes: note,
                }
              : type === 'transfer'
                ? {
                    source_account: account,
                    destination_account: destinationAccount,
                    date,
                    amount: numericAmount,
                    notes: note,
                  }
                : {
                    account,
                    date,
                    amount:
                      type === 'expense' ||
                      (type === 'adjustment' && adjustmentDirection === 'decrease')
                        ? -Math.abs(numericAmount)
                        : Math.abs(numericAmount),
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
    const recurringBody =
      repeat && kind === 'transaction'
        ? {
            ...body,
            frequency: repeatFrequency,
            interval: Number(repeatInterval),
            start_date: date,
            ...(repeatEndDate ? { end_date: repeatEndDate } : {}),
          }
        : body;
    let transactionSaved = false;
    try {
      const isSplit = kind === 'transaction' && splitting && !transaction;
      const resource = isSplit
        ? 'transactions/split'
        : kind === 'account'
          ? 'accounts'
          : kind === 'budget'
            ? 'budgets'
            : kind === 'checkpoint'
              ? 'checkpoints'
              : kind === 'asset'
                ? 'assets'
                : repeat && kind === 'transaction'
                  ? 'recurring_transactions'
                  : type === 'transfer'
                    ? 'transfers'
                    : 'transactions';
      const isTransfer = kind === 'transaction' && type === 'transfer';
      const editedId =
        isSplit || (repeat && kind === 'transaction')
          ? undefined
          : isTransfer
            ? transaction?.transferId
            : kind === 'transaction'
              ? (transaction?.id ?? savedTransactionId ?? undefined)
              : kind === 'asset'
                ? asset?.id
                : kind === 'budget'
                  ? budgetRecord?.id
                  : undefined;
      if (kind === 'transaction' && pictureFiles.length) validateTransactionFiles(pictureFiles);
      const requestBody = isSplit
        ? {
            account,
            date,
            amount: numericAmount,
            type,
            payee,
            description,
            receivable,
            tags: tags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
            receipt,
            notes: note,
            splits: splitLines.map((split) => ({
              amount: Number(split.amount),
              category: split.category.trim(),
              budget: split.budget,
            })),
          }
        : recurringBody;
      const response = await apiFetch(`/api/finance/${resource}${editedId ? `/${editedId}` : ''}`, {
        method: editedId ? 'PUT' : 'POST',
        headers: {
          Authorization: `Bearer ${pb.authStore.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) throw new Error((await response.text()) || 'Could not save this record.');
      transactionSaved = kind === 'transaction';
      if (kind === 'transaction' && pictureFiles.length) {
        const savedRecord = (await response.json()) as { id: string };
        const transactionId = editedId ?? savedRecord.id;
        setSavedTransactionId(transactionId);
        setUploadProgress(0);
        await uploadTransactionFiles(transactionId, pictureFiles, setUploadProgress);
        setPictureUploadFailed(false);
      }
      beginClose(onSaved);
    } catch (caught) {
      if (transactionSaved && pictureFiles.length) setPictureUploadFailed(true);
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
            ? Boolean(account && (type !== 'transfer' || destinationAccount !== account))
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
                  ? budgetRecord
                    ? 'Edit budget'
                    : 'Create a monthly budget'
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
              Budget month
              <input
                required
                type="month"
                value={date.slice(0, 7)}
                onChange={(event) => {
                  if (event.target.value) setDate(`${event.target.value}-01`);
                }}
              />
            </label>
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
              Current value date
              <input
                required
                type="date"
                value={valuationDate}
                onChange={(event) => setValuationDate(event.target.value)}
              />
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
              {type === 'transfer' ? 'From account' : 'Account'}
              <select
                required
                value={account}
                onChange={(event) => {
                  const nextAccount = event.target.value;
                  setAccount(nextAccount);
                  if (nextAccount === destinationAccount) {
                    setDestinationAccount(
                      availableAccounts.find((item) => item.id !== nextAccount)?.id ?? '',
                    );
                  }
                }}
              >
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
                disabled={transaction?.kind === 'transfer'}
                onChange={(event) => setType(event.target.value as TransactionKind)}
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
                <option value="adjustment">Balance adjustment</option>
                {(!transaction || transaction.kind === 'transfer') && (
                  <option value="transfer">Transfer</option>
                )}
              </select>
            </label>
            {!transaction && type !== 'transfer' && (
              <label className="transaction-repeat-toggle">
                <input
                  type="checkbox"
                  checked={repeat}
                  onChange={(event) => setRepeat(event.target.checked)}
                />
                Repeat this transaction
              </label>
            )}
            {!transaction && (type === 'expense' || type === 'income') && (
              <label className="transaction-repeat-toggle">
                <input
                  type="checkbox"
                  checked={splitting}
                  onChange={(event) => setSplitting(event.target.checked)}
                />
                Split into categories
              </label>
            )}
            {splitting && (
              <section className="transaction-split-editor" aria-label="Transaction split entries">
                <div>
                  <strong>Split the total by category</strong>
                  <small>
                    Assigned{' '}
                    {formatMoney(
                      splitLines.reduce((sum, split) => sum + (Number(split.amount) || 0), 0),
                    )}
                    {' of '}
                    {formatMoney(Number(amount) || 0)}
                  </small>
                </div>
                {splitLines.map((split, index) => (
                  <div className="transaction-split-row" key={index}>
                    <label>
                      Part {index + 1}
                      <input
                        required
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={split.amount}
                        onChange={(event) =>
                          setSplitLines((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, amount: event.target.value } : item,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      Category
                      <input
                        required
                        value={split.category}
                        onChange={(event) =>
                          setSplitLines((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, category: event.target.value }
                                : item,
                            ),
                          )
                        }
                        placeholder="e.g. Groceries"
                      />
                    </label>
                    <label>
                      Budget
                      <select
                        value={split.budget}
                        onChange={(event) =>
                          setSplitLines((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, budget: event.target.value } : item,
                            ),
                          )
                        }
                      >
                        <option value="">No budget</option>
                        {data.budgets
                          .filter((item) => !item.archived)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.category}
                            </option>
                          ))}
                      </select>
                    </label>
                    {splitLines.length > 2 && (
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Remove split part ${index + 1}`}
                        onClick={() =>
                          setSplitLines((current) =>
                            current.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
                {splitLines.length < 20 && (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      setSplitLines((current) => [
                        ...current,
                        { amount: '', category: '', budget: '' },
                      ])
                    }
                  >
                    <Plus size={14} /> Add split part
                  </button>
                )}
              </section>
            )}
            {repeat && (
              <>
                <label>
                  Repeat every
                  <div className="transaction-date-filters">
                    <input
                      required
                      type="number"
                      min="1"
                      max="365"
                      step="1"
                      value={repeatInterval}
                      onChange={(event) => setRepeatInterval(event.target.value)}
                    />
                    <select
                      value={repeatFrequency}
                      onChange={(event) =>
                        setRepeatFrequency(event.target.value as typeof repeatFrequency)
                      }
                    >
                      <option value="daily">days</option>
                      <option value="weekly">weeks</option>
                      <option value="monthly">months</option>
                      <option value="yearly">years</option>
                    </select>
                  </div>
                </label>
                <label>
                  Stop after (optional)
                  <input
                    type="date"
                    min={date}
                    value={repeatEndDate}
                    onChange={(event) => setRepeatEndDate(event.target.value)}
                  />
                </label>
                <p className="page-description">
                  The first transaction is created on {formatDate(date)}.
                </p>
              </>
            )}
            {type === 'transfer' ? (
              <>
                <label>
                  To account
                  <select
                    required
                    value={destinationAccount}
                    onChange={(event) => setDestinationAccount(event.target.value)}
                  >
                    <option value="">Choose account</option>
                    {availableAccounts
                      .filter((item) => item.id !== account)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                  </select>
                </label>
                <p className="page-description">Both account balances update together.</p>
              </>
            ) : (
              <>
                {type === 'adjustment' && (
                  <label>
                    Adjustment
                    <select
                      value={adjustmentDirection}
                      onChange={(event) =>
                        setAdjustmentDirection(event.target.value as 'increase' | 'decrease')
                      }
                    >
                      <option value="increase">Increase account balance</option>
                      <option value="decrease">Decrease account balance</option>
                    </select>
                  </label>
                )}
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
                {!splitting && (
                  <>
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
                  </>
                )}
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
                {!repeat && (
                  <>
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
                              .split(/\n+/)
                              .map((line) => line.trim())
                              .filter(Boolean);
                            const amountMatch = text.match(
                              /(?:[$€£]\s*)?([0-9]+[.,][0-9]{2})\s*(?:[$€£])?/,
                            );
                            const dateMatch = text.match(
                              /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/,
                            );
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
                        onChange={(event) => {
                          setPictureFiles(Array.from(event.target.files ?? []));
                          setPictureUploadFailed(false);
                        }}
                      />
                    </label>
                    {pictureFiles.length > 0 && (
                      <p role="status">
                        {pictureUploadFailed
                          ? 'Picture upload failed. Save again to retry.'
                          : busy
                            ? `Uploading pictures: ${uploadProgress}%`
                            : `${pictureFiles.length} picture${pictureFiles.length === 1 ? '' : 's'} ready to upload.`}
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
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => setReceipt('')}
                        >
                          Remove receipt
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
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
              ? pictureFiles.length
                ? `Uploading ${uploadProgress}%…`
                : 'Saving…'
              : isAccount
                ? 'Save account'
                : isBudget
                  ? 'Save budget'
                  : kind === 'checkpoint'
                    ? 'Save checkpoint'
                    : isAsset
                      ? 'Save asset'
                      : pictureUploadFailed
                        ? 'Retry picture upload'
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
