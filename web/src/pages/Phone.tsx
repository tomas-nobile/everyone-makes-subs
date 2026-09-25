import { useEffect, useState } from 'react';
import { useStageStream } from '../hooks/useStageStream';
import { useEventInfo } from '../hooks/useEventInfo';
import { detectLang, LANG_META, STRINGS, subLabel, type Lang } from '../i18n';
import { maskLive } from '../lib/captionText';
import type { Segment } from '../../../shared/contract';

const BAR_COUNT = 5;

/** Same wobble formula as the prototype: a per-bar sine offset so the bars don't all pulse in lockstep. */
function barHeight(level: number, index: number): number {
  const v = level * 16 * (0.55 + Math.abs(Math.sin(Date.now() / 140 + index * 1.3)) * 0.6);
  return Math.max(3, Math.min(16, v));
}

function SpeakingBars({ level, active }: { level: number; active: boolean }) {
  return (
    <span className="bars" aria-hidden="true">
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <i key={i} style={{ height: `${active ? barHeight(level, i) : 3}px` }} />
      ))}
    </span>
  );
}

function LiveLine({ lang, isOriginal, live, level, showLiveOrig }: { lang: Lang; isOriginal: boolean; live: string; level: number; showLiveOrig: boolean }) {
  const T = STRINGS[lang];
  if (isOriginal) {
    if (live) {
      const m = maskLive(live);
      return (
        <div className="live-line" aria-hidden="true">
          {m.allMasked ? <span className="mask">{m.text}</span> : <>{m.stable} <span className="mask">…</span></>}
        </div>
      );
    }
    return (
      <div className="speaking" style={{ opacity: 0.5 }} aria-hidden="true">
        <SpeakingBars level={level} active={false} />
      </div>
    );
  }
  const active = live.length > 0;
  return (
    <div aria-hidden="true">
      <div className="speaking" style={{ opacity: active ? 1 : 0.45 }}>
        <SpeakingBars level={level} active={active} />
        <span>{active ? `${T.translating.replace('…', '')}…` : ''}</span>
      </div>
      {showLiveOrig && live && (
        <div className="live-orig">
          <span>{live}</span>
        </div>
      )}
    </div>
  );
}

function Caption({ seg, lang, isOriginal, recent, bilingual, sound }: { seg: Segment; lang: Lang; isOriginal: boolean; recent: boolean; bilingual: boolean; sound: string }) {
  const T = STRINGS[lang];
  if (seg.kind !== 'speech') {
    return <div className="sound">♪ {sound}</div>;
  }
  if (isOriginal) {
    return <p className={`cap${recent ? ' recent' : ''}`}>{seg.text}</p>;
  }
  const tr = seg.tr[lang];
  if (tr === undefined) {
    return (
      <p className="cap pending" aria-hidden="true">
        {T.translating}
      </p>
    );
  }
  if (tr === null) {
    // Translation failed: fall back to the original, always shown muted (never "recent").
    return <p className="cap">{seg.text}</p>;
  }
  return (
    <p className={`cap${recent ? ' recent' : ''}`}>
      {tr}
      {bilingual && <span className="orig">{seg.text}</span>}
    </p>
  );
}

function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        // ignored: e.g. tab not visible, or unsupported — captions still work without it
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !cancelled) request();
    };
    request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      sentinel?.release().catch(() => {});
    };
  }, [enabled]);
}

export function Phone({ stageId }: { stageId: string }) {
  const params = new URLSearchParams(location.search);
  const explicitLang = params.get('lang');
  const [lang, setLang] = useState<Lang>(() => detectLang(explicitLang));
  const [showToast, setShowToast] = useState(!explicitLang);

  const { talk, state, segments, live, level, lastLag } = useStageStream(stageId);
  const { data: event } = useEventInfo();
  const stage = event?.stages.find((s) => s.id === stageId);
  const stageName = stage?.name ?? stageId;

  useWakeLock(true);

  useEffect(() => {
    if (!showToast) return;
    const t = setTimeout(() => setShowToast(false), 6000);
    return () => clearTimeout(t);
  }, [showToast]);

  const srcLang = talk?.lang;
  const isOriginal = lang === srcLang || (!srcLang && lang === 'es');
  const T = STRINGS[lang];
  const lag = lastLag;

  const statusWord = state === 'no_signal' ? T.noAudio : state === 'paused' ? T.paused : state === 'idle' ? T.ended : T.live;

  return (
    <div className="stage">
      <div className="phone" id="phone">
        <div className="ph-top">
          <div className="ph-row">
            <div className="ph-room">
              <span className="dot" style={{ animationPlayState: state === 'live' ? 'running' : 'paused' }} />
              <span>
                {stageName} · {statusWord}
              </span>
            </div>
            <span className="lat" title="Delay measured from when the speaker finishes the sentence">
              {lag !== null ? `~${lag.toFixed(1)} s` : ''}
            </span>
          </div>
          <div>
            <div className="ph-talk">{talk?.title ?? '—'}</div>
            <div className="ph-speaker">{talk?.speaker ?? ''}</div>
          </div>
          <div className="ph-row">
            <button className="pill-btn" aria-haspopup="dialog">
              <span>{LANG_META[lang].name}</span>
              <span className="sub">{subLabel(lang, isOriginal)}</span> ▾
            </button>
          </div>
        </div>

        <div className="ph-body" id="phBody">
          <div aria-live="polite" aria-relevant="additions">
            {segments.slice(-30).map((s, idx, list) => (
              <Caption
                key={s.seq}
                seg={s}
                lang={lang}
                isOriginal={isOriginal}
                recent={idx >= list.length - 2}
                bilingual={false}
                sound={LANG_META[lang].sound}
              />
            ))}
          </div>
          {state === 'live' && <LiveLine lang={lang} isOriginal={isOriginal} live={live} level={level} showLiveOrig={true} />}
        </div>

        {showToast && (
          <div className="toast" role="status">
            <span dangerouslySetInnerHTML={{ __html: T.langToast(`<b>${LANG_META[lang].name}</b>`) }} />
            <button onClick={() => setShowToast(false)}>{T.langToastChange}</button>
          </div>
        )}

        <div className="ph-bottom">
          <button className="pill-btn" aria-haspopup="dialog">
            {T.whatDidIMiss}
          </button>
        </div>
      </div>
    </div>
  );
}
