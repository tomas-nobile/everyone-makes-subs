import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { navigate } from '../router';
import type { AgendaProposal, PublicMode, SetupState, TailscaleStatus } from '../../../shared/contract';

const STEP_COUNT = 4;

function useSetupState(): { state: SetupState | null; refresh: () => void } {
  const [state, setState] = useState<SetupState | null>(null);
  const refresh = () => {
    api
      .get<SetupState>('/api/setup/state')
      .then(setState)
      .catch(() => {});
  };
  useEffect(refresh, []);
  return { state, refresh };
}

/** Step 1 (F11.1): paste the Gemini key, test it live. */
function KeyStep({ onNext }: { onNext: () => void }) {
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const test = async () => {
    if (!key.trim()) {
      setMsg({ ok: false, text: 'Paste the key first.' });
      return;
    }
    setTesting(true);
    setMsg(null);
    try {
      await api.post('/api/setup/key', { key: key.trim() });
      setMsg({ ok: true, text: '✓ It works.' });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not verify the key.' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <h2>Connect Gemini</h2>
      <p className="lead">Everyone Makes Subs uses Gemini to listen and translate. You need an API key; it's free to try.</p>
      <ol>
        <li>
          Go to{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
            aistudio.google.com/apikey
          </a>{' '}
          and sign in with your Google account.
        </li>
        <li>
          Click <b>Create API key</b>.
        </li>
        <li>Copy it and paste it here.</li>
      </ol>
      <input className="inp mono" placeholder="AIza…" autoComplete="off" aria-label="Gemini API key" value={key} onChange={(e) => setKey(e.target.value)} />
      {msg && <div className={msg.ok ? 'okmsg' : 'errmsg'}>{msg.text}</div>}
      <p className="help">
        The key is stored only on this computer. The free tier is enough for testing, but Google uses the content to improve its products. For a
        real event, turn on billing.
      </p>
      <div className="su-actions">
        <span />
        <span style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={test} disabled={testing}>
            {testing ? 'Testing…' : 'Test'}
          </button>
          <button className="btn primary" onClick={onNext} disabled={!msg?.ok}>
            Next
          </button>
        </span>
      </div>
    </>
  );
}

/** Step 2 (F11.2): the dashboard password. */
function PasswordStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (password.length < 6) {
      setError('At least 6 characters.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/setup/password', { password });
      onNext();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h2>Choose a dashboard password</h2>
      <p className="lead">You'll need it to sign in from another computer or your phone. Attendees don't need it.</p>
      <input className="inp" type="password" placeholder="Password" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <div className="errmsg">{error}</div>}
      <div className="su-actions">
        <button className="btn ghost" onClick={onBack}>
          Back
        </button>
        <button className="btn primary" onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : 'Next'}
        </button>
      </div>
    </>
  );
}

