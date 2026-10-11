import { useMemo, useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import type { SidebarTab } from '../sidebar';
import type { BudgetData } from '../budgeting/data';
import { formatMoney } from '../budgeting/budgeting-dashboard';

type SearchResult = {
  id: string;
  title: string;
  detail: string;
  section: string;
  tab: SidebarTab;
};

function resultsFor(data: BudgetData, query: string): SearchResult[] {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return [];
  const matches = (text: string) => text.toLocaleLowerCase().includes(term);
  const results: SearchResult[] = [
    ...data.transactions.map((transaction) => ({
      id: `transaction-${transaction.id}`,
      title: transaction.merchant,
      detail: `${transaction.category} · ${transaction.account} · ${transaction.date} · ${formatMoney(transaction.amount)}`,
      section: 'Transaction',
      tab: 'transactions' as const,
    })),
    ...data.accounts.map((account) => ({
      id: `account-${account.id}`,
      title: account.name,
      detail: `${account.type} · ${formatMoney(account.balance)}`,
      section: 'Account',
      tab: 'transactions' as const,
    })),
    ...data.budgets.map((budget) => ({
      id: `budget-${budget.id}`,
      title: budget.category,
      detail: `${formatMoney(budget.spent)} spent of ${formatMoney(budget.limit)}`,
      section: 'Budget',
      tab: 'budgets' as const,
    })),
    ...data.assets.map((asset) => ({
      id: `asset-${asset.id}`,
      title: asset.name,
      detail: `${asset.type} · ${formatMoney(asset.value)}`,
      section: 'Asset',
      tab: 'assets' as const,
    })),
    ...data.goals.map((goal) => ({
      id: `goal-${goal.id}`,
      title: goal.name,
      detail: `${formatMoney(goal.current)} saved of ${formatMoney(goal.target)} · ${goal.deadline}`,
      section: 'Goal',
      tab: 'goals' as const,
    })),
  ];
  return results
    .filter((result) => matches(`${result.title} ${result.detail} ${result.section}`))
    .slice(0, 10);
}

export function FinanceSearch({
  data,
  onClose,
  onNavigate,
}: {
  data: BudgetData;
  onClose: () => void;
  onNavigate: (tab: SidebarTab) => void;
}) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => resultsFor(data, query), [data, query]);

  return (
    <div
      className="search-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Search finance data"
    >
      <button
        className="search-backdrop"
        type="button"
        onClick={onClose}
        aria-label="Close search"
      />
      <div className="search-dialog">
        <div className="search-dialog-input">
          <Search size={20} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
            }}
            placeholder="Search transactions, accounts, budgets, assets, goals…"
          />
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close search">
            <X size={18} />
          </button>
        </div>
        {query.trim() ? (
          results.length ? (
            <div role="list" aria-label="Search results">
              {results.map((result) => (
                <button
                  className="search-result"
                  type="button"
                  role="listitem"
                  key={result.id}
                  onClick={() => {
                    onClose();
                    onNavigate(result.tab);
                  }}
                >
                  <span>
                    <Search size={15} />
                  </span>
                  <span className="finance-search-copy">
                    <strong>{result.title}</strong>
                    <small>
                      {result.section} · {result.detail}
                    </small>
                  </span>
                  <ArrowRight size={14} />
                </button>
              ))}
            </div>
          ) : (
            <p className="search-hint">No loaded finance records match “{query.trim()}”.</p>
          )
        ) : (
          <p className="search-hint">
            Search loaded transactions, accounts, budgets, assets, and goals.
          </p>
        )}
      </div>
    </div>
  );
}
