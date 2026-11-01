import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, CloudOff, RefreshCw, X } from 'lucide-react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FinanceSearch } from './components/app/finance-search';
import { CommandPalette } from './components/patterns/command-palette';
import { Sidebar, type SidebarTab } from './components/sidebar';
import { BudgetingDashboard } from './components/budgeting/budgeting-dashboard';
import { emptyBudgetData, type BudgetData, type FinanceRecordTarget } from './components/budgeting/data';
import { budgetDataQueryKey, budgetDataQueryOptions } from './components/budgeting/query';
import { pb } from './api/pocketbase';
import { profileFromRecord, type UserProfile } from './profile';
import { Tooltip, TooltipContent, TooltipTrigger } from './components/ui/tooltip';
import { financeApplication, financeLayout, financeViewForPath } from './app-definition';
import { defineAction, defineSearchProvider, renderLayout, renderShell } from './lib/slopstack';
import { useAuthentication } from './lib/slopstack';
import { authenticationStore } from './auth';

const routeForTab: Record<
  SidebarTab,
  '/' | '/transactions' | '/budgets' | '/assets' | '/goals' | '/settings'
> = {
  dashboard: '/',
  transactions: '/transactions',
  budgets: '/budgets',
  assets: '/assets',
  goals: '/goals',
  settings: '/settings',
};

const pageLabels = Object.fromEntries(
  (financeApplication.views ?? []).map((view) => [view.id, view.label]),
) as Record<SidebarTab, string>;

function tabForPath(pathname: string): SidebarTab {
  return financeViewForPath(pathname).id as SidebarTab;
}

