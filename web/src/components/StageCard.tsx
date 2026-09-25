import type { StageMetrics } from '../../../shared/contract';

const MINI_BARS = 24;

interface Badge {
  label: string;
  cls: 'ok' | 'warn' | 'bad' | 'info' | 'off';
}

export function stageBadge(m: StageMetrics): Badge {
  switch (m.state) {
    case 'live':
    case 'paused':
      return { label: 'Live', cls: 'ok' };
    case 'no_signal':
      return { label: 'No audio', cls: 'bad' };
    case 'degraded':
      return { label: 'Delayed', cls: 'warn' };
    case 'error':
      return { label: 'Error', cls: 'bad' };
    case 'connecting':
      return { label: 'Starting…', cls: 'info' };
    case 'idle':
    default:
      return m.next ? { label: 'Break', cls: 'info' } : { label: 'Stopped', cls: 'off' };
  }
}

export function StageCard({ m, selected, onOpen, techVisible }: { m: StageMetrics; selected: boolean; onOpen: () => void; techVisible: boolean }) {
  const badge = stageBadge(m);
  const n = Math.round(m.level * MINI_BARS);
  const line = m.liveLine || m.lastLine;
  const isLive = Boolean(m.liveLine);

  return (
    <button className={`card${selected ? ' sel' : ''}${techVisible ? ' show-tech' : ''}`} aria-label={`${m.name}: ${badge.label}`} onClick={onOpen}>
      <div className="card-top">
        <h3>{m.name}</h3>
        <span className={`badge ${badge.cls}`}>{badge.label}</span>
      </div>
      <div className="mini-meter">
        {Array.from({ length: MINI_BARS }, (_, k) => (
          <i key={k} className={k < n ? 'on' : ''} />
        ))}
      </div>
      <div className={`lastline${line ? '' : ' empty'}`}>{line ? <span className={isLive ? 'g' : ''}>{line}</span> : 'No audio received yet'}</div>
      <div className="talkline">
        <span className="k">Now</span>
        {m.talk ? m.talk.title : '—'}
        {m.talk?.speaker && <span className="n"> · {m.talk.speaker}</span>}
      </div>
      <div className="talkline">
        <span className="k">Next</span>
        <span className="n">{m.next ? m.next.title : '—'}</span>
      </div>
      <div className="card-foot">
        {m.viewers > 0 && (
          <span>
            <b>{m.viewers}</b> reading
          </span>
        )}
        {m.delay && (
          <span>
            Delay <b>{m.delay.p50Tr.toFixed(1)} s</b>
          </span>
        )}
      </div>
      <div className="tech">
        p50/p95 {m.delay ? `${m.delay.p50.toFixed(1)}/${m.delay.p95.toFixed(1)} s` : '—'} · tr {m.delay ? `${m.delay.p50Tr.toFixed(1)}/${m.delay.p95Tr.toFixed(1)} s` : '—'} · lag {m.lag.toFixed(1)} s · rot #{m.rotations} · gap {m.maxGapMs} ms · reconn {m.reconnects} · {m.errorsPerMin} err/min · 429×{m.http429} · {m.model.transcribe}/{m.model.translate} · US${m.costPerHour.toFixed(2)}/h
      </div>
    </button>
  );
}
