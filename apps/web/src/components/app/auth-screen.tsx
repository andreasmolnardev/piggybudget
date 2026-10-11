import { useEffect, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { Check, Eye, EyeOff } from 'lucide-react';
import { apiRequest } from '../../api/client';
import { pb } from '../../api/pocketbase';

export function AuthScreen({ mode }: { mode: 'login' | 'register' }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [registrationMode, setRegistrationMode] = useState<'disabled' | 'approval' | 'otp'>(
    'approval',
  );
  const [ssoProviders, setSsoProviders] = useState<{ name: string; displayName: string }[]>([]);
  const [ssoBusy, setSsoBusy] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  useEffect(() => {
    if (mode !== 'login') return;
    const url = new URL(window.location.href);
    const token = url.searchParams.get('token');
    if (!import.meta.env.DEV) return;

    if (!token) {
      const requested = sessionStorage.getItem('piggybudget-dev-login-requested');
      if (requested) return;
      sessionStorage.setItem('piggybudget-dev-login-requested', 'true');
      void apiRequest<{ token: string }>('/api/auth/guest', { method: 'POST' })
        .then((result) => {
          url.searchParams.set('token', result.token);
          window.location.assign(url.toString());
        })
        .catch(() => {
          sessionStorage.removeItem('piggybudget-dev-login-requested');
          setError('Could not get a dev login link. Is the API running?');
        });
      return;
    }

    sessionStorage.removeItem('piggybudget-dev-login-requested');
    url.searchParams.delete('token');
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
    pb.authStore.save(token);
    void pb
      .collection('users')
      .authRefresh()
      .catch(() => {
        pb.authStore.clear();
        setError('Could not sign in with the dev login link.');
      });
  }, [mode]);
  useEffect(() => {
    if (mode !== 'login') return;
    void pb
      .collection('users')
      .listAuthMethods()
      .then((methods) => {
        if (methods.oauth2.enabled) {
          setSsoProviders(
            methods.oauth2.providers.map(({ name, displayName }) => ({ name, displayName })),
          );
        }
      })
      .catch(() => setSsoProviders([]));
  }, [mode]);
  useEffect(() => {
    if (mode !== 'register') return;
    void apiRequest<{ mode: 'disabled' | 'approval' | 'otp' }>('/api/auth/registration-policy')
      .then((policy) => setRegistrationMode(policy.mode))
      .catch(() => setError('Could not load registration settings.'));
  }, [mode]);
  const handleSso = async (provider: string) => {
    setSsoBusy(true);
    setError('');
    try {
      await pb.collection('users').authWithOAuth2({ provider });
    } catch {
      setError('Could not sign in with SSO. Try again.');
    } finally {
      setSsoBusy(false);
    }
  };
  const handleGuestAuth = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await apiRequest<{
        token: string;
        record: {
          id: string;
          collectionId: string;
          collectionName: string;
          [key: string]: unknown;
        };
      }>('/api/auth/guest', { method: 'POST' });
      pb.authStore.save(result.token, result.record);
    } catch {
      setError('Could not authenticate as a guest.');
    } finally {
      setBusy(false);
    }
  };
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'login' && resetMode) {
        await pb.collection('users').requestPasswordReset(email);
        setMessage('If an account uses that email, a password reset link will arrive shortly.');
        return;
      }
      if (mode === 'register') {
        if (registrationMode === 'disabled') return;
        await pb.collection('users').create({ email, password, passwordConfirm: password });
        setMessage(
          registrationMode === 'otp'
            ? 'Account created. Read the activation code in the server logs, then ask an administrator to activate your account.'
            : 'Account created. An administrator must approve it before you can sign in.',
        );
        return;
      }
      await pb.collection('users').authWithPassword(email, password);
    } catch {
      setError(
        mode === 'register'
          ? 'Could not create your account. Check your details.'
          : 'Could not sign in. Check your email and password.',
      );
    } finally {
      setBusy(false);
    }
  };
  const disabled = mode === 'register' && registrationMode === 'disabled';
  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="sidebar-brand">
          <Check size={22} />
        </div>
        <h1>
          {mode === 'register'
            ? 'Create your account'
            : resetMode
              ? 'Reset your password'
              : 'Welcome back'}
        </h1>
        {mode === 'login' && (
          <p>
            {resetMode
              ? 'Enter your email and we’ll send a password reset link if an account matches.'
              : 'Sign in to see your money clearly.'}
          </p>
        )}
        {message && <div className="auth-message">{message}</div>}
        {!disabled && (
          <>
            <label>
              Email
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            {mode === 'register' || !resetMode ? (
              <label>
                Password
                <span className="auth-password-input">
                  <input
                    type={passwordVisible ? 'text' : 'password'}
                    required
                    minLength={mode === 'register' ? 8 : undefined}
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    className="auth-password-toggle"
                    type="button"
                    aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                    onClick={() => setPasswordVisible((visible) => !visible)}
                  >
                    {passwordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </span>
                {mode === 'register' && (
                  <small className="auth-field-hint">Use at least 8 characters.</small>
                )}
              </label>
            ) : null}
          </>
        )}
        {error && <div className="auth-error">{error}</div>}
        {!disabled && (
          <button className="button button-primary auth-submit" disabled={busy || ssoBusy}>
            {busy
              ? mode === 'register'
                ? 'Creating account…'
                : resetMode
                  ? 'Sending link…'
                  : 'Signing in…'
              : mode === 'register'
                ? 'Create account'
                : resetMode
                  ? 'Send reset link'
                  : 'Sign in'}
          </button>
        )}
        {mode === 'login' && !resetMode && (
          <button
            className="auth-text-action"
            type="button"
            onClick={() => {
              setResetMode(true);
              setError('');
              setMessage('');
            }}
          >
            Forgot password?
          </button>
        )}
        {mode === 'login' && !resetMode && ssoProviders.length > 0 && (
          <div className="sso-options">
            <div className="sso-divider">or</div>
            {ssoProviders.map((provider) => (
              <button
                key={provider.name}
                type="button"
                className="button auth-sso"
                disabled={busy || ssoBusy}
                onClick={() => void handleSso(provider.name)}
              >
                {ssoBusy ? 'Opening SSO…' : `Sign in with ${provider.displayName}`}
              </button>
            ))}
          </div>
        )}
        {resetMode ? (
          <button
            className="auth-text-action"
            type="button"
            onClick={() => {
              setResetMode(false);
              setError('');
              setMessage('');
            }}
          >
            Back to sign in
          </button>
        ) : (
          <p className="auth-switch">
            {mode === 'register' ? 'Already have an account?' : 'Need an account?'}{' '}
            <Link to={mode === 'register' ? '/auth/login' : '/auth/register'}>
              {mode === 'register' ? 'Sign in' : 'Sign up'}
            </Link>
          </p>
        )}
        {mode === 'login' && !resetMode && import.meta.env.DEV && (
          <button
            type="button"
            className="button auth-guest"
            disabled={busy}
            onClick={() => void handleGuestAuth()}
          >
            {busy ? 'Authenticating…' : 'Authenticate as guest'}
          </button>
        )}
      </form>
    </main>
  );
}