function Header({
  activeTab,
  profileName,
  remote,
  refreshing,
  syncError,
  onRefresh,
  data,
  onNavigate,
}: {
  activeTab: SidebarTab;
  profileName: string;
  remote: boolean;
  refreshing: boolean;
  syncError: boolean;
  onRefresh: () => void;
  data: BudgetData;
  onNavigate: (path: SidebarTab) => void;
}) {
  const providers = useMemo(() => [defineSearchProvider({
    id: 'finance-records',
    label: 'Finance records',
    minQueryLength: 2,
    search: async (query: string) => {
      const term = query.toLocaleLowerCase();
      const results = [
        ...data.accounts.map((record) => ({ id: `account-${record.id}`, title: record.name, description: `${record.type} account`, href: '/transactions' })),
        ...data.budgets.map((record) => ({ id: `budget-${record.id}`, title: record.category, description: 'Budget category', href: '/budgets' })),
        ...data.assets.map((record) => ({ id: `asset-${record.id}`, title: record.name, description: `${record.type} asset`, href: '/assets' })),
        ...data.goals.map((record) => ({ id: `goal-${record.id}`, title: record.name, description: 'Savings goal', href: '/goals' })),
        ...data.transactions.map((record) => ({ id: `transaction-${record.id}`, title: record.merchant, description: `${record.category} · ${record.date}`, href: '/transactions' })),
      ];
      return results.filter((result) => `${result.title} ${result.description}`.toLocaleLowerCase().includes(term));
    },
  })], [data]);
  const navigation = useMemo(() => (financeApplication.shell?.navigation ?? []).map((item) => ({
    id: item.id,
    title: item.label,
    href: financeApplication.views?.find((view) => view.id === item.view)?.path,
  })), []);
  const actions = useMemo(() => [defineAction({
    id: 'refresh-finance-data',
    label: 'Refresh saved finance data',
    description: 'Reload accounts, transactions, budgets, assets, and goals.',
    keywords: ['sync', 'reload', 'refresh'],
    access: { authenticated: true },
    execute: () => onRefresh(),
  })], [onRefresh]);
  const syncState = refreshing ? 'syncing' : syncError ? 'error' : remote ? 'synced' : 'offline';
  const SyncIcon = {
    syncing: RefreshCw,
    error: CircleAlert,
    synced: CircleCheck,
    offline: CloudOff,
  }[syncState];
  const syncLabel = {
    syncing: 'Syncing saved data',
    error: 'Could not sync saved data',
    synced: 'Synced',
    offline: 'Not synced',
  }[syncState];

  return (
    <header className="topbar">
      <div className="topbar-context">
        <span className="mobile-brand">{profileName}'s finances</span>
        <strong className="topbar-owner">{profileName}'s finances</strong>
        <span className="topbar-slash">/</span>
        <strong>{pageLabels[activeTab]}</strong>
      </div>
      <div className="topbar-actions">
        <CommandPalette
          providers={providers}
          navigation={navigation}
          actions={actions}
          onNavigate={(href) => onNavigate(tabForPath(href))}
          shortcutLabel="Ctrl K"
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={`icon-button topbar-icon topbar-sync-icon is-${syncState}`}
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label={refreshing ? 'Refreshing saved data' : 'Refresh data'}
              aria-busy={refreshing}
            >
              <SyncIcon className={syncState === 'syncing' ? 'refresh-icon is-spinning' : 'refresh-icon'} size={17} />
            </button>
          </TooltipTrigger>
          <TooltipContent sideOffset={8}>{syncLabel}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}

function AppError({ children }: { children: ReactNode }) {
  return <div className="app-error-banner">{children}</div>;
}

export function App() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const authentication = useAuthentication(authenticationStore);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const scrollPositions = useRef(new Map<string, number>());
  const previousTab = useRef(tabForPath(pathname));
  const tabPageRef = useRef<HTMLDivElement>(null);
  const userId = authentication.session?.user.id ?? '';
  const [profile, setProfile] = useState<UserProfile>(() => profileFromRecord(pb.authStore.record));
  const [dataErrorDismissed, setDataErrorDismissed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchClosing, setSearchClosing] = useState(false);
  const [searchTarget, setSearchTarget] = useState<FinanceRecordTarget | null>(null);
  const [transactionSearchTerm, setTransactionSearchTerm] = useState('');
  const budgetQuery = useQuery(budgetDataQueryOptions(userId));
  const data = budgetQuery.data?.data ?? emptyBudgetData;
  const remote = budgetQuery.data?.remote ?? false;
  const loading = budgetQuery.isLoading;
  const lastRefreshedAt = budgetQuery.dataUpdatedAt;
  const dataError =
    budgetQuery.isError && !dataErrorDismissed
      ? 'Could not reach your saved data.'
      : '';
  const activeTab = tabForPath(pathname);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo(0, scrollPositions.current.get(pathname) ?? 0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  useLayoutEffect(() => {
    if (previousTab.current === activeTab) return;
    previousTab.current = activeTab;
    const page = tabPageRef.current;
    if (!page) return;
    page.classList.remove('tab-page-transition');
    void page.offsetWidth;
    page.classList.add('tab-page-transition');
  }, [activeTab]);

  useEffect(
    () =>
      pb.authStore.onChange((_token, record) => {
        setProfile(profileFromRecord(record));
        if (!record) {
          queryClient.removeQueries({ queryKey: ['budget-data'] });
          void navigate({ to: '/auth/login', replace: true });
        }
      }),
    [navigate, queryClient],
  );

  useEffect(() => {
    if (!userId) {
      setProfile(profileFromRecord(null));
      return;
    }
    let cancelled = false;
    void pb
      .collection('users')
      .getOne(userId)
      .then((record) => {
        if (!cancelled) setProfile(profileFromRecord(record));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    document.title = `${pageLabels[activeTab]} | Piggybudget`;
  }, [activeTab]);

  useEffect(() => {
    if (!searchClosing) return;
    const timeout = window.setTimeout(() => {
      setSearchOpen(false);
      setSearchClosing(false);
    }, 160);
    return () => window.clearTimeout(timeout);
  }, [searchClosing]);

  const closeSearch = () => setSearchClosing(true);
  const handleSearchTargetHandled = useCallback(() => setSearchTarget(null), []);
  const handleTransactionSearchHandled = useCallback(() => setTransactionSearchTerm(''), []);

  const onNavigate = (tab: SidebarTab) => {
    scrollPositions.current.set(pathname, window.scrollY);
    void navigate({ to: routeForTab[tab] });
  };

  const refresh = useCallback(() => {
    if (!userId) return;
    setDataErrorDismissed(false);
    void queryClient.invalidateQueries({ queryKey: budgetDataQueryKey(userId) });
  }, [queryClient, userId]);

  useEffect(() => {
    window.addEventListener('piggybudget:refresh', refresh);
    return () => window.removeEventListener('piggybudget:refresh', refresh);
  }, [refresh]);

  return renderShell(financeApplication.shell!, (
    <div className="app-shell">
      <Sidebar
        activeTab={activeTab}
        profile={profile}
        data={data}
        userId={userId}
        onChange={onNavigate}
        onSearch={() => setSearchOpen(true)}
      />
      <main className="main-content">
        <Header
          activeTab={activeTab}
          profileName={profile.name}
          remote={remote}
          refreshing={budgetQuery.isFetching}
          syncError={budgetQuery.isError}
          onRefresh={refresh}
          data={data}
          onNavigate={(tab) => onNavigate(tab)}
        />
        <div className="content-wrap">
          {dataError && (
            <AppError>
              {dataError}
              <button
                className="icon-button"
                type="button"
                onClick={() => setDataErrorDismissed(true)}
                aria-label="Dismiss error"
              >
                <X size={15} />
              </button>
            </AppError>
          )}
          <div ref={tabPageRef} className="tab-page-transition">
            {renderLayout(financeLayout, {
              content: {
                kind: 'view',
                content: (
                  <BudgetingDashboard
                    view={activeTab}
                    userId={userId}
                    data={data}
                    remote={remote}
                    loading={loading}
                    onRefresh={refresh}
                    onNavigate={onNavigate}
                    profile={profile}
                    recordTarget={searchTarget}
                    onRecordTargetHandled={handleSearchTargetHandled}
                    transactionSearchTerm={transactionSearchTerm}
                    onTransactionSearchHandled={handleTransactionSearchHandled}
                  />
                ),
              },
            })}
          </div>
        </div>
        <footer className="app-footer">
          <span>Built for a calmer money life</span>
          <span>
            {lastRefreshedAt
              ? `Last refreshed ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(lastRefreshedAt))}`
              : 'Not refreshed yet'}
          </span>
        </footer>
      </main>
      {searchOpen && (
        <div className={searchClosing ? 'search-dismiss' : undefined}>
        <FinanceSearch
          data={data}
          onClose={closeSearch}
          onSearchTransactions={(query) => {
            setTransactionSearchTerm(query);
            onNavigate('transactions');
          }}
          onSelect={({ record, tab }) => {
            setSearchTarget(record);
            onNavigate(tab);
          }}
        />
        </div>
      )}
    </div>
  ));
}
