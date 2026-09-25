import { useEffect, useState } from 'react';
import { Home } from './pages/Home';
import { Phone } from './pages/Phone';
import { Tv } from './pages/Tv';
import { Overlay } from './pages/Overlay';
import { Station } from './pages/Station';
import { Admin } from './pages/Admin';
import { Setup } from './pages/Setup';

function usePath(): string {
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}

/** Minimal client-side router: `/`, `/s/:id`, `/s/:id/tv`, `/s/:id/overlay`, `/station/:id`, `/admin`, `/setup`. */
export function Router() {
  const path = usePath();
  const parts = path.split('/').filter(Boolean);

  if (parts.length === 0) return <Home />;
  if (parts[0] === 'admin') return <Admin />;
  if (parts[0] === 'setup') return <Setup />;
  if (parts[0] === 'station' && parts[1]) return <Station stageId={parts[1]} />;
  if (parts[0] === 's' && parts[1]) {
    if (parts[2] === 'tv') return <Tv stageId={parts[1]} />;
    if (parts[2] === 'overlay') return <Overlay stageId={parts[1]} />;
    return <Phone stageId={parts[1]} />;
  }
  return (
    <main className="home">
      <h1>Not found</h1>
      <p className="muted">
        <a href="/">Back home</a>
      </p>
    </main>
  );
}

/** Navigate without a full reload. */
export function navigate(to: string): void {
  history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
