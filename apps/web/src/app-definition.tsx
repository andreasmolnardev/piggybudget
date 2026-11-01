import type { ReactNode } from 'react';
import { createLocalStorageSettingsAdapter, createSettingsStore, createSlopstackRegistry, defineApplication, defineLayout, defineSettings, defineView, resolveView, type SettingsDefinition } from './lib/slopstack';
import { financeResources } from './resources/finance';

function FinanceLayout({ slots }: { slots: Record<string, ReactNode> }) {
  return <div className="finance-view-layout" data-layout="finance-page">{slots.content}</div>;
}

/** Metadata-only view component. TanStack routes render the real finance workspace; this manifest supplies route and access metadata. */
function RegisteredFinanceView() {
  return null;
}

function FinanceShellFrame({ children }: { children: ReactNode }) {
  return <div className="finance-shell-frame">{children}</div>;
}

export const financeLayout = defineLayout({
  id: 'finance-page',
  label: 'Finance page',
  slots: [{ id: 'content', label: 'Finance content', accepts: ['view', 'component'], required: true }],
  component: FinanceLayout,
});

const routeDefinitions = [
  ['dashboard', '/', 'Dashboard'],
  ['transactions', '/transactions', 'Transactions'],
  ['budgets', '/budgets', 'Budgets'],
  ['assets', '/assets', 'Assets'],
  ['goals', '/goals', 'Goals'],
  ['settings', '/settings', 'Settings'],
] as const;

export const financeViews = routeDefinitions.map(([id, path, label]) => defineView({
  id,
  path,
  label,
  layout: 'finance-page',
  access: { authenticated: true },
  component: RegisteredFinanceView,
}));

export type FinancePreferenceValues = {
  currency: string;
  weekStart: 'monday' | 'sunday';
  dateFormat: 'locale' | 'day-first' | 'iso';
  numberFormat: 'locale' | 'en-US' | 'de-DE';
  theme: 'system' | 'light' | 'dark';
  notifications: boolean;
};

export const financeSettings: SettingsDefinition<FinancePreferenceValues> = defineSettings<SettingsDefinition<FinancePreferenceValues>>({
  id: 'finance-preferences',
  label: 'Finance preferences',
  description: 'User display and planning preferences.',
  scope: 'user',
  fields: [
    { name: 'currency', label: 'Currency', kind: 'select', options: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'].map((value) => ({ label: value, value })) },
    { name: 'weekStart', label: 'Week starts', kind: 'select', options: [{ label: 'Monday', value: 'monday' }, { label: 'Sunday', value: 'sunday' }] },
    { name: 'dateFormat', label: 'Date format', kind: 'select', options: [{ label: 'Locale', value: 'locale' }, { label: 'Day first', value: 'day-first' }, { label: 'ISO', value: 'iso' }] },
    { name: 'numberFormat', label: 'Number format', kind: 'select', options: [{ label: 'Locale', value: 'locale' }, { label: 'United States', value: 'en-US' }, { label: 'Germany', value: 'de-DE' }] },
    { name: 'theme', label: 'Appearance', kind: 'select', options: [{ label: 'System', value: 'system' }, { label: 'Light', value: 'light' }, { label: 'Dark', value: 'dark' }] },
    { name: 'notifications', label: 'Notifications', kind: 'boolean' },
  ],
  defaults: { currency: 'USD', weekStart: 'monday', dateFormat: 'locale', numberFormat: 'locale', theme: 'system', notifications: true },
});

export function financePreferencesStore(userId: string) {
  return createSettingsStore(
    financeSettings,
    createLocalStorageSettingsAdapter(`piggybudget:preferences:${userId}`),
  );
}

const navigation = routeDefinitions.map(([id, , label]) => ({
  id,
  label,
  view: id,
}));

export const financeApplication = defineApplication({
  id: 'piggybudget',
  name: 'Piggybudget',
  backend: { provider: 'pocketbase', capabilities: { database: true, realtime: true, uploads: true } },
  authentication: {
    provider: 'pocketbase',
    enforcement: 'server',
    routes: { signIn: '/auth/login', unauthorized: '/auth/login' },
  },
  shell: {
    id: 'finance-shell',
    label: 'Finance workspace',
    navigation,
    navigationStyles: ['sidebar', 'rail', 'bottom'],
    component: FinanceShellFrame,
  },
  resources: Object.values(financeResources),
  views: financeViews,
  layouts: [financeLayout],
  settings: [financeSettings],
});

export const financeRegistry = createSlopstackRegistry(financeApplication).registry;

export function financeViewForPath(pathname: string) {
  return resolveView([...financeRegistry.views.values()], pathname)?.view
    ?? financeRegistry.views.get('dashboard')!;
}
