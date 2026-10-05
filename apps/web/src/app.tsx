import { useEffect, useState, type ReactNode } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { AuthScreen } from './components/app/auth-screen';
import { FinanceSearch } from './components/app/finance-search';
import { Sidebar, type SidebarTab } from './components/sidebar';
import { BudgetingDashboard } from './components/budgeting/budgeting-dashboard';
import { loadBudgetData, sampleData, type BudgetData } from './components/budgeting/data';
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
  onRefresh,
}: {
  activeTab: SidebarTab;
  remote: boolean;
  onRefresh: () => void;
}) {
  return (
    <header className="topbar">
      <div className="topbar-context">
        <span className="mobile-brand">Piggybudget</span>
        <span className="topbar-slash">/</span>
        <strong>{pageLabels[activeTab]}</strong>
        <span className={`data-status ${remote ? 'is-synced' : ''}`}>
          <i /> {remote ? 'Synced' : 'Sample data'}
        </span>
      </div>
      <div className="topbar-actions">
        <button
          className="icon-button topbar-icon"
          type="button"
          onClick={onRefresh}
          aria-label="Refresh data"
        >
          <RefreshCw size={17} />
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
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [authenticated, setAuthenticated] = useState(pb.authStore.isValid);
  const [userId, setUserId] = useState(pb.authStore.record?.id ?? '');
  const [profile, setProfile] = useState<UserProfile>(() => profileFromRecord(pb.authStore.record));
  const [data, setData] = useState<BudgetData>(sampleData);
  const [remote, setRemote] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchClosing, setSearchClosing] = useState(false);
  const activeTab = tabForPath(pathname);

  useEffect(
    () =>
      pb.authStore.onChange((_token, record) => {
        setAuthenticated(Boolean(record));
        setUserId(record?.id ?? '');
        setProfile(profileFromRecord(record));
      }),
    [],
  );

  useEffect(() => {
    const isAuthRoute = pathname.startsWith('/auth/');
    if (!authenticated && !isAuthRoute) void navigate({ to: '/auth/login', replace: true });
    if (authenticated && isAuthRoute) void navigate({ to: '/', replace: true });
  }, [authenticated, navigate, pathname]);

  useEffect(() => {
    if (!authenticated || !userId) {
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
  }, [authenticated, userId]);

  useEffect(() => {
    if (!authenticated || !userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setDataError('');
    void loadBudgetData()
      .then((result) => {
        if (cancelled) return;
        setData(result.data);
        setRemote(result.remote);
      })
      .catch(() => {
        if (!cancelled)
          setDataError('Could not reach your saved data. Showing the local sample instead.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, userId]);

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

  const onNavigate = (tab: SidebarTab) => {
    void navigate({ to: routeForTab[tab] });
  };

  const refresh = () => {
    if (!userId) return;
    setLoading(true);
    void loadBudgetData()
      .then((result) => {
        setData(result.data);
        setRemote(result.remote);
      })
      .catch(() => setDataError('Refresh failed. Your last view is still here.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    window.addEventListener('piggybudget:refresh', refresh);
    return () => window.removeEventListener('piggybudget:refresh', refresh);
  }, [userId]);

  if (!authenticated)
    return <AuthScreen mode={pathname === '/auth/register' ? 'register' : 'login'} />;

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
        <Header activeTab={activeTab} remote={remote} onRefresh={refresh} />
        <div className="content-wrap">
          {dataError && (
            <AppError>
              {dataError}
              <button
                className="icon-button"
                type="button"
                onClick={() => setDataError('')}
                aria-label="Dismiss error"
              >
                <X size={15} />
              </button>
            </AppError>
          )}
          <div className="tab-page-transition">
            <BudgetingDashboard
              view={activeTab}
              data={data}
              remote={remote}
              loading={loading}
              onRefresh={refresh}
              onNavigate={onNavigate}
              profile={profile}
            />
          </div>
        </div>
        <footer className="app-footer">
          <span>Built for a calmer money life</span>
          <span>Last checked just now</span>
        </footer>
      </main>
      {searchOpen && (
        <div className={searchClosing ? 'search-dismiss' : undefined}>
          <FinanceSearch data={data} onClose={closeSearch} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
}
