import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FinanceSearch } from './components/app/finance-search';
import { Sidebar, type SidebarTab } from './components/sidebar';
import { BudgetingDashboard } from './components/budgeting/budgeting-dashboard';
import { sampleData, type FinanceRecordTarget } from './components/budgeting/data';
import { budgetDataQueryKey, budgetDataQueryOptions } from './components/budgeting/query';
import { pb } from './api/pocketbase';
import { profileFromRecord, type UserProfile } from './profile';

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

const pageLabels: Record<SidebarTab, string> = {
  dashboard: 'Dashboard',
  transactions: 'Transactions',
  budgets: 'Budgets',
  assets: 'Assets',
  goals: 'Goals',
  settings: 'Settings',
};

function tabForPath(pathname: string): SidebarTab {
  if (pathname === '/transactions') return 'transactions';
  if (pathname === '/budgets') return 'budgets';
  if (pathname === '/assets') return 'assets';
  if (pathname === '/goals') return 'goals';
  if (pathname === '/settings') return 'settings';
  return 'dashboard';
}

function Header({
  activeTab,
  remote,
  refreshing,
  onRefresh,
}: {
  activeTab: SidebarTab;
  remote: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <header className="topbar">
      <div className="topbar-context">
        <span className="mobile-brand">Piggybudget</span>
        <span className="topbar-slash">/</span>
        <strong>{pageLabels[activeTab]}</strong>
        <span className={`data-status ${remote ? 'is-synced' : ''}`}>
          <i /> {refreshing ? 'Refreshing' : remote ? 'Synced' : 'Sample data'}
        </span>
      </div>
      <div className="topbar-actions">
        <button
          className="icon-button topbar-icon"
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label={refreshing ? 'Refreshing saved data' : 'Refresh data'}
          aria-busy={refreshing}
        >
          <RefreshCw className={refreshing ? 'refresh-icon is-spinning' : 'refresh-icon'} size={17} />
        </button>
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
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [userId, setUserId] = useState(pb.authStore.record?.id ?? '');
  const [profile, setProfile] = useState<UserProfile>(() => profileFromRecord(pb.authStore.record));
  const [dataErrorDismissed, setDataErrorDismissed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchClosing, setSearchClosing] = useState(false);
  const [searchTarget, setSearchTarget] = useState<FinanceRecordTarget | null>(null);
  const budgetQuery = useQuery(budgetDataQueryOptions(userId));
  const data = budgetQuery.data?.data ?? sampleData;
  const remote = budgetQuery.data?.remote ?? false;
  const loading = budgetQuery.isLoading;
  const lastRefreshedAt = budgetQuery.dataUpdatedAt;
  const dataError =
    budgetQuery.isError && !dataErrorDismissed
      ? 'Could not reach your saved data. Showing the local sample instead.'
      : '';
  const activeTab = tabForPath(pathname);

  useEffect(
    () =>
      pb.authStore.onChange((_token, record) => {
        setUserId(record?.id ?? '');
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchClosing(false);
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const closeSearch = () => setSearchClosing(true);
  const handleSearchTargetHandled = useCallback(() => setSearchTarget(null), []);

  const onNavigate = (tab: SidebarTab) => {
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

  return (
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
          remote={remote}
          refreshing={budgetQuery.isFetching}
          onRefresh={refresh}
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
          <div className="tab-page-transition">
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
            />
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
          onSelect={({ record, tab }) => {
            setSearchTarget(record);
            onNavigate(tab);
          }}
        />
        </div>
      )}
    </div>
  );
}
