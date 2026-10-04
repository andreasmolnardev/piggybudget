import {
  BarChart3,
  Banknote,
  CircleDollarSign,
  Goal,
  LayoutDashboard,
  Settings,
  WalletCards,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { UserProfile } from '../profile';

export type SidebarTab = 'dashboard' | 'transactions' | 'budgets' | 'assets' | 'goals' | 'settings';

type SidebarProps = {
  activeTab: SidebarTab;
  profile: UserProfile;
  onChange: (tab: SidebarTab) => void;
};

const items: { id: SidebarTab; label: string; icon: LucideIcon }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'transactions', label: 'Transactions', icon: Banknote },
  { id: 'budgets', label: 'Budgets', icon: WalletCards },
  { id: 'assets', label: 'Assets', icon: BarChart3 },
  { id: 'goals', label: 'Goals', icon: Goal },
];

export function Sidebar({ activeTab, profile, onChange }: SidebarProps) {
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
      <div className="sidebar-spacer" />
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
      <div className="sidebar-avatar" aria-label={`${profile.name} profile`}>
        {profile.initials}
      </div>
    </aside>
  );
}
