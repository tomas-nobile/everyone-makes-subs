import { useState } from 'react';
import type { AdminStage, StageMetrics } from '../../../shared/contract';
import { Qr } from './Qr';
import { OverlayConfigurator } from './OverlayConfigurator';
import { api } from '../lib/api';

type Tab = 'talk' | 'audio' | 'share' | 'downloads' | 'tecnico';
const TABS: { id: Tab; label: string }[] = [
  { id: 'talk', label: 'Talk' },
  { id: 'audio', label: 'Audio' },
  { id: 'share', label: 'Share' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'tecnico', label: 'Technical' },
];

const LANG_NAMES: Record<string, string> = { es: 'Español', en: 'English', pt: 'Português' };

function sourceDescription(stage: AdminStage): string {
  switch (stage.source.kind) {
    case 'station':
      return 'Room laptop';
    case 'url':
      return `YouTube or stream link · ${stage.source.url}`;
    case 'file':
      return `Audio/video file · ${stage.source.path}`;
    case 'mediamtx':
      return `RTMP/SRT · ${stage.source.path}`;
  }
}

export function StageDrawer({
  stage,
  metrics,
  publicUrl,
  onClose,
  onChanged,
  onEdit,
  initialTab,
}: {
  stage: AdminStage;
  metrics: StageMetrics | undefined;
  publicUrl: string;
  onClose: () => void;
  onChanged: () => void;
  onEdit: () => void;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'talk');
  const [newTerm, setNewTerm] = useState('');
  const [showOverlayConfig, setShowOverlayConfig] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const talk = stage.talks.find((t) => t.id === stage.talkId) ?? null;
  const vocab = metrics?.vocab ?? [];

  const copy = (key: string, text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const addTerm = async () => {
    const term = newTerm.trim();
    if (!term || !talk) return;
    setNewTerm('');
    const glossary = { ...talk.glossary, asrVocabulary: [...talk.glossary.asrVocabulary, term] };
    await api.put(`/api/talks/${talk.id}/glossary`, glossary).catch(() => {});
    onChanged();
  };

  const nextTalk = async () => {
    await api.post(`/api/stages/${stage.id}/next-talk`).catch(() => {});
    onChanged();
  };

  const running = metrics ? metrics.state !== 'idle' : false;
  const toggleRunning = async () => {
    await api.post(`/api/stages/${stage.id}/${running ? 'stop' : 'start'}`).catch(() => {});
    onChanged();
  };
  const deleteStage = async () => {
    if (!window.confirm(`Delete "${stage.name}"? This cannot be undone.`)) return;
    await api.del(`/api/stages/${stage.id}`).catch(() => {});
    onChanged();
    onClose();
  };

  return (
    <>
      <div className="drawer-scrim show" onClick={onClose} />
      <aside className="drawer show" aria-label="Stage details">
        <div className="dr-head">
          <h2>{stage.name}</h2>
          <button className="btn sm" onClick={toggleRunning}>
            {running ? 'Stop' : 'Start'}
          </button>
          <button className="btn sm" onClick={onEdit}>
            Edit
          </button>
          <button className="btn sm danger" onClick={deleteStage}>
            Delete
          </button>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="dr-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="dr-body">
          {tab === 'talk' && (
            <>
              <div className="dr-sec">
                <h4>Now</h4>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{talk?.title ?? '—'}</div>
                <div style={{ color: 'var(--muted)', fontSize: 14 }}>{talk?.speaker ?? ''}</div>
              </div>
              <div className="dr-sec">
                <h4>Next</h4>
                <div style={{ fontSize: 15 }}>{stage.next?.title ?? '—'}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button className="btn primary sm" onClick={nextTalk} disabled={!stage.next}>
                    Switch to next talk
                  </button>
                </div>
              </div>
              <div className="dr-sec">
                <h4>Talk vocabulary</h4>
                <p className="help" style={{ margin: '0 0 10px' }}>
                  Gemini built it from the title and abstract. The number shows how many times each term has been recognized so far in this talk.
                </p>
                {(talk?.glossary.asrVocabulary ?? []).map((term) => {
                  const count = vocab.find((v) => v.term.toLowerCase() === term.toLowerCase())?.count ?? 0;
                  return (
                    <span key={term} className={`gchip${count ? '' : ' zero'}`}>
                      {term} <span className="c">{count ? `✓ ${count}` : '—'}</span>
                    </span>
                  );
                })}
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <input
                    className="inp"
                    placeholder="Add term…"
                    style={{ padding: '8px 10px', fontSize: 14 }}
                    value={newTerm}
                    onChange={(e) => setNewTerm(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addTerm()}
                  />
                  <button className="btn sm" onClick={addTerm}>
                    Add
                  </button>
                </div>
                <p className="help">Changes apply to translation right away and to speech recognition at the speaker's next pause.</p>
              </div>
              {talk && Object.keys(talk.glossary.replacements).length > 0 && (
                <div className="dr-sec">
                  <h4>Auto-corrections</h4>
                  <div className="kv">
                    {Object.entries(talk.glossary.replacements).map(([from, to]) => (
                      <span key={from}>
                        <span>{from}</span>
                        <span>{to}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {talk && talk.glossary.doNotTranslate.length > 0 && (
                <div className="dr-sec">
                  <h4>Do not translate</h4>
                  {talk.glossary.doNotTranslate.map((t) => (
                    <span key={t} className="gchip">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'audio' && (
            <>
              <div className="dr-sec">
                <h4>Where does the audio come from?</h4>
                <div className="src" aria-checked="true">
                  <span className="r" />
                  <span>
                    <span className="t">{sourceDescription(stage)}</span>
                  </span>
                </div>
              </div>
              {stage.source.kind === 'station' && (
                <div className="dr-sec">
                  <h4>Station link</h4>
                  <div className="share-row" style={{ border: 0 }}>
                    <div className="qr">
                      <Qr data={`${publicUrl}/station/${stage.id}?key=${stage.stationKey}`} />
                    </div>
                    <div className="t">
                      Open it on the room laptop
                      <small>
                        {publicUrl}/station/{stage.id}?key=•••
                      </small>
                    </div>
                    <button className="btn sm" onClick={() => copy('station', `${publicUrl}/station/${stage.id}?key=${stage.stationKey}`)}>
                      {copiedKey === 'station' ? 'Copied ✓' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'share' && (
            <>
              <div className="share-row">
                <div className="qr">
                  <Qr data={`${publicUrl}/s/${stage.id}`} />
                </div>
                <div className="t">
                  <b>Attendees (phone)</b>
                  <small>/s/{stage.id} · language is picked automatically</small>
                </div>
                <button className="btn sm" onClick={() => copy('phone', `${publicUrl}/s/${stage.id}`)}>
                  {copiedKey === 'phone' ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
              <div className="share-row">
                <div className="qr">
                  <Qr data={`${publicUrl}/s/${stage.id}/tv?lang=es&qr=1`} />
                </div>
                <div className="t">
                  <b>Room screen</b>
                  <small>
                    /s/{stage.id}/tv?lang=es&qr=1
                  </small>
                </div>
                <button className="btn sm" onClick={() => copy('tv', `${publicUrl}/s/${stage.id}/tv?lang=es&qr=1`)}>
                  {copiedKey === 'tv' ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
              <div className="share-row">
                <div className="qr">
                  <Qr data={`${publicUrl}/s/${stage.id}/overlay`} />
                </div>
                <div className="t">
                  <b>OBS overlay</b>
                  <small>Set language, size and position</small>
                </div>
                <button className="btn sm" onClick={() => setShowOverlayConfig((v) => !v)}>
                  Configure
                </button>
              </div>
              {showOverlayConfig && (
                <div style={{ marginTop: 12 }}>
                  <OverlayConfigurator publicUrl={publicUrl} stageId={stage.id} defaultLang="es" />
                </div>
              )}
              <p className="help">The address is fixed. If internet access goes down, you'll see an alert at the top of the dashboard.</p>
            </>
          )}

          {tab === 'downloads' && (
            <div className="dr-sec">
              <h4>Transcripts</h4>
              {stage.talks.length === 0 && <p className="help">No talks yet.</p>}
              {stage.talks.map((t) => (
                <div key={t.id} className="dr-sec" style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 14.5, marginBottom: 6 }}>
                    {t.title} {t.status === 'live' ? '(in progress)' : ''}
                  </div>
                  {['original', ...stage.targetLangs].map((lang) => (
                    <div key={lang} className="dl">
                      <span style={{ color: 'var(--muted)' }}>{lang === 'original' ? `${LANG_NAMES[t.lang ?? ''] ?? t.lang ?? 'Original'} (original)` : LANG_NAMES[lang] ?? lang}</span>
                      {(['txt', 'srt', 'vtt'] as const).map((fmt) => (
                        <a key={fmt} className="btn sm" href={`/api/talks/${t.id}/export.${fmt}${lang === 'original' ? '' : `?lang=${lang}`}`}>
                          {fmt.toUpperCase()}
                        </a>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {tab === 'tecnico' && metrics && (
            <>
              <div className="dr-sec">
                <h4>Last 50 lines</h4>
                <div className="kv">
                  <span>Original delay p50 / p95</span>
                  <span>{metrics.delay ? `${metrics.delay.p50.toFixed(1)} s / ${metrics.delay.p95.toFixed(1)} s` : '—'}</span>
                  <span>Translation delay p50 / p95</span>
                  <span>{metrics.delay ? `${metrics.delay.p50Tr.toFixed(1)} s / ${metrics.delay.p95Tr.toFixed(1)} s` : '—'}</span>
                  <span>Lag behind the audio</span>
                  <span>{metrics.lag.toFixed(1)} s</span>
                </div>
              </div>
              <div className="dr-sec">
                <h4>Session</h4>
                <div className="kv">
                  <span>Rotations / max gap</span>
                  <span>
                    {metrics.rotations} / {metrics.maxGapMs} ms
                  </span>
                  <span>Reconnections</span>
                  <span>{metrics.reconnects}</span>
                  <span>Errors / min</span>
                  <span>{metrics.errorsPerMin}</span>
                  <span>429 errors</span>
                  <span>{metrics.http429}</span>
                  <span>Models</span>
                  <span>
                    {metrics.model.transcribe} / {metrics.model.translate}
                  </span>
                </div>
              </div>
              <div className="dr-sec">
                <h4>Estimated cost</h4>
                <div className="kv">
                  <span>This stage, per hour</span>
                  <span>US${metrics.costPerHour.toFixed(2)}</span>
                  <span>Audio minutes sent</span>
                  <span>{metrics.audioMin.toFixed(1)}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
