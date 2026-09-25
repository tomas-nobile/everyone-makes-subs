import { useEffect, useRef, useState } from 'react';
import { useStageStream } from '../hooks/useStageStream';
import { useEventInfo } from '../hooks/useEventInfo';
import { detectLang, isLang, isOriginalLang, LANG_META, STRINGS, SUPPORTED_LANGS, subLabel, type Lang } from '../i18n';
import { formatTime, maskLive } from '../lib/captionText';
import { readPref, writePref } from '../lib/prefs';
import { useWakeLock } from '../hooks/useWakeLock';
import { useSummary } from '../hooks/useSummary';
import type { Segment, Talk } from '../../../shared/contract';

type AttendeeState = 'live' | 'paused' | 'no_signal' | 'break' | 'ended' | 'reconnecting';

interface PhonePrefs {
  size: number;
  bilingual: boolean;
  liveOrig: boolean;
  wakeScreen: boolean;
  stream: boolean;
  delay: number;
}
const DEFAULT_PREFS: PhonePrefs = { size: 26, bilingual: false, liveOrig: true, wakeScreen: true, stream: false, delay: 8 };

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

function StateCard({ attendeeState, lang, next, talk, onSummary }: { attendeeState: AttendeeState; lang: Lang; next: Talk | null; talk: Talk | null; onSummary: () => void }) {
  const T = STRINGS[lang];
  if (attendeeState === 'paused') {
    return <div className="speaking" style={{ fontSize: 14, margin: '0 0 8px' }}>⏸ {T.pausedTitle}</div>;
  }
  if (attendeeState === 'no_signal') {
    return (
      <div className="state-card" role="status">
        <h4>{T.noSignalTitle}</h4>
        <p>{T.noSignalBody}</p>
      </div>
    );
  }
  if (attendeeState === 'break') {
    return (
      <div className="state-card" role="status">
        <h4>{T.breakTitle(formatTime(next?.startsAt))}</h4>
        {next && <p>{T.breakBody(next.title, next.speaker ?? '')}</p>}
        <div className="row">
          <button className="btn sm" onClick={onSummary}>
            {T.seeSummary}
          </button>
        </div>
      </div>
    );
  }
  if (attendeeState === 'ended') {
    return (
      <div className="state-card" role="status">
        <h4>{T.endedTitle}</h4>
        <p>{T.endedBody}</p>
        <div className="row">
          {talk && (
            <>
              <a className="btn sm primary" href={`/api/talks/${talk.id}/export.txt?lang=${lang}`}>
                {T.downloadTxt}
              </a>
              <a className="btn sm" href={`/api/talks/${talk.id}/export.srt?lang=${lang}`}>
                {T.downloadSrt}
              </a>
            </>
          )}
          <button className="btn sm" onClick={onSummary}>
            {T.seeSummary}
          </button>
        </div>
      </div>
    );
  }
  return null;
}