/** Step 3 (F11.3/.4): public access — Tailscale checklist, Cloudflare, or LAN/own-URL. */
function AccessStep({ setupState, onNext, onBack }: { setupState: SetupState; onNext: () => void; onBack: () => void }) {
  const [mode, setMode] = useState<PublicMode>(setupState.publicMode ?? 'tailscale');
  const [showMore, setShowMore] = useState(mode === 'lan' || mode === 'url');
  const [ts, setTs] = useState<TailscaleStatus | null>(null);
  const [waitingConsent, setWaitingConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [cfToken, setCfToken] = useState('');
  const [cfHost, setCfHost] = useState('');
  const [ownUrl, setOwnUrl] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshTs = () => api.get<TailscaleStatus>('/api/setup/tailscale').then(setTs).catch(() => {});

  useEffect(() => {
    if (mode !== 'tailscale') return;
    refreshTs();
    pollRef.current = setInterval(refreshTs, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const installed = ts?.installed ?? false;
  const running = ts?.running ?? false;
  const funnel = ts?.funnel ?? false;

  const doUp = async () => {
    setBusy('up');
    await api.post('/api/setup/tailscale/up').catch(() => {});
    await refreshTs();
    setBusy(null);
  };
  const doFunnel = async () => {
    setBusy('funnel');
    try {
      const res = await api.post<TailscaleStatus>('/api/setup/tailscale/funnel');
      if (res.consentUrl) {
        window.open(res.consentUrl, '_blank', 'noopener');
        setWaitingConsent(true);
      }
      await refreshTs();
    } catch {
      // surfaced via ts.message on next poll
    } finally {
      setBusy(null);
    }
  };
  const doTest = async (url: string) => {
    setBusy('test');
    try {
      const result = await api.post<{ ok: boolean; message?: string }>('/api/setup/test', { url });
      setTestResult(result);
    } catch {
      setTestResult({ ok: false, message: 'Could not reach the address.' });
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (mode === 'tailscale' && funnel && ts?.url && waitingConsent) {
      setWaitingConsent(false);
      doTest(ts.url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funnel, ts?.url]);

  const connectCloudflare = async () => {
    setBusy('cf');
    try {
      const res = await api.post<{ ok: true; publicUrl: string }>('/api/setup/public', { mode: 'cloudflare', url: cfHost, token: cfToken });
      await doTest(res.publicUrl);
    } catch {
      setTestResult({ ok: false, message: 'Could not connect the tunnel.' });
    } finally {
      setBusy(null);
    }
  };

  const ready =
    (mode === 'tailscale' && installed && running && funnel && testResult?.ok) ||
    (mode === 'cloudflare' && Boolean(testResult?.ok)) ||
    mode === 'lan' ||
    mode === 'url';

  const finish = async () => {
    if (mode === 'lan') await api.post('/api/setup/public', { mode: 'lan' }).catch(() => {});
    if (mode === 'url') await api.post('/api/setup/public', { mode: 'url', url: ownUrl }).catch(() => {});
    onNext();
  };

  return (
    <div>
      <h2>How will phones connect?</h2>
      <p className="lead">Attendees scan a QR code on mobile data or any Wi-Fi. That QR code has to reach this computer over the internet, at a secure (https) address.</p>

      {(['tailscale', 'cloudflare'] as const).map((m) => (
        <button key={m} className="src" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}>
          <span className="r" />
          <span>
            <span className="t">
              {m === 'tailscale' ? 'With Tailscale' : 'With Cloudflare and my own domain'}
              {m === 'tailscale' && (
                <span className="badge ok" style={{ fontSize: 11, padding: '2px 8px', marginLeft: 4 }}>
                  Recommended
                </span>
              )}
            </span>
            <span className="s" style={{ display: 'block' }}>
              {m === 'tailscale' ? 'Free, no domain of your own needed. About 5 minutes.' : 'For large events. You need a domain on Cloudflare.'}
            </span>
          </span>
        </button>
      ))}
      {!showMore ? (
        <button className="btn sm ghost" style={{ margin: '2px 0 6px' }} onClick={() => setShowMore(true)}>
          Other options
        </button>
      ) : (
        (['lan', 'url'] as const).map((m) => (
          <button key={m} className="src" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}>
            <span className="r" />
            <span>
              <span className="t">{m === 'lan' ? 'This Wi-Fi only (for testing)' : 'I already have a server with a public address'}</span>
              <span className="s" style={{ display: 'block' }}>
                {m === 'lan' ? 'Nobody outside the network can connect.' : 'If you installed Everyone Makes Subs on a server with Docker.'}
              </span>
            </span>
          </button>
        ))
      )}

      <div className="acc-panel">
        {mode === 'tailscale' && (
          <ol className="acc-list">
            <li className={`acc-item ${installed ? 'done' : ''}`}>
              <span className="acc-n">{installed ? '✓' : 1}</span>
              <div className="acc-body">
                <div className="acc-t">Install Tailscale</div>
                <div className="acc-s">
                  {installed ? (
                    'Found Tailscale on this computer.'
                  ) : (
                    <>
                      <a className="btn sm" href="https://tailscale.com/download" target="_blank" rel="noopener noreferrer">
                        Download Tailscale
                      </a>{' '}
                      <button className="btn sm ghost" onClick={refreshTs}>
                        I've installed it
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
            <li className={`acc-item ${running ? 'done' : ''} ${installed ? '' : 'locked'}`}>
              <span className="acc-n">{running ? '✓' : 2}</span>
              <div className="acc-body">
                <div className="acc-t">Sign in</div>
                <div className="acc-s">
                  {running ? (
                    'Connected to your Tailscale account.'
                  ) : (
                    <button className="btn sm" onClick={doUp} disabled={!installed || busy === 'up'}>
                      {busy === 'up' ? 'Waiting for you to sign in…' : 'Open Tailscale to sign in'}
                    </button>
                  )}
                </div>
              </div>
            </li>
            <li className={`acc-item ${funnel ? 'done' : ''} ${running ? '' : 'locked'}`}>
              <span className="acc-n">{funnel ? '✓' : 3}</span>
              <div className="acc-body">
                <div className="acc-t">Turn on internet access</div>
                <div className="acc-s">
                  {funnel ? (
                    'Public access is on.'
                  ) : waitingConsent ? (
                    <span className="acc-wait">A Tailscale page opened in your browser. Click Enable (once) and come back here.</span>
                  ) : (
                    <button className="btn sm" onClick={doFunnel} disabled={!running || busy === 'funnel'}>
                      Turn on
                    </button>
                  )}
                </div>
              </div>
            </li>
            <li className={`acc-item ${testResult?.ok ? 'done' : ''} ${funnel ? '' : 'locked'}`}>
              <span className="acc-n">{testResult?.ok ? '✓' : 4}</span>
              <div className="acc-body">
                <div className="acc-t">Test from outside</div>
                <div className="acc-s">
                  {testResult?.ok
                    ? 'A phone on mobile data can connect.'
                    : busy === 'test'
                      ? 'Testing the address from the internet…'
                      : testResult?.message}
                </div>
              </div>
            </li>
          </ol>
        )}
        {mode === 'cloudflare' && (
          <>
            <p className="help">
              In{' '}
              <a href="https://dash.cloudflare.com" target="_blank" rel="noopener noreferrer">
                dash.cloudflare.com
              </a>
              : Zero Trust → Networks → Tunnels → Create a tunnel, and set the public hostname to service <code>http://localhost:8080</code>.
            </p>
            <input className="inp mono" placeholder="Token (eyJh…)" aria-label="Tunnel token" style={{ margin: '6px 0' }} value={cfToken} onChange={(e) => setCfToken(e.target.value)} />
            <input className="inp" placeholder="captions.yourevent.com" aria-label="Address" style={{ margin: '0 0 8px' }} value={cfHost} onChange={(e) => setCfHost(e.target.value)} />
            <button className="btn sm" onClick={connectCloudflare} disabled={!cfToken || !cfHost || busy === 'cf'}>
              {busy === 'cf' ? 'Connecting…' : 'Connect and test'}
            </button>
            {testResult && <p className={testResult.ok ? 'okmsg' : 'errmsg'}>{testResult.ok ? '✓ Connected.' : testResult.message}</p>}
          </>
        )}
        {mode === 'lan' && (
          <div className="acc-wait" style={{ marginTop: 4 }}>
            QR codes will point to <b>{setupState.lanUrl}</b>. It only works for people on this same Wi-Fi, and room laptops won't be able to send
            microphone audio. Use it for testing.
          </div>
        )}
        {mode === 'url' && (
          <>
            <input className="inp" placeholder="https://captions.yourserver.com" aria-label="Public address" style={{ marginTop: 4 }} value={ownUrl} onChange={(e) => setOwnUrl(e.target.value)} />
            <p className="help">For when Everyone Makes Subs runs on a server that already has its own HTTPS address.</p>
          </>
        )}
      </div>

      <div className="su-actions">
        <button className="btn ghost" onClick={onBack}>
          Back
        </button>
        <button className="btn primary" onClick={finish} disabled={!ready}>
          Next
        </button>
      </div>
    </div>
  );
}

const SAMPLE_AGENDA = `AUDITORIO
14:30 Observabilidad sin humo con OpenTelemetry — Lucía Fernández
Cómo instrumentamos 200 microservicios en Kubernetes con OTLP y tail-based sampling...
15:30 WebAssembly fuera del navegador: lo que nadie te cuenta — Martín Ibarra

SALA 2
14:45 Edge AI on a budget — Priya Raman (talk in English)
15:45 Rust para devs de Go — Sofía Paz`;

/** Step 4 (F10.2 UI): paste the schedule, confirm, save. */
function AgendaStep({ onBack }: { onBack: () => void }) {
  const [text, setText] = useState(SAMPLE_AGENDA);
  const [proposal, setProposal] = useState<AgendaProposal | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const parse = async () => {
    setParsing(true);
    try {
      setProposal(await api.post<AgendaProposal>('/api/agenda/parse', { text }));
    } catch {
      setResult('Could not read the schedule.');
    } finally {
      setParsing(false);
    }
  };

  const done = async () => {
    await api.post('/api/setup/done').catch(() => {});
    navigate('/admin');
  };

  const save = async () => {
    if (!proposal) return;
    setSaving(true);
    try {
      await api.post('/api/agenda', proposal);
      setResult(`✓ ${proposal.rooms.length} rooms and ${proposal.talks.length} talks.`);
    } catch {
      setResult('Could not save the schedule.');
    } finally {
      setSaving(false);
    }
  };

  const tryDemo = async () => {
    await api.post('/api/setup/demo').catch(() => {});
    done();
  };

  return (
    <>
      <h2>Add the rooms</h2>
      <p className="lead">Paste the schedule as it appears on the event website. We'll set up the rooms, times and vocabulary for each talk.</p>
      <textarea className="inp" aria-label="Schedule" value={text} onChange={(e) => setText(e.target.value)} />
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button className="btn" onClick={parse} disabled={parsing}>
          {parsing ? 'Reading…' : 'Read schedule'}
        </button>
        <button className="btn ghost" onClick={done}>
          Create rooms manually
        </button>
        <button className="btn ghost" onClick={tryDemo}>
          Try with sample data
        </button>
      </div>
      {proposal && (
        <table className="agenda">
          <thead>
            <tr>
              <th>Room</th>
              <th>Time</th>
              <th>Talk</th>
              <th>Language</th>
            </tr>
          </thead>
          <tbody>
            {proposal.talks.map((t, i) => (
              <tr key={i}>
                <td>{t.room}</td>
                <td>{t.start}</td>
                <td>
                  {t.title} {t.speaker && <span style={{ color: 'var(--dim)' }}>· {t.speaker}</span>}
                </td>
                <td>{t.lang ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {result && <div className="okmsg">{result}</div>}
      <div className="su-actions">
        <button className="btn ghost" onClick={onBack}>
          Back
        </button>
        <button className="btn primary" onClick={proposal && !result ? save : done} disabled={saving || (!proposal && !result)}>
          {saving ? 'Saving…' : result ? 'Go to dashboard' : 'Save schedule'}
        </button>
      </div>
    </>
  );
}

/** `/setup`: the first-run wizard (F11.1–.4), plus the F10.2 agenda-paste step. */
export function Setup() {
  const { state, refresh } = useSetupState();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (state?.keyFromEnv && step === 0) setStep(1);
    if (state?.hasPassword && step === 1 && state.keyFromEnv) setStep(2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!state) {
    return (
      <div className="setup-page">
        <div className="setup">
          <p className="muted">Loading…</p>
        </div>
      </div>
    );
  }

  const next = () => {
    refresh();
    setStep((s) => Math.min(s + 1, STEP_COUNT - 1));
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <div className="setup-page">
      <div className="setup">
        <div className="steps">
          {Array.from({ length: STEP_COUNT }, (_, i) => (
            <div key={i} className={i <= step ? 'on' : ''} />
          ))}
        </div>
        <div className="su-card">
          {step === 0 && <KeyStep onNext={next} />}
          {step === 1 && <PasswordStep onNext={next} onBack={back} />}
          {step === 2 && <AccessStep setupState={state} onNext={next} onBack={back} />}
          {step === 3 && <AgendaStep onBack={back} />}
        </div>
        <div className="notes" style={{ marginTop: 20 }}>
          <h2>Why it works this way</h2>
          <ul>
            <li>
              <b>Nobody edits a .env.</b> The desktop app opens this on first launch; in Docker it shows until a key is set.
            </li>
            <li>
              <b>"Test" makes a real call</b> and turns errors into plain language: invalid key, project without model access, out of quota.
            </li>
            <li>
              <b>Internet access is a guided checklist</b>, not a command.
            </li>
            <li>
              <b>The schedule is pasted as is</b>, copied from the website. Gemini turns it into rooms and talks, and you confirm before saving.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
