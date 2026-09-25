import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { Dashboard } from './Dashboard';

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/admin/login', { password });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setup-page">
      <div className="setup">
        <div className="su-card">
          <h2>Dashboard</h2>
          <p className="lead">Enter the password to manage stages.</p>
          <form onSubmit={submit}>
            <input
              className="inp"
              type="password"
              placeholder="Password"
              aria-label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            {error && <div className="errmsg">{error}</div>}
            <div className="su-actions">
              <span />
              <button className="btn primary" type="submit" disabled={busy || !password}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

/** `/admin`: password-gated production dashboard. */
export function Admin() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  const checkAuth = () => {
    api
      .get<{ authed: boolean; hasPassword: boolean }>('/api/admin/me')
      .then((me) => setAuthed(me.authed))
      .catch(() => setAuthed(false));
  };

  useEffect(() => {
    checkAuth();
  }, []);

  if (authed === null) {
    return (
      <main className="home">
        <p className="muted">Loading…</p>
      </main>
    );
  }
  if (!authed) return <LoginScreen onSuccess={() => setAuthed(true)} />;

  return <Dashboard />;
}
