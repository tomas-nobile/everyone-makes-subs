import { useStageStream } from '../hooks/useStageStream';
import { useEventInfo } from '../hooks/useEventInfo';
import { Qr } from '../components/Qr';
import { formatTime, maskLive, tail } from '../lib/captionText';
import { isLang } from '../i18n';

const LINE_BUDGET = 60;

/** `/s/:id/tv`: the room's giant-caption screen — two lines, a corner QR, and the next-talk card on a break. */
export function Tv({ stageId }: { stageId: string }) {
  const params = new URLSearchParams(location.search);
  const showQr = params.get('qr') !== '0';
  const { talk, next, state, segments, live } = useStageStream(stageId);
  const { data: event } = useEventInfo();
  const stage = event?.stages.find((s) => s.id === stageId);
  const stageName = stage?.name ?? stageId;
  const lang = params.get('lang') ?? talk?.lang ?? 'es';
  const isOriginal = lang === talk?.lang;

  const base = event?.publicUrl || location.origin;
  const isBreak = state === 'idle' && !!next;

  const confirmed = segments.filter((s) => s.kind === 'speech' && (isOriginal || (isLang(lang) && s.tr[lang])));
  const textOf = (s: (typeof confirmed)[number]) => (isOriginal ? s.text : isLang(lang) ? (s.tr[lang] ?? s.text) : s.text);

  let l1: string | null = null;
  let l2: string | null = null;
  let lv: string | null = null;
  if (isOriginal && live) {
    const last = confirmed[confirmed.length - 1];
    l2 = last ? tail(textOf(last), LINE_BUDGET) : null;
    const m = maskLive(tail(live, LINE_BUDGET));
    lv = m.allMasked ? m.text : `${m.stable} …`;
  } else {
    const [a, b] = confirmed.slice(-2);
    l1 = a ? tail(textOf(a), LINE_BUDGET) : null;
    l2 = b ? tail(textOf(b), LINE_BUDGET) : null;
  }

  return (
    <div className="tv-page">
      <div className="tv">
        <div className="tv-head">
          <span className="dot" style={{ animationPlayState: state === 'live' ? 'running' : 'paused' }} />
          <b>{stageName}</b> {talk ? `· ${talk.title}${talk.speaker ? ` · ${talk.speaker}` : ''}` : ''}
        </div>

        {!isBreak && (
          <div className="tv-caps">
            {l1 && <div className="l1">{l1}</div>}
            {l2 && <div className="l2">{l2}</div>}
            {lv && <div className="lv">{lv}</div>}
          </div>
        )}

        {isBreak && (
          <div className="tv-interval show">
            <div className="k">Break · back at {formatTime(next?.startsAt)}</div>
            <div className="t">{next?.title}</div>
            <div className="s">
              {next?.speaker} {next?.speaker ? '·' : ''} {stageName}
            </div>
          </div>
        )}

        {showQr && base && (
          <div className="tv-qr">
            <Qr className="qr" data={`${base}/s/${stageId}`} />
            Captions in your language
            <br />
            <b style={{ color: '#fff' }}>Scan</b>
          </div>
        )}
      </div>
    </div>
  );
}
