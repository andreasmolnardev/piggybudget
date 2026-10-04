import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { App } from './app';

const rootRoute = createRootRoute({ component: App });

const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: '/' });
const transactionsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/transactions' });
const budgetsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/budgets' });
const assetsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/assets' });
const goalsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/goals' });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings' });
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/auth/login' });
const registerRoute = createRoute({ getParentRoute: () => rootRoute, path: '/auth/register' });

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  transactionsRoute,
  budgetsRoute,
  assetsRoute,
  goalsRoute,
  settingsRoute,
  loginRoute,
  registerRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
