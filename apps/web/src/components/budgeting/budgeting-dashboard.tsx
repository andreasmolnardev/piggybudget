import { useMemo, useState, type ReactNode } from 'react';
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
import type { SidebarTab } from '../sidebar';
import type { UserProfile } from '../../profile';
import { apiFetch } from '../../api/client';
import { pb } from '../../api/pocketbase';
import type { Asset, Budget, BudgetData, Goal, Transaction, TransactionKind } from './data';

export type BudgetView = SidebarTab;

type Props = {
  view: BudgetView;
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
  onEdit,
  onDelete,
}: {
  transaction: Transaction;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="transaction-row">
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
          <button className="text-button" type="button" onClick={onEdit}>
            Edit
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={onDelete}
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

function CashFlowChart() {
  const bars = [42, 61, 34, 76, 55, 88, 67];
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <div className="cashflow-chart" aria-label="Cash flow over the last seven days">
      <div className="chart-y-labels">
        <span>$2k</span>
        <span>$1k</span>
        <span>$0</span>
      </div>
      <div className="chart-bars">
        {bars.map((height, index) => (
          <div className="chart-day" key={labels[index]}>
            <div className="chart-bar-wrap">
              <span className="chart-income" style={{ height: `${Math.min(98, height + 16)}%` }} />
              <span className="chart-expense" style={{ height: `${height / 2}%` }} />
            </div>
            <small>{labels[index]}</small>
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
          <CashFlowChart />
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
}: {
  data: BudgetData;
  onAddTransaction: () => void;
  onAddCheckpoint: () => void;
  onAddAccount: () => void;
  onEditTransaction: (transaction: Transaction) => void;
  onDeleteTransaction: (transaction: Transaction) => void;
}) {
  const [query, setQuery] = useState('');
  const [account, setAccount] = useState('All accounts');
  const [kind, setKind] = useState<'all' | TransactionKind>('all');
  const [category, setCategory] = useState('All categories');
  const [tagQuery, setTagQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const filtered = useMemo(
    () =>
      data.transactions.filter((transaction) => {
        const matchesQuery =
          `${transaction.merchant} ${transaction.category} ${transaction.note ?? ''} ${transaction.receivable ?? ''} ${(transaction.tags ?? []).join(' ')}`
            .toLowerCase()
            .includes(query.toLowerCase());
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
        return (
          matchesQuery &&
          matchesAccount &&
          matchesKind &&
          matchesCategory &&
          matchesTag &&
          matchesDate
        );
      }),
    [account, category, data.transactions, fromDate, kind, query, tagQuery, toDate],
  );
  return (
    <>
      <PageHeader
        title="Transactions"
        description="Review, search, and reconcile every movement."
        action={
          <div className="header-actions">
            <button className="button" type="button" onClick={onAddAccount}>
              <Landmark size={15} /> Add account
            </button>
            <button className="button" type="button" onClick={onAddCheckpoint}>
              <CheckCircle2 size={15} /> Record checkpoint
            </button>
            <button className="button button-primary" type="button" onClick={onAddTransaction}>
              <Plus size={16} /> Add transaction
            </button>
          </div>
        }
      />
      <MoneyLentPanel transactions={data.transactions} />
      <section className="panel transactions-panel">
        <div className="transaction-toolbar">
          <label className="search-field">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search transactions"
              aria-label="Search transactions"
            />
          </label>
          <label className="account-select">
            <Landmark size={15} />
            <select value={account} onChange={(event) => setAccount(event.target.value)}>
              <option>All accounts</option>
              {data.accounts.map((item) => (
                <option key={item.id}>{item.name}</option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
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
          <label className="account-select">
            <Filter size={15} />
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              aria-label="Filter by category"
            >
              <option>All categories</option>
              {[...new Set(data.transactions.map((item) => item.category))].sort().map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="search-field">
            <input
              value={tagQuery}
              onChange={(event) => setTagQuery(event.target.value)}
              placeholder="Filter by tag"
              aria-label="Filter by tag"
            />
          </label>
          <label className="date-filter">
            From{' '}
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              aria-label="From date"
            />
          </label>
          <label className="date-filter">
            To{' '}
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              aria-label="To date"
            />
          </label>
        </div>
        <div className="table-header">
          <span>Transaction</span>
          <span>Date</span>
          <span>Amount</span>
          <span />
        </div>
        <div className="transaction-list transaction-table">
          {filtered.length ? (
            filtered.map((transaction) => (
              <TransactionRow
                key={transaction.id}
                transaction={transaction}
                onEdit={() => onEditTransaction(transaction)}
                onDelete={() => onDeleteTransaction(transaction)}
              />
            ))
          ) : (
            <div className="empty-state">
              <Search size={20} />
              <strong>No transactions found</strong>
              <span>Try a different search or account.</span>
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
  onAddAsset,
  onEditAsset,
  onDeleteAsset,
}: {
  data: BudgetData;
  onAddAsset: () => void;
  onEditAsset: (asset: Asset) => void;
  onDeleteAsset: (asset: Asset) => void;
}) {
  const totalValue = data.assets.reduce((sum, asset) => sum + asset.value, 0);
  const totalCost = data.assets.reduce((sum, asset) => sum + asset.cost, 0);
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
      <section className="panel asset-list-panel">
        <SectionHeading
          title="Your assets"
          action={
            <button className="text-button" type="button" onClick={onAddAsset}>
              <Plus size={14} /> Add asset
            </button>
          }
        />
        <div className="asset-list">
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
    <div className="asset-row">
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
    </div>
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
  data,
  remote,
  loading,
  onRefresh,
  onNavigate,
  profile,
}: Props) {
  const [settingsMessage, setSettingsMessage] = useState('');
  const [composer, setComposer] = useState<
    'account' | 'transaction' | 'checkpoint' | 'asset' | 'budget' | null
  >(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
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
      />
    ) : view === 'budgets' ? (
      <BudgetsView data={data} onAddBudget={() => setComposer('budget')} />
    ) : view === 'assets' ? (
      <AssetsView
        data={data}
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
    </>
  );
}

function SettingsView({
  remote,
  onRefresh,
  onMessage,
  settingsMessage,
  profile,
}: {
  remote: boolean;
  onRefresh: () => void;
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
  const [account, setAccount] = useState(transaction?.accountId ?? data.accounts[0]?.id ?? '');
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
  const [assetName, setAssetName] = useState(asset?.name ?? '');
  const [assetType, setAssetType] = useState(asset?.type ?? 'Other');
  const [purchasePrice, setPurchasePrice] = useState(
    String(asset?.purchasePrice ?? asset?.cost ?? ''),
  );
  const [targetSalePrice, setTargetSalePrice] = useState(String(asset?.targetSalePrice ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
        kind === 'transaction' ? transaction?.id : kind === 'asset' ? asset?.id : undefined;
      const response = await apiFetch(`/api/finance/${resource}${editedId ? `/${editedId}` : ''}`, {
        method: editedId ? 'PUT' : 'POST',
        headers: {
          Authorization: `Bearer ${pb.authStore.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error((await response.text()) || 'Could not save this record.');
      onSaved();
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
    <div className="composer-overlay">
      <button
        className="composer-backdrop"
        type="button"
        onClick={onClose}
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
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
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
          <button className="button" type="button" onClick={onClose}>
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
