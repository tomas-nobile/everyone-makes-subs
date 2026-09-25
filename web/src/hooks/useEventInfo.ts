import { useEffect, useState } from 'react';
import type { EventInfo } from '../../../shared/contract';

/** `GET /api/event`: event name, public URL and the stage list (name, targetLangs, current/next talk). Polled — it's a plain GET, not SSE. */
export function useEventInfo(pollMs = 5000): { data: EventInfo | null; error: boolean } {
  const [data, setData] = useState<EventInfo | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/event');
        if (!res.ok) throw new Error(String(res.status));
        const json: EventInfo = await res.json();
        if (!cancelled) {
          setData(json);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    };
    load();
    const id = setInterval(load, pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollMs]);

  return { data, error };
}
