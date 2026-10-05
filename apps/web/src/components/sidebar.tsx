import { useEffect, useState } from 'react';
import {
  BarChart3,
  Banknote,
  ChevronDown,
  CircleDollarSign,
  Command,
  Goal,
  LayoutDashboard,
  LogOut,
  Moon,
  Search,
  Settings,
  Settings2,
  Sun,
  WalletCards,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { useTheme } from 'next-themes';
import { FinanceNotifications } from './app/finance-notifications';
import type { BudgetData } from './budgeting/data';
import { pb } from '../api/pocketbase';
import type { UserProfile } from '../profile';

export type SidebarTab = 'dashboard' | 'transactions' | 'budgets' | 'assets' | 'goals' | 'settings';

type SidebarProps = {
  activeTab: SidebarTab;
  profile: UserProfile;
  data: BudgetData;
  userId: string;
  onChange: (tab: SidebarTab) => void;
  onSearch: () => void;
};

const items: { id: SidebarTab; label: string; icon: LucideIcon }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'transactions', label: 'Transactions', icon: Banknote },
  { id: 'budgets', label: 'Budgets', icon: WalletCards },
  { id: 'assets', label: 'Assets', icon: BarChart3 },
  { id: 'goals', label: 'Goals', icon: Goal },
];

export function Sidebar({ activeTab, profile, data, userId, onChange, onSearch }: SidebarProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileClosing, setProfileClosing] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const navigate = useNavigate();

  useEffect(() => {
    if (!profileClosing) return;
    const timeout = window.setTimeout(() => {
      setProfileOpen(false);
      setProfileClosing(false);
    }, 140);
    return () => window.clearTimeout(timeout);
  }, [profileClosing]);

  const closeProfile = () => setProfileClosing(true);
  const signOut = () => {
    pb.authStore.clear();
    setProfileOpen(false);
    void navigate({ to: '/auth/login' });
  };

  return (
    <aside className="sidebar" aria-label="Main navigation">
      <button
        className="sidebar-brand"
        type="button"
        onClick={() => onChange('dashboard')}
        aria-label="Piggybudget home"
      >
        <CircleDollarSign size={21} strokeWidth={2.4} />
      </button>
      <div className="sidebar-rule" />
      <nav className="sidebar-nav">
        {items.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`sidebar-link ${activeTab === id ? 'is-active' : ''}`}
            type="button"
            onClick={() => onChange(id)}
            aria-label={label}
            aria-current={activeTab === id ? 'page' : undefined}
          >
            <Icon size={19} strokeWidth={2} />
            <span className="sidebar-label">{label}</span>
          </button>
        ))}
      </nav>
      <button
        className={`sidebar-link ${activeTab === 'settings' ? 'is-active' : ''}`}
        type="button"
        onClick={() => onChange('settings')}
        aria-label="Settings"
        aria-current={activeTab === 'settings' ? 'page' : undefined}
      >
        <Settings size={19} strokeWidth={2} />
        <span className="sidebar-label">Settings</span>
      </button>
      <div className="sidebar-spacer" />
      <div className="sidebar-footer">
        <button
          className="sidebar-link sidebar-search"
          type="button"
          onClick={onSearch}
          aria-label="Search"
        >
          <Search size={19} strokeWidth={2} />
          <span className="sidebar-label">Search</span>
          <kbd className="sidebar-search-shortcut">
            <Command size={10} /> K
          </kbd>
        </button>
        <div className="sidebar-notifications">
          <FinanceNotifications key={userId} data={data} userId={userId} onNavigate={onChange} />
        </div>
        <div className="profile-wrap sidebar-profile-wrap">
          <button
            className="profile-button sidebar-profile-button"
            type="button"
            onClick={() => {
              if (profileOpen) closeProfile();
              else {
                setProfileClosing(false);
                setProfileOpen(true);
              }
            }}
            aria-label="Open profile menu"
            aria-expanded={profileOpen}
          >
            <span>{profile.initials}</span>
            <ChevronDown size={13} />
          </button>
          {profileOpen && (
            <div
              className={`topbar-popover profile-popover sidebar-profile-popover ${profileClosing ? 'is-closing' : ''}`}
            >
              <div className="profile-popover-heading">
                <span className="profile-large small">{profile.initials}</span>
                <div>
                  <strong>{profile.name}</strong>
                  <small>{profile.email || 'No email on file'}</small>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  closeProfile();
                  onChange('settings');
                }}
              >
                <Settings2 size={15} /> Settings
              </button>
              <button
                type="button"
                onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              >
                <span>{resolvedTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />} </span>
                {resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}
              </button>
              <button type="button" className="danger-action" onClick={signOut}>
                <LogOut size={15} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
