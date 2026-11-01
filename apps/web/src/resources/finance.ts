import { apiFetch } from '../api/client';
import {
  createEndpointResourceAdapter,
  createResourceClient,
  defineResource,
  type FieldDefinition,
} from '../lib/slopstack';

export type FinanceResourceRecord = Record<string, unknown> & { id: string };

const ownerRead = { authenticated: true } as const;

function financeResource(id: string, label: string, collection: string, fields: readonly FieldDefinition[], searchFields: string[]) {
  return defineResource<FinanceResourceRecord>({
    id,
    label,
    labelPlural: `${label}s`,
    description: `${label} records stored in Piggybudget's existing finance collection.`,
    source: {
      kind: 'endpoint',
      list: `/api/finance/${collection}`,
      get: `/api/finance/${collection}/{id}`,
      create: `/api/finance/${collection}`,
      update: `/api/finance/${collection}/{id}`,
      delete: `/api/finance/${collection}/{id}`,
    },
    fields,
    query: {
      searchFields,
      defaultSort: 'name',
      sortOptions: [{ label: 'Name', value: 'name' }, { label: 'Type', value: 'type' }],
      pageSize: 500,
    },
    permissions: { list: ownerRead, get: ownerRead, create: ownerRead, update: ownerRead, delete: ownerRead },
    identify: (record) => record.id,
  });
}

export const financeResources = {
  accounts: financeResource('accounts', 'Account', 'accounts', [
    { name: 'name', label: 'Name', kind: 'text', required: true, maxLength: 100 },
    { name: 'type', label: 'Account type', kind: 'select', options: [
      { label: 'Checking', value: 'checking' }, { label: 'Cash', value: 'cash' },
      { label: 'Savings', value: 'savings' }, { label: 'Credit card', value: 'credit' },
      { label: 'Other', value: 'other' },
    ] },
    { name: 'currency', label: 'Currency', kind: 'text', required: true, minLength: 3, maxLength: 3, pattern: '[A-Za-z]{3}' },
    { name: 'opening_balance', label: 'Opening balance', kind: 'number', required: true, step: 0.01 },
    { name: 'opening_balance_date', label: 'Opening balance date', kind: 'date' },
    { name: 'alert_below', label: 'Low balance alert', kind: 'number', min: 0, step: 0.01 },
    { name: 'notes', label: 'Notes', kind: 'text', multiline: true, maxLength: 1000 },
    { name: 'is_default', label: 'Default account', kind: 'boolean' },
    { name: 'archived', label: 'Archived', kind: 'boolean' },
  ], ['name', 'type']),
  transactions: financeResource('transactions', 'Transaction', 'transactions', [
    { name: 'payee', label: 'Payee', kind: 'text', required: true },
    { name: 'date', label: 'Date', kind: 'date', required: true },
    { name: 'amount', label: 'Amount', kind: 'number', required: true, step: 0.01 },
    { name: 'type', label: 'Kind', kind: 'text' },
    { name: 'category', label: 'Category', kind: 'text' },
    { name: 'budget', label: 'Budget', kind: 'text' },
    { name: 'description', label: 'Description', kind: 'text', multiline: true },
    { name: 'notes', label: 'Notes', kind: 'text', multiline: true },
    { name: 'is_draft', label: 'Draft', kind: 'boolean' },
  ], ['payee', 'category', 'description', 'notes']),
  budgets: financeResource('budgets', 'Budget', 'budgets', [
    { name: 'name', label: 'Name', kind: 'text', required: true },
    { name: 'category', label: 'Category', kind: 'text' },
    { name: 'amount', label: 'Limit', kind: 'number', step: 0.01 },
    { name: 'unlimited', label: 'Unlimited', kind: 'boolean' },
    { name: 'start_date', label: 'Starts', kind: 'date' },
    { name: 'end_date', label: 'Ends', kind: 'date' },
    { name: 'color', label: 'Color', kind: 'text' },
    { name: 'notes', label: 'Notes', kind: 'text', multiline: true },
    { name: 'archived', label: 'Archived', kind: 'boolean' },
  ], ['name', 'category', 'notes']),
  assets: financeResource('assets', 'Asset', 'assets', [
    { name: 'name', label: 'Name', kind: 'text', required: true },
    { name: 'type', label: 'Type', kind: 'text' },
    { name: 'value', label: 'Current value', kind: 'number', step: 0.01 },
    { name: 'purchase_price', label: 'Purchase price', kind: 'number', step: 0.01 },
    { name: 'purchase_date', label: 'Purchase date', kind: 'date' },
    { name: 'as_of', label: 'Value as of', kind: 'date' },
    { name: 'notes', label: 'Notes', kind: 'text', multiline: true },
    { name: 'archived', label: 'Archived', kind: 'boolean' },
  ], ['name', 'type', 'notes']),
  goals: financeResource('goals', 'Goal', 'goals', [
    { name: 'name', label: 'Name', kind: 'text', required: true },
    { name: 'target_amount', label: 'Target amount', kind: 'number', required: true, step: 0.01 },
    { name: 'current_amount', label: 'Saved so far', kind: 'number', step: 0.01 },
    { name: 'target_date', label: 'Target date', kind: 'date' },
    { name: 'status', label: 'Status', kind: 'text' },
    { name: 'notes', label: 'Notes', kind: 'text', multiline: true },
  ], ['name', 'notes']),
} as const;

const authenticatedFetch: typeof fetch = (input, init) => apiFetch(String(input), init);

export const financeResourceClients = Object.fromEntries(
  Object.entries(financeResources).map(([key, resource]) => [
    key,
    createResourceClient(resource, createEndpointResourceAdapter(resource, { fetcher: authenticatedFetch })),
  ]),
) as {
  [Key in keyof typeof financeResources]: ReturnType<typeof createResourceClient<FinanceResourceRecord, Partial<FinanceResourceRecord>, Partial<FinanceResourceRecord>>>;
};
