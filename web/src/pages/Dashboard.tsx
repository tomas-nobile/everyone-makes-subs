import { useState } from 'react';
import { useAdminMetrics } from '../hooks/useAdminMetrics';
import { StageCard } from '../components/StageCard';
import { Qr } from '../components/Qr';

/** The authed `/admin` body: header, alerts, and one card per stage (F09.2/.3). */
export function Dashboard() {
  const { metrics } = useAdminMetrics(true);
  const [techVisible, setTechVisible] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [printing, setPrinting] = useState(false);

  if (!metrics) {
    return (
      <div className="admin-page">
        <div className="admin">
          <p className="muted">Loading…</p>
        </div>
      </div>
    );
  }

  const copyPublicUrl = () => {
    navigator.clipboard.writeText(metrics.publicUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`admin-page${techVisible ? ' show-tech' : ''}`}>
      <div className="admin" id="admin">
        <div className="ad-head">
          <div>
            <h1>{metrics.eventName}</h1>
            <div className="meta">
              <b style={{ color: 'var(--text)' }}>{metrics.totalViewers.toLocaleString()}</b> people reading · {metrics.stagesLive} of {metrics.stages.length}{' '}
              stages live
            </div>
          </div>
          <div className="spacer" />
          {metrics.publicUrl && (
            <div className="pub">
              <span className={`badge ${metrics.reachable === false ? 'bad' : 'ok'}`} style={{ fontSize: 11, padding: '2px 8px' }}>
                {metrics.reachable === false ? 'Unreachable' : 'Reachable'}
              </span>
              <span style={{ color: 'var(--dim)' }}>Public address</span>
              <code>{metrics.publicUrl}</code>
              <button className="btn sm" onClick={copyPublicUrl}>
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
          )}
          <button className="btn" onClick={() => setPrinting(true)}>
            Print QR codes for all stages
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--muted)' }}>
            <input type="checkbox" className="switch" checked={techVisible} onChange={(e) => setTechVisible(e.target.checked)} />
            Technical details
          </label>
        </div>

        <div className="grid">
          {metrics.stages.map((m) => (
            <StageCard key={m.id} m={m} selected={selected === m.id} techVisible={techVisible} onOpen={() => setSelected(m.id)} />
          ))}
        </div>

        {selected && <p className="muted" style={{ marginTop: 16 }}>Stage details panel: coming in F09.4.</p>}
      </div>

      {printing && (
        <div id="printArea" className="admin" style={{ padding: 24 }}>
          <button className="btn" style={{ marginBottom: 16 }} onClick={() => window.print()}>
            Print
          </button>
          <button className="btn ghost ems-no-print" style={{ marginLeft: 8, marginBottom: 16 }} onClick={() => setPrinting(false)}>
            Close
          </button>
          <div className="grid">
            {metrics.stages.map((s) => (
              <div key={s.id} className="card">
                <h3>{s.name}</h3>
                <Qr className="qr" data={`${metrics.publicUrl}/s/${s.id}`} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
