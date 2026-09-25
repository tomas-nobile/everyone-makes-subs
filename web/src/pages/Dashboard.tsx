import { useState } from 'react';
import { useAdminMetrics } from '../hooks/useAdminMetrics';
import { useAdminStages } from '../hooks/useAdminStages';
import { StageCard } from '../components/StageCard';
import { StageDrawer } from '../components/StageDrawer';
import { Qr } from '../components/Qr';
import { api } from '../lib/api';
import type { Alert } from '../../../shared/contract';

function AlertRow({ alert, onFix, onSwitchNow, onSnooze }: { alert: Alert; onFix: (stageId: string) => void; onSwitchNow: () => void; onSnooze: () => void }) {
  const isSwitch = alert.kind === 'talk_switch';
  return (
    <div className={`alert ${isSwitch ? 'info' : 'bad'}`}>
      <span className="grow">{alert.message}</span>
      {alert.kind === 'no_audio' && alert.stageId && (
        <button className="btn sm" onClick={() => onFix(alert.stageId!)}>
          How to fix it
        </button>
      )}
      {isSwitch && (
        <>
          <button className="btn sm primary" onClick={onSwitchNow}>
            Switch now
          </button>
          <button className="btn sm ghost" onClick={onSnooze}>
            Wait 5 min
          </button>
        </>
      )}
    </div>
  );
}

/** The authed `/admin` body: header, alerts, and one card per stage (F09.2/.3). */
export function Dashboard() {
  const { metrics } = useAdminMetrics(true);
  const { stages: adminStages, refetch: refetchStages } = useAdminStages();
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

        {metrics.alerts.length > 0 && (
          <div className="alerts">
            {metrics.alerts.map((a) => (
              <AlertRow
                key={a.id}
                alert={a}
                onFix={(stageId) => setSelected(stageId)}
                onSwitchNow={() => a.stageId && api.post(`/api/stages/${a.stageId}/next-talk`).catch(() => {})}
                onSnooze={() => api.post(`/api/alerts/${a.id}/snooze`).catch(() => {})}
              />
            ))}
          </div>
        )}

        <div className="grid">
          {metrics.stages.map((m) => (
            <StageCard key={m.id} m={m} selected={selected === m.id} techVisible={techVisible} onOpen={() => setSelected(m.id)} />
          ))}
        </div>

      </div>

      {selected &&
        (() => {
          const adminStage = adminStages.find((s) => s.id === selected);
          const stageMetrics = metrics.stages.find((s) => s.id === selected);
          if (!adminStage) return null;
          return (
            <StageDrawer
              stage={adminStage}
              metrics={stageMetrics}
              publicUrl={metrics.publicUrl}
              onClose={() => setSelected(null)}
              onChanged={refetchStages}
            />
          );
        })()}

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
