import { useState } from 'react';

const LANGS: { v: string; label: string }[] = [
  { v: 'es', label: 'Español' },
  { v: 'en', label: 'English' },
  { v: 'pt', label: 'Português' },
];

/** F12.2: the Share-tab overlay configurator — builds the OBS browser-source URL with a live preview. */
export function OverlayConfigurator({ publicUrl, stageId, defaultLang }: { publicUrl: string; stageId: string; defaultLang: string }) {
  const [lang, setLang] = useState(defaultLang);
  const [lines, setLines] = useState(2);
  const [size, setSize] = useState(48);
  const [pos, setPos] = useState<'bottom' | 'top'>('bottom');
  const [box, setBox] = useState(true);
  const [copied, setCopied] = useState(false);

  const url = `${publicUrl}/s/${stageId}/overlay?lang=${lang}&lines=${lines}&size=${size}&pos=${pos}&box=${box ? 1 : 0}`;

  const seg = <T,>(options: { v: T; label: string }[], value: T, set: (v: T) => void) => (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.v)} aria-pressed={o.v === value} onClick={() => set(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="form">
      <h3>Configure overlay</h3>
      <div className="field">
        <label>Language</label>
        {seg(LANGS.map((l) => ({ v: l.v, label: l.label })), lang, setLang)}
      </div>
      <div className="field">
        <label>Lines</label>
        {seg([1, 2, 3].map((n) => ({ v: n, label: String(n) })), lines, setLines)}
      </div>
      <div className="field">
        <label>Size</label>
        {seg(
          [
            { v: 36, label: 'Small' },
            { v: 48, label: 'Medium' },
            { v: 60, label: 'Large' },
          ],
          size,
          setSize,
        )}
      </div>
      <div className="field">
        <label>Position</label>
        {seg(
          [
            { v: 'bottom' as const, label: 'Bottom' },
            { v: 'top' as const, label: 'Top' },
          ],
          pos,
          setPos,
        )}
      </div>
      <div className="field">
        <label>Background</label>
        {seg(
          [
            { v: true, label: 'Dark box' },
            { v: false, label: 'Shadow only' },
          ],
          box,
          setBox,
        )}
      </div>
      <div className="field">
        <label>URL for OBS</label>
        <div className="url">{url}</div>
      </div>
      <button
        className="btn primary"
        style={{ width: '100%' }}
        onClick={() => {
          navigator.clipboard.writeText(url).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? 'Copied ✓' : 'Copy URL'}
      </button>
      <p className="help">
        Captions arrive 2–3 s after the voice. To keep them in sync on the stream, add a <b>3 s</b> delay to video and audio in OBS (Filters →
        Render Delay).
      </p>
    </div>
  );
}