export function Phone({ stageId }: { stageId: string }) {
  const params = new URLSearchParams(location.search);
  const explicitLang = params.get('lang');
  const storedLang = readPref<Lang | null>(`phone.${stageId}.lang`, null);
  const [lang, setLangState] = useState<Lang>(() => (isLang(explicitLang) ? explicitLang : (storedLang ?? detectLang(null))));
  const [showToast, setShowToast] = useState(!explicitLang && !storedLang);
  const [prefs, setPrefsState] = useState<PhonePrefs>(() => readPref(`phone.${stageId}.prefs`, DEFAULT_PREFS));
  const [sheet, setSheet] = useState<'lang' | 'aa' | 'sum' | null>(null);

  const setLang = (l: Lang) => {
    setLangState(l);
    writePref(`phone.${stageId}.lang`, l);
  };
  const setPrefs = (patch: Partial<PhonePrefs>) =>
    setPrefsState((prev) => {
      const next = { ...prev, ...patch };
      writePref(`phone.${stageId}.prefs`, next);
      return next;
    });

  const { talk, next, last, state, connected, gotHello, segments, live, level, lastLag, loadOlder } = useStageStream(stageId);
  const { summary, loading: summaryLoading } = useSummary(stageId, lang, sheet === 'sum');
  const { data: event } = useEventInfo();
  const stage = event?.stages.find((s) => s.id === stageId);
  const stageName = stage?.name ?? stageId;

  useWakeLock(prefs.wakeScreen);

  useEffect(() => {
    if (!showToast) return;
    const t = setTimeout(() => setShowToast(false), 6000);
    return () => clearTimeout(t);
  }, [showToast]);

  // F07.6: for stream viewers, hold each phrase back until it's `prefs.delay` seconds old so
  // captions line up with the (also delayed) video instead of racing ahead of it.
  const arrivalRef = useRef(new Map<number, { at: number; trAt?: number }>());
  useEffect(() => {
    const map = arrivalRef.current;
    for (const s of segments) {
      const entry = map.get(s.seq);
      if (!entry) {
        map.set(s.seq, { at: Date.now(), trAt: Object.keys(s.tr).length ? Date.now() : undefined });
      } else if (entry.trAt === undefined && Object.keys(s.tr).length) {
        entry.trAt = Date.now();
      }
    }
  }, [segments]);
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!prefs.stream) return;
    const id = setInterval(() => forceTick((t) => t + 1), 700);
    return () => clearInterval(id);
  }, [prefs.stream]);
  const visibleSegments = prefs.stream
    ? segments.filter((s) => {
        const entry = arrivalRef.current.get(s.seq);
        const readyAt = entry?.trAt ?? entry?.at ?? Date.now();
        return Date.now() - readyAt >= prefs.delay * 1000;
      })
    : segments;

  // F07.4: pause autoscroll once the attendee scrolls up more than 40px; "back to live" resumes it.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unread, setUnread] = useState(0);
  const prevSegCount = useRef(0);

  useEffect(() => {
    const grew = visibleSegments.length > prevSegCount.current;
    prevSegCount.current = visibleSegments.length;
    const el = bodyRef.current;
    if (!el) return;
    if (atBottom) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    } else if (grew) {
      setUnread((n) => n + 1);
    }
  }, [visibleSegments, live, atBottom]);

  // Only a real gesture pauses autoscroll: layout changes (new lines, older history) also fire scroll.
  const gestureAt = useRef(0);
  const onGesture = () => { gestureAt.current = Date.now(); };
  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const byUser = Date.now() - gestureAt.current < 1000;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (fromBottom < 40) {
      setAtBottom(true);
      setUnread(0);
    } else if (byUser) setAtBottom(false);
    if (byUser && el.scrollTop < 20) loadOlder();
  };

  const jumpToLive = () => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
    setUnread(0);
  };

  const srcLang = talk?.lang;
  const isOriginal = isOriginalLang(lang, srcLang);
  const T = STRINGS[lang];
  const lag = lastLag;
  const langsAvailable = [...new Set([srcLang, ...(stage?.targetLangs ?? [])])].filter(isLang) as Lang[];
  const langOptions = langsAvailable.length ? langsAvailable : SUPPORTED_LANGS;
  const srcLangName = (srcLang && isLang(srcLang) ? LANG_META[srcLang].name : srcLang) ?? '—';

  const attendeeState: AttendeeState = !connected && gotHello ? 'reconnecting'
    : state === 'no_signal' ? 'no_signal'
    : state === 'paused' ? 'paused'
    : state === 'idle' || (gotHello && !talk) ? (next ? 'break' : 'ended')
    : 'live';
  const statusWord = { live: T.live, paused: T.paused, no_signal: T.noAudio, break: T.break, ended: T.ended, reconnecting: T.reconnecting }[attendeeState];

  return (
    <div className="stage">
      <div className="phone" id="phone">
        <div className="ph-top">
          <div className="ph-row">
            <div className="ph-room">
              <span
                className="dot"
                style={{
                  background: attendeeState === 'live' || attendeeState === 'paused' ? 'var(--bad)' : 'var(--dim)',
                  animationPlayState: attendeeState === 'live' ? 'running' : 'paused',
                }}
              />
              <span>
                {stageName} · {statusWord}
              </span>
            </div>
            <span
              className="lat"
              title="Measured: from the speaker's last pause to that caption"
              style={{ visibility: attendeeState === 'live' || attendeeState === 'paused' ? 'visible' : 'hidden' }}
            >
              {prefs.stream ? `+${prefs.delay} s (stream)` : lag !== null ? `~${lag.toFixed(1)} s` : ''}
            </span>
          </div>
          <div>
            <div className="ph-talk">{talk?.title ?? '—'}</div>
            <div className="ph-speaker">{talk?.speaker ?? ''}</div>
          </div>
          <div className="ph-row">
            <button className="pill-btn" aria-haspopup="dialog" onClick={() => setSheet('lang')}>
              <span>{LANG_META[lang].name}</span>
              <span className="sub">{subLabel(lang, isOriginal)}</span> ▾
            </button>
            <span style={{ flex: 1 }} />
            <button className="icon-btn" aria-label={T.aaSheetTitle} aria-haspopup="dialog" onClick={() => setSheet('aa')}>
              Aa
            </button>
          </div>
        </div>

        <div className={`banner${attendeeState === 'reconnecting' ? ' show' : ''}`} role="status">
          <span className="spinner" />
          {T.reconnectingBanner}
        </div>

        <div className="ph-body" id="phBody" style={{ fontSize: prefs.size }} ref={bodyRef} onScroll={onScroll}
          onWheel={onGesture} onTouchMove={onGesture} onKeyDown={onGesture} onPointerDown={onGesture}>
          <div aria-live="polite" aria-relevant="additions">
            {visibleSegments.slice(-30).map((s, idx, list) => (
              <Caption
                key={s.seq}
                seg={s}
                lang={lang}
                isOriginal={isOriginal}
                recent={idx >= list.length - 2}
                bilingual={prefs.bilingual}
                sound={LANG_META[lang].sound}
              />
            ))}
          </div>
          <StateCard attendeeState={attendeeState} lang={lang} next={next} talk={talk ?? last} onSummary={() => setSheet('sum')} />
          {attendeeState === 'live' && !prefs.stream && <LiveLine lang={lang} isOriginal={isOriginal} live={live} level={level} showLiveOrig={prefs.liveOrig} />}
        </div>

        <button className={`jump${!atBottom ? ' show' : ''}`} onClick={jumpToLive}>
          {T.jumpToLive}
          {unread > 0 ? ` · ${unread} ${T.newLines}` : ''}
        </button>

        {showToast && (
          <div className="toast" role="status">
            <span dangerouslySetInnerHTML={{ __html: T.langToast(`<b>${LANG_META[lang].name}</b>`) }} />
            <button
              onClick={() => {
                setShowToast(false);
                setSheet('lang');
              }}
            >
              {T.langToastChange}
            </button>
          </div>
        )}

        <div className="ph-bottom">
          <button className="pill-btn" aria-haspopup="dialog" onClick={() => setSheet('sum')}>
            {T.whatDidIMiss}
          </button>
        </div>

        <div className={`scrim${sheet ? ' show' : ''}`} onClick={() => setSheet(null)} />

        <div className={`sheet${sheet === 'lang' ? ' show' : ''}`} role="dialog" aria-label={T.langSheetTitle}>
          <div className="grab" />
          <h3>{T.langSheetTitle}</h3>
          <div>
            {langOptions.map((l) => (
              <button
                key={l}
                className="opt"
                role="radio"
                aria-checked={lang === l}
                onClick={() => {
                  setLang(l);
                  setSheet(null);
                }}
              >
                <span>
                  <span className="t">{LANG_META[l].name}</span>
                  <br />
                  <span className="s">{subLabel(l, l === srcLang)}</span>
                </span>
                <span className="check">✓</span>
              </button>
            ))}
          </div>
          <p className="help">{T.langSheetHelp(srcLangName)}</p>
        </div>

        <div className={`sheet${sheet === 'aa' ? ' show' : ''}`} role="dialog" aria-label={T.aaSheetTitle}>
          <div className="grab" />
          <h3>{T.aaSheetTitle}</h3>
          <div className="set-row">
            <div className="lbl">{T.textSize}</div>
            <span style={{ color: 'var(--muted)', fontSize: 14 }}>{prefs.size}</span>
          </div>
          <input
            type="range"
            min={18}
            max={44}
            value={prefs.size}
            aria-label={T.textSize}
            onChange={(e) => setPrefs({ size: +e.target.value })}
          />
          <div className="set-row">
            <label className="lbl" htmlFor="biChk">
              {T.showOriginalBelow}
              <small>{T.showOriginalBelowHint}</small>
            </label>
            <input id="biChk" type="checkbox" className="switch" checked={prefs.bilingual} onChange={(e) => setPrefs({ bilingual: e.target.checked })} />
          </div>
          <div className="set-row">
            <label className="lbl" htmlFor="liveOrigChk">
              {T.showLiveOriginal}
              <small>{T.showLiveOriginalHint}</small>
            </label>
            <input id="liveOrigChk" type="checkbox" className="switch" checked={prefs.liveOrig} onChange={(e) => setPrefs({ liveOrig: e.target.checked })} />
          </div>
          <div className="set-row">
            <label className="lbl" htmlFor="streamChk">
              {T.watchingStream}
              <small>{T.watchingStreamHint}</small>
            </label>
            <input id="streamChk" type="checkbox" className="switch" checked={prefs.stream} onChange={(e) => setPrefs({ stream: e.target.checked })} />
          </div>
          {prefs.stream && (
            <div style={{ padding: '4px 0 10px' }}>
              <div className="set-row" style={{ border: 0, paddingBottom: 4 }}>
                <div className="lbl">{T.delay}</div>
                <span style={{ color: 'var(--muted)', fontSize: 14 }}>{prefs.delay} s</span>
              </div>
              <input type="range" min={0} max={30} value={prefs.delay} aria-label={T.delay} onChange={(e) => setPrefs({ delay: +e.target.value })} />
            </div>
          )}
          <div className="set-row">
            <label className="lbl" htmlFor="wakeChk">
              {T.keepScreenOn}
            </label>
            <input id="wakeChk" type="checkbox" className="switch" checked={prefs.wakeScreen} onChange={(e) => setPrefs({ wakeScreen: e.target.checked })} />
          </div>
        </div>

        <div className={`sheet${sheet === 'sum' ? ' show' : ''}`} role="dialog" aria-label={T.summaryTitle}>
          <div className="grab" />
          <h3>{T.summaryTitle}</h3>
          {summaryLoading && !summary && <p className="help">…</p>}
          {summary && summary.bullets.length > 0 && (
            <ul className="summary">
              {summary.bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
          {!summaryLoading && (!summary || summary.bullets.length === 0) && <p className="help">{T.summaryEmpty}</p>}
          <p className="help">{T.summaryHelp}</p>
          <button className="btn" style={{ width: '100%' }} onClick={() => setSheet(null)}>
            {T.summaryClose}
          </button>
        </div>
      </div>
    </div>
  );
}
