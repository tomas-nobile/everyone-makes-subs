import { useEffect, useState } from 'react';
import { useStageStream } from '../hooks/useStageStream';
import { useEventInfo } from '../hooks/useEventInfo';
import { detectLang, LANG_META, STRINGS, subLabel, type Lang } from '../i18n';

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

  const { talk, state, segments, lastLag } = useStageStream(stageId);
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
            {segments.map((s) => {
              const text = isOriginal ? s.text : s.tr[lang];
              if (s.kind !== 'speech') return null;
              return (
                <p key={s.seq} className="cap recent">
                  {text ?? s.text}
                </p>
              );
            })}
          </div>
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
