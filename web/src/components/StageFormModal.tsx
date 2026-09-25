import { useState } from 'react';
import { api } from '../lib/api';
import type { AdminStage, SourceSpec, StageInput } from '../../../shared/contract';

type SourceKind = SourceSpec['kind'];

const SOURCE_OPTIONS: { kind: SourceKind; label: string; hint: string }[] = [
  { kind: 'station', label: 'Room laptop (recommended)', hint: 'A laptop opens a link and sends the mixer audio.' },
  { kind: 'url', label: 'YouTube or stream link', hint: 'Paste the live stream link.' },
  { kind: 'file', label: 'Audio file', hint: 'Upload a file to test with, or to caption a recording.' },
  { kind: 'mediamtx', label: 'Advanced: OBS or console via RTMP/SRT', hint: 'We give you the address to configure the output.' },
];

const ALL_LANGS = ['es', 'en', 'pt'];

export function StageFormModal({ initial, onClose, onSaved }: { initial?: AdminStage; onClose: () => void; onSaved: () => void }) {
  const editing = Boolean(initial);
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<SourceKind>(initial?.source.kind ?? 'station');
  const [url, setUrl] = useState(initial?.source.kind === 'url' ? initial.source.url : '');
  const [filePath, setFilePath] = useState(initial?.source.kind === 'file' ? initial.source.path : '');
  const [fileName, setFileName] = useState('');
  const [mediamtxPath, setMediamtxPath] = useState(initial?.source.kind === 'mediamtx' ? initial.source.path : '');
  const [targetLangs, setTargetLangs] = useState<string[]>(initial?.targetLangs ?? ALL_LANGS);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadFile = async (file: File) => {
    setUploading(true);
    setFileName(file.name);
    try {
      const res = await fetch(`/api/uploads?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        credentials: 'include',
        body: file,
      });
      const json = await res.json();
      setFilePath(json.path);
    } catch {
      setError('Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const buildSource = (): SourceSpec | null => {
    if (kind === 'station') return { kind: 'station' };
    if (kind === 'url') return url.trim() ? { kind: 'url', url: url.trim() } : null;
    if (kind === 'file') return filePath ? { kind: 'file', path: filePath, loop: true } : null;
    return mediamtxPath.trim() ? { kind: 'mediamtx', path: mediamtxPath.trim() } : null;
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Give the stage a name.');
      return;
    }
    const source = buildSource();
    if (!source) {
      setError('Finish setting up the source first.');
      return;
    }
    setSaving(true);
    try {
      const input: StageInput = { name: name.trim(), source, targetLangs };
      if (editing && initial) await api.patch(`/api/stages/${initial.id}`, input);
      else await api.post('/api/stages', input);
      onSaved();
      onClose();
    } catch {
      setError('Could not save the stage.');
    } finally {
      setSaving(false);
    }
  };

  const toggleLang = (l: string) => setTargetLangs((prev) => (prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]));

  return (
    <>
      <div className="drawer-scrim show" onClick={onClose} />
      <div className="drawer show" aria-label={editing ? 'Edit stage' : 'Add stage'}>
        <div className="dr-head">
          <h2>{editing ? 'Edit stage' : 'Add stage'}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="dr-body">
          <div className="field">
            <label>Name</label>
            <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Auditorium" />
          </div>

          <div className="dr-sec">
            <h4>Where does the audio come from?</h4>
            {SOURCE_OPTIONS.map((o) => (
              <button key={o.kind} className="src" role="radio" aria-checked={kind === o.kind} onClick={() => setKind(o.kind)}>
                <span className="r" />
                <span>
                  <span className="t">{o.label}</span>
                  <span className="s" style={{ display: 'block' }}>
                    {o.hint}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {kind === 'url' && (
            <div className="field">
              <label>Stream URL</label>
              <input className="inp" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" />
            </div>
          )}
          {kind === 'file' && (
            <div className="field">
              <label>Audio/video file</label>
              <input type="file" accept="audio/*,video/*" onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])} />
              {uploading && <p className="help">Uploading…</p>}
              {!uploading && filePath && <p className="help">✓ {fileName || filePath}</p>}
            </div>
          )}
          {kind === 'mediamtx' && (
            <div className="field">
              <label>Stream path</label>
              <input className="inp" value={mediamtxPath} onChange={(e) => setMediamtxPath(e.target.value)} placeholder="auditorium" />
              <p className="help">Point OBS/your mixer at rtmp://&lt;host&gt;:1935/{mediamtxPath || '<path>'} or SRT streamid={mediamtxPath || '<path>'}.</p>
            </div>
          )}

          <div className="field">
            <label>Target languages</label>
            <div className="chips">
              {ALL_LANGS.map((l) => (
                <button key={l} className="chip" aria-pressed={targetLangs.includes(l)} onClick={() => toggleLang(l)}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {error && <div className="errmsg">{error}</div>}
          <div className="su-actions">
            <span />
            <button className="btn primary" onClick={submit} disabled={saving || uploading}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create stage'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
