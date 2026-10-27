import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import type { SidebarTab } from '../sidebar';
import type { BudgetData, FinanceRecordTarget, FinanceRecordType } from '../budgeting/data';
import { formatMoney } from '../budgeting/budgeting-dashboard';
import { AppSelect } from '../ui/app-select';

type SearchResult = {
  id: string;
  record: FinanceRecordTarget;
  title: string;
  detail: string;
  section: string;
  tab: SidebarTab;
};

type TransactionSearchResult = {
  id: 'transaction-search';
  kind: 'transaction-search';
  title: 'Search transactions';
  detail: string;
};

function resultsFor(data: BudgetData, query: string): SearchResult[] {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return [];
  const matches = (text: string) => text.toLocaleLowerCase().includes(term);
  const results: SearchResult[] = [
    ...data.accounts.map((account) => ({
      id: `account-${account.id}`,
      record: { type: 'account' as const, id: account.id },
      title: account.name,
      detail: `${account.type} · ${formatMoney(account.balance)}`,
      section: 'Account',
      tab: 'transactions' as const,
    })),
    ...data.budgets.map((budget) => ({
      id: `budget-${budget.id}`,
      record: { type: 'budget' as const, id: budget.id },
      title: budget.category,
      detail: budget.unlimited
        ? `${formatMoney(budget.spent)} spent · unlimited category`
        : `${formatMoney(budget.spent)} spent of ${formatMoney(budget.limit)}`,
      section: 'Budget',
      tab: 'budgets' as const,
    })),
    ...data.assets.map((asset) => ({
      id: `asset-${asset.id}`,
      record: { type: 'asset' as const, id: asset.id },
      title: asset.name,
      detail: `${asset.type} · ${formatMoney(asset.value)}`,
      section: 'Asset',
      tab: 'assets' as const,
    })),
    ...data.goals.map((goal) => ({
      id: `goal-${goal.id}`,
      record: { type: 'goal' as const, id: goal.id },
      title: goal.name,
      detail: `${formatMoney(goal.current)} saved of ${formatMoney(goal.target)} · ${goal.deadline}`,
      section: 'Goal',
      tab: 'goals' as const,
    })),
  ];
  return results
    .filter((result) => matches(`${result.title} ${result.detail} ${result.section}`));
}

export function FinanceSearch({
  data,
  onClose,
  onSelect,
  onSearchTransactions,
}: {
  data: BudgetData;
  onClose: () => void;
  onSelect: (result: { record: FinanceRecordTarget; tab: SidebarTab }) => void;
  onSearchTransactions: (query: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | FinanceRecordType>('all');
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo(() => {
    const transactionSearch: TransactionSearchResult[] =
      typeFilter === 'all' || typeFilter === 'transaction'
        ? [{
            id: 'transaction-search',
            kind: 'transaction-search',
            title: 'Search transactions',
            detail: `Show transactions matching “${query.trim()}”`,
          }]
        : [];
    const records = resultsFor(data, query).filter(
      (result) => typeFilter === 'all' || result.record.type === typeFilter,
    );
    return [...transactionSearch, ...records].slice(0, 10);
  }, [data, query, typeFilter]);
  useEffect(() => setActiveIndex(0), [query, typeFilter]);
  const selectResult = (result: SearchResult | TransactionSearchResult) => {
    onClose();
    if ('kind' in result) {
      onSearchTransactions(query.trim());
      return;
    }
    onSelect({ record: result.record, tab: result.tab });
  };

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
            id="finance-search-input"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              if (event.key === 'ArrowDown' && results.length) {
                event.preventDefault();
                setActiveIndex((index) => Math.min(results.length - 1, index + 1));
              }
              if (event.key === 'ArrowUp' && results.length) {
                event.preventDefault();
                setActiveIndex((index) => Math.max(0, index - 1));
              }
              if (event.key === 'Enter' && results[activeIndex]) {
                event.preventDefault();
                selectResult(results[activeIndex]);
              }
            }}
            placeholder="Search accounts, budgets, assets, goals…"
          />
          <AppSelect
            className="finance-search-type"
            aria-label="Filter search results by type"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as 'all' | FinanceRecordType)}
          >
            <option value="all">All types</option>
            <option value="transaction">Transactions</option>
            <option value="account">Accounts</option>
            <option value="budget">Budgets</option>
            <option value="asset">Assets</option>
            <option value="goal">Goals</option>
          </AppSelect>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close search">
            <X size={18} />
          </button>
        </div>
        {query.trim() ? (
          results.length ? (
            <div role="listbox" aria-label="Search results">
              {results.map((result, index) => (
                <button
                  className={`search-result ${index === activeIndex ? 'is-active' : ''}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  key={result.id}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectResult(result)}
                >
                  <span>
                    <Search size={15} />
                  </span>
                  <span className="finance-search-copy">
                    <strong>{result.title}</strong>
                    <small>
                      {'section' in result ? result.section : 'Transaction search'} · {result.detail}
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
            Search loaded accounts, budgets, assets, and goals.
          </p>
        )}
      </div>
    </div>
  );
}
