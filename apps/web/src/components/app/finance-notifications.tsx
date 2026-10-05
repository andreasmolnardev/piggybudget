import { useEffect, useState } from 'react';
import { AlertTriangle, Bell, Check, X } from 'lucide-react';
import type { SidebarTab } from '../sidebar';
import type { BudgetData } from '../budgeting/data';

type NotificationState = { read: string[]; dismissed: string[] };

function storageKey(userId: string) {
  return `piggybudget:notifications:${userId}`;
}

function readState(userId: string): NotificationState {
  try {
    const saved = localStorage.getItem(storageKey(userId));
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<NotificationState>;
      return {
        read: Array.isArray(parsed.read) ? parsed.read : [],
        dismissed: Array.isArray(parsed.dismissed) ? parsed.dismissed : [],
      };
    }
  } catch {
    // Ignore unavailable or invalid browser storage.
  }
  return { read: [], dismissed: [] };
}

export function FinanceNotifications({
  data,
  userId,
  onNavigate,
}: {
  data: BudgetData;
  userId: string;
  onNavigate: (tab: SidebarTab) => void;
}) {
  const reconciliation = data.reconciliation;
  const issue =
    reconciliation && reconciliation.state !== 'reconciled'
      ? {
          id: `checkpoint-${reconciliation.account}-${reconciliation.from}-${reconciliation.to}-${reconciliation.state}-${reconciliation.amount}`,
          title:
            reconciliation.state === 'invalid'
              ? 'Checkpoint mismatch needs review'
              : 'Checkpoint has an unexplained gap',
          detail: `${reconciliation.account} · ${reconciliation.from}${reconciliation.to ? ` to ${reconciliation.to}` : ''} · ${reconciliation.amount.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}`,
        }
      : null;
  const [state, setState] = useState<NotificationState>(() => readState(userId));
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => setState(readState(userId)), [userId]);
  useEffect(() => {
    if (!closing) return;
    const timeout = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 140);
    return () => window.clearTimeout(timeout);
  }, [closing]);
  const toggle = () => {
    if (open) setClosing(true);
    else {
      setClosing(false);
      setOpen(true);
    }
  };
  useEffect(() => {
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(state));
    } catch {
      // Notifications still work for this session when storage is unavailable.
    }
  }, [state, userId]);

  const visibleIssue = issue && !state.dismissed.includes(issue.id) ? issue : null;
  const unread = visibleIssue && !state.read.includes(visibleIssue.id) ? 1 : 0;
  const markRead = () => {
    if (issue && !state.read.includes(issue.id))
      setState((current) => ({ ...current, read: [...current.read, issue.id] }));
  };
  const dismiss = () => {
    if (issue) setState((current) => ({ ...current, dismissed: [...current.dismissed, issue.id] }));
  };

  return (
    <div className="popover-wrap">
      <button
        className={`icon-button topbar-icon ${open ? 'is-active' : ''}`}
        type="button"
        onClick={toggle}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
      >
        <Bell size={17} />
        {unread > 0 && <span className="notification-dot" />}
      </button>
      {open && (
        <div className={`topbar-popover notification-popover ${closing ? 'is-closing' : ''}`}>
          <div className="popover-heading">
            <strong>Notifications</strong>
            {visibleIssue && unread > 0 && (
              <button className="text-button" type="button" onClick={markRead}>
                Mark all read
              </button>
            )}
          </div>
          {visibleIssue ? (
            <div className="notification-item">
              <span className="notification-symbol warm">
                <AlertTriangle size={14} />
              </span>
              <div className="finance-notification-copy">
                <strong>{visibleIssue.title}</strong>
                <small>{visibleIssue.detail}</small>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => {
                    markRead();
                    onNavigate('budgets');
                  }}
                >
                  Review reconciliation
                </button>
              </div>
              <button
                className="finance-notification-dismiss"
                type="button"
                onClick={dismiss}
                aria-label="Dismiss notification"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="notification-item">
              <span className="notification-symbol">
                <Check size={14} />
              </span>
              <div>
                <strong>Nothing needs your attention</strong>
                <small>Unresolved reconciliation alerts will show here.</small>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
