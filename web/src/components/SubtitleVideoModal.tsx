import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { Job } from '../../../shared/contract';

const LANGS: { code: string; label: string }[] = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
  { code: 'pt', label: 'Português' },
];

/** F18.2: "Subtitle a video" — drop a file or paste a link, pick the subtitle language, optional talk details. */
export function SubtitleVideoModal({ onClose, onCreated }: { onClose: () => void; onCreated: (job: Job) => void }) {
  const [kind, setKind] = useState<'file' | 'url'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [lang, setLang] = useState('es');
  const [srcLang, setSrcLang] = useState('');
  const [title, setTitle] = useState('');
  const [speaker, setSpeaker] = useState('');
  const [abstract, setAbstract] = useState('');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (kind === 'file' && !file) return setError('Choose a video file first.');
    if (kind === 'url' && !/^https?:\/\//.test(url.trim())) return setError('Paste a link that starts with https://');
    setBusy(true);
    try {
      let job: Job;
      if (kind === 'file' && file) {
        const q = new URLSearchParams({ name: file.name, lang, srcLang, title, speaker, abstract });
        const res = await fetch(`/api/jobs?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, credentials: 'include', body: file });
        if (!res.ok) throw new ApiError(res.status, undefined, 'Upload failed.');
        job = await res.json();
      } else {
        job = await api.post<Job>('/api/jobs', { url: url.trim(), lang, srcLang: srcLang || undefined, title, speaker, abstract });
      }
      onCreated(job);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the job.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="drawer-scrim show" onClick={onClose} />
      <div className="drawer show" aria-label="Subtitle a video">
        <div className="dr-head">
          <h2>Subtitle a video</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="dr-body">
          <p className="help" style={{ marginTop: 0 }}>
            You get the video back with the subtitles burned in, plus VTT and SRT files — for example, to publish last year's English talks in Spanish.
          </p>
          <div className="dr-sec">
            <h4>The video</h4>
            <button className="src" role="radio" aria-checked={kind === 'file'} onClick={() => setKind('file')}>
              <span className="r" />
              <span>
                <span className="t">Upload a video file</span>
                <span className="s" style={{ display: 'block' }}>mp4, mov, mkv or webm.</span>
              </span>
            </button>
            <button className="src" role="radio" aria-checked={kind === 'url'} onClick={() => setKind('url')}>
              <span className="r" />
              <span>
                <span className="t">YouTube or video link</span>
                <span className="s" style={{ display: 'block' }}>The video is downloaded first.</span>
              </span>
            </button>
          </div>
          {kind === 'file' && (
            <div className="field">
              <label
                className={`drop${over ? ' over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
              >
                {file ? `✓ ${file.name} (${Math.round(file.size / 1048576)} MB)` : 'Drop the video here, or click to choose it'}
                <input type="file" accept="video/*" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
          )}
          {kind === 'url' && (
            <div className="field">
              <label>Video link</label>
              <input className="inp" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" />
            </div>
          )}

          <div className="field">
            <label>Subtitle language</label>
            <div className="chips">
              {LANGS.map((l) => (
                <button key={l.code} className="chip" aria-pressed={lang === l.code} onClick={() => setLang(l.code)}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Spoken language</label>
            <select value={srcLang} onChange={(e) => setSrcLang(e.target.value)}>
              <option value="">Detect automatically</option>
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          <div className="dr-sec">
            <h4>About the talk (optional)</h4>
            <div className="field">
              <label>Title</label>
              <input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Model Context Protocol in Plain English" />
            </div>
            <div className="field">
              <label>Speaker</label>
              <input className="inp" value={speaker} onChange={(e) => setSpeaker(e.target.value)} />
            </div>
            <div className="field">
              <label>Abstract</label>
              <textarea className="inp" style={{ minHeight: 90 }} value={abstract} onChange={(e) => setAbstract(e.target.value)} placeholder="Gemini builds the vocabulary it listens for from the title and abstract." />
            </div>
          </div>

          {error && <div className="errmsg">{error}</div>}
          <div className="su-actions">
            <span />
            <button className="btn primary" onClick={submit} disabled={busy}>
              {busy ? 'Uploading…' : 'Subtitle it'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
