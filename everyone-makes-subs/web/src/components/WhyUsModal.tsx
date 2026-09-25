import { Fragment } from 'react';

const PITCH_VIDEO ='https://github.com/tomas-nobile/everyone-makes-subs/releases/download/v1.0.0/EveryoneMakesSubs-pitch.mp4';

/** The six chapters of the pitch video, one per judging criterion. Numbers come from bench/, docs/scale.md and docs/pricing.json. */
const POINTS: { kicker: string; title: string; body: string; rows?: [string, string][] }[] = [
  {
    kicker: 'Deployment & operation',
    title: 'Double-click the installer. Paste the key. Done.',
    body: 'No terminal, no server: the key stays on your machine. Prefer a server? docker compose up. Alerts speak plain language and carry the button that fixes them; the pasted agenda drives the day (“Move to the next talk?” at the scheduled time).',
  },
  {
    kicker: 'Quality',
    title: 'It knows the vocabulary before the talk starts.',
    body: 'From the title and abstract, Gemini builds the terms to listen for, the words that stay untranslated and the likely misrecognitions to correct. Every term is counted live in the dashboard: “Kubernetes ✓ 9”.',
  },
  {
    kicker: 'Latency',
    title: 'Honest numbers, measured on the real pipeline.',
    body: 'One streamed translation call returns every language at once and publishes each the moment it closes. The dashboard shows the measured p50/p95 for original and translation, never an average of the two.',
    rows: [
      ['Heard → original caption, p50', '0.78 s'],
      ['Heard → Spanish caption, p50', '2.59 s'],
      ['Delivery, server → client, p95', '2 ms'],
    ],
  },
  {
    kicker: 'Scalability',
    title: 'One process, every room, any audience.',
    body: 'One speech session per room — not per language, not per viewer. One SSE stream per room carries every language, so viewers add zero AI cost. More viewers: web replicas behind a CDN, same image.',
    rows: [
      ['Rooms × viewers on one laptop', '8 × 250 = 2,000'],
      ['Every phrase to every viewer within', '11 ms (p95)'],
      ['CPU · RAM for 8 rooms', '44% of one core · 157 MB'],
    ],
  },
  {
    kicker: 'Innovation',
    title: 'Everything a real event needs, working.',
    body: 'Subtitle a recorded video and get it back with subtitles burned in plus SRT/VTT. A transparent overlay for OBS. “What did I miss?” — a summary of the last five minutes in your language. The room laptop is the microphone. TV mode with the QR code. Stream-delay mode and downloads when the talk ends.',
  },
  {
    kicker: 'Price',
    title: 'Per room-hour, Spanish + Portuguese.',
    body: 'The audience adds no cost: 10 or 10,000 viewers cost the same. List prices as of 2026-09-24, see docs/pricing.md.',
    rows: [
      ['Everyone Makes Subs (estimate)', 'US$ 0.82'],
      ['Everyone Makes Subs (measured, lower bound)', 'US$ 0.65'],
      ['Gemini Live Translate', 'US$ 4.42'],
      ['OpenAI gpt-realtime-translate', 'US$ 4.08'],
      ['A Nerdearla day (90 room-hours)', 'US$ 74'],
    ],
  },
];

/** "Why choose us": the pitch video's chapters as a side panel, opened from the dashboard header. */
export function WhyUsModal({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="drawer-scrim show" onClick={onClose} />
      <aside className="drawer show" aria-label="Why choose us">
        <div className="dr-head">
          <img src="/logo-dark.png" alt="Everyone Makes Subs" width={40} height={40} style={{ borderRadius: 10 }} />
          <h2 style={{ margin: 0, fontSize: 18, whiteSpace: 'nowrap' }}>Why choose us</h2>
          <span style={{ flex: 1 }} />
          <a className="btn sm" href={PITCH_VIDEO} target="_blank" rel="noreferrer">
            Pitch video (2:30)
          </a>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="dr-body">
          <p className="help" style={{ marginTop: 0 }}>
            Live captions and translation for every stage of your conference, with a single Gemini API key. One chapter per judging criterion, every number measured.
          </p>
          {POINTS.map((p) => (
            <div className="dr-sec" key={p.kicker}>
              <h4>{p.kicker}</h4>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{p.title}</div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>{p.body}</p>
              {p.rows && (
                <div className="kv" style={{ marginTop: 10 }}>
                  {p.rows.map(([k, v]) => (
                    <Fragment key={k}>
                      <span>{k}</span>
                      <span>{v}</span>
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          ))}
          <p className="help">Open source, MIT. Installer, Docker or npm run dev.</p>
        </div>
      </aside>
    </>
  );
}
