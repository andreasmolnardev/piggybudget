import { useState, type FormEvent } from 'react';
import PocketBase from 'pocketbase';
import { pb } from '../../api/pocketbase';

type OidcSettings = { enabled: boolean; clientId: string; issuer: string; jwksURL: string; authURL: string; tokenURL: string; userInfoURL: string };

export function SsoAdminPage() {
  const [admin] = useState(() => new PocketBase(pb.baseURL));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [issuer, setIssuer] = useState('');
  const [jwksURL, setJwksURL] = useState('');
  const [authURL, setAuthURL] = useState('');
  const [tokenURL, setTokenURL] = useState('');
  const [userInfoURL, setUserInfoURL] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function loadSettings() {
    const settings = await admin.send<OidcSettings>('/api/admin/sso/oidc2', { method: 'GET' });
    setEnabled(settings.enabled);
    setClientId(settings.clientId);
    setAuthURL(settings.authURL);
    setTokenURL(settings.tokenURL);
    setUserInfoURL(settings.userInfoURL);
    setIssuer(settings.issuer);
    setJwksURL(settings.jwksURL);
  }

  async function signIn(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await admin.collection('_superusers').authWithPassword(email.trim(), password);
      if (admin.authStore.record?.collectionName !== '_superusers') throw new Error('Superuser access is required.');
      setAuthenticated(true); setPassword(''); await loadSettings();
    } catch { admin.authStore.clear(); setError('Superuser sign-in failed. Check your credentials and access.'); }
    finally { setBusy(false); }
  }

  async function discover() {
    const cleanIssuer = issuer.trim().replace(/\/$/, '');
    if (!cleanIssuer) return;
    try {
      const parsed = new URL(cleanIssuer);
      if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') throw new Error('Issuer discovery requires HTTPS.');
      const urls = [...new Set([`${cleanIssuer}/.well-known/openid-configuration`, `${parsed.origin}/.well-known/openid-configuration${parsed.pathname}`])];
      let metadata: Record<string, string> | undefined;
      for (const url of urls) { const response = await fetch(url); if (response.ok) { metadata = await response.json() as Record<string, string>; break; } }
      if (!metadata?.authorization_endpoint || !metadata.token_endpoint) throw new Error('Discovery did not return authorization and token endpoints. Enter the endpoints below.');
      setIssuer(metadata.issuer || cleanIssuer); setAuthURL(metadata.authorization_endpoint); setTokenURL(metadata.token_endpoint);
      setUserInfoURL(''); setJwksURL(metadata.jwks_uri || ''); setError('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load OIDC discovery metadata.'); }
  }

  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      await admin.send('/api/admin/sso/oidc2', { method: 'PUT', body: {
        enabled, clientId: clientId.trim(), clientSecret,
        authURL: authURL.trim(), tokenURL: tokenURL.trim(), userInfoURL: userInfoURL.trim(),
        issuer: issuer.trim(), jwksURL: jwksURL.trim(),
      } });
      setClientSecret(''); setMessage('OIDC settings saved.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save OIDC settings.'); }
    finally { setBusy(false); }
  }

  return <main className="auth-screen"><section className="auth-card sso-admin-card">
    <h1>Custom OIDC provider</h1>
    {!authenticated ? <form onSubmit={(event) => void signIn(event)}>
      <p>Sign in with a PocketBase superuser account to manage provider settings.</p>
      <label>Superuser email<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <button className="button button-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form> : <form onSubmit={(event) => void save(event)}>
      <label className="sso-admin-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Enable OAuth sign-in</label>
      <label>Client ID<input value={clientId} onChange={(event) => setClientId(event.target.value)} autoComplete="off" /></label>
      <label>Client secret<input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder="Leave blank to keep the saved secret" autoComplete="new-password" /></label>
      <label>Issuer<input type="url" value={issuer} onChange={(event) => setIssuer(event.target.value)} placeholder="https://login.example.com/" /></label>
      <button className="button" type="button" disabled={!issuer || busy} onClick={() => void discover()}>Load discovery metadata</button>
      <label>Authorization endpoint<input type="url" value={authURL} onChange={(event) => setAuthURL(event.target.value)} /></label>
      <label>Token endpoint<input type="url" value={tokenURL} onChange={(event) => setTokenURL(event.target.value)} /></label>
      <p>Claims come from the signed ID token so PocketBase validates its issuer and signature using JWKS.</p>
      <label>JWKS URL<input type="url" value={jwksURL} onChange={(event) => setJwksURL(event.target.value)} /></label>
      <p>Enter endpoints directly if discovery is unavailable. The callback URL is <code>{pb.baseURL}/api/oauth2-redirect</code>.</p>
      <button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save OIDC settings'}</button>
      <button className="button" type="button" onClick={() => { admin.authStore.clear(); setAuthenticated(false); }}>Sign out</button>
    </form>}
    {message && <p role="status" className="auth-message">{message}</p>}
    {error && <p role="alert" className="auth-error">{error}</p>}
  </section></main>;
}
