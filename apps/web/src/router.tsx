import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useNavigate,
} from '@tanstack/react-router';
import { useEffect } from 'react';
import { App } from './app';
import { AuthScreen } from './components/app/auth-screen';
import { pb } from './api/pocketbase';

const rootRoute = createRootRoute({ component: Outlet });

const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_authenticated',
  beforeLoad: () => {
    if (!pb.authStore.isValid) throw redirect({ to: '/auth/login' });
  },
});

const financeRoutes = [
  createRoute({ getParentRoute: () => authenticatedRoute, path: '/', component: App }),
  createRoute({ getParentRoute: () => authenticatedRoute, path: '/transactions', component: App }),
  createRoute({ getParentRoute: () => authenticatedRoute, path: '/budgets', component: App }),
  createRoute({ getParentRoute: () => authenticatedRoute, path: '/assets', component: App }),
  createRoute({ getParentRoute: () => authenticatedRoute, path: '/goals', component: App }),
  createRoute({ getParentRoute: () => authenticatedRoute, path: '/settings', component: App }),
];

function AuthRoute({ mode }: { mode: 'login' | 'register' }) {
  const navigate = useNavigate();

  useEffect(
    () =>
      pb.authStore.onChange((_token, record) => {
        if (record) void navigate({ to: '/', replace: true });
      }),
    [navigate],
  );

  return <AuthScreen mode={mode} />;
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/login',
  beforeLoad: () => {
    if (pb.authStore.isValid) throw redirect({ to: '/' });
  },
  component: () => <AuthRoute mode="login" />,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/register',
  beforeLoad: () => {
    if (pb.authStore.isValid) throw redirect({ to: '/' });
  },
  component: () => <AuthRoute mode="register" />,
});

const routeTree = rootRoute.addChildren([
  authenticatedRoute.addChildren(financeRoutes),
  loginRoute,
  registerRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
