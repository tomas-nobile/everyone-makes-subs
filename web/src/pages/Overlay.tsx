import { useEffect } from 'react';
import { useStageStream } from '../hooks/useStageStream';
import { isLang } from '../i18n';
import { tail } from '../lib/captionText';

/** `/s/:id/overlay?lang=&lines=&size=&pos=&box=`: transparent OBS browser-source captions. */
export function Overlay({ stageId }: { stageId: string }) {
  // The app shell paints an opaque dark background (styles.css); OBS needs this route see-through.
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = 'transparent';
    return () => {
      document.body.style.background = prev;
    };
  }, []);

  const params = new URLSearchParams(location.search);
  const { talk, segments } = useStageStream(stageId);
  const lang = params.get('lang') ?? talk?.lang ?? 'es';
  const isOriginal = lang === talk?.lang;
  const lines = Math.min(3, Math.max(1, Number(params.get('lines')) || 2));
  const size = Number(params.get('size')) || 48;
  const pos = params.get('pos') === 'top' ? 'top' : 'bottom';
  const box = params.get('box') !== '0';

  const confirmed = segments.filter((s) => s.kind === 'speech' && (isOriginal || (isLang(lang) && s.tr[lang])));
  const text = (s: (typeof confirmed)[number]) => (isOriginal ? s.text : isLang(lang) ? (s.tr[lang] ?? s.text) : s.text);
  const joined = confirmed
    .slice(-lines)
    .map(text)
    .join(' ');

  return (
    <div style={{ background: 'transparent', width: '100vw', height: '100vh', position: 'relative' }}>
      <div
        className={`ov-caps${box ? ' box' : ''}`}
        style={{
          position: 'fixed',
          left: '50%',
          transform: 'translateX(-50%)',
          [pos]: '6%',
          width: '84%',
          fontSize: size,
        }}
      >
        <span>{tail(joined, lines * 42)}</span>
      </div>
    </div>
  );
}
