import { useEventInfo } from '../hooks/useEventInfo';
import { LANG_META, type Lang } from '../i18n';

const LANGS: Lang[] = ['es', 'en', 'pt'];

/** `/`: for an attendee who didn't scan a room's QR — "Live now", one card per stage. */
export function Home() {
  const { data: event, error } = useEventInfo();

  return (
    <main className="home">
      <h1>{event?.name ?? 'Everyone Makes Subs'}</h1>
      <p className="muted">Live captions and translation for every stage.</p>

      {error && !event && <p className="muted">Could not reach the event yet — try again in a moment.</p>}
      {event && event.stages.length === 0 && <p className="muted">No stages yet.</p>}

      <div className="livegrid">
        {event?.stages.map((s) => (
          <div key={s.id} className="livecard">
            <a href={`/s/${s.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
              <h3>{s.name}</h3>
            </a>
            <div className="now">{s.talk ? s.talk.title : s.state === 'idle' ? 'No talk in progress' : '—'}</div>
            {s.talk?.speaker && <div className="now">{s.talk.speaker}</div>}
            <div className="chips" style={{ marginTop: 4 }}>
              {LANGS.map((l) => (
                <a key={l} className="chip" href={`/s/${s.id}?lang=${l}`}>
                  {LANG_META[l].name}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
