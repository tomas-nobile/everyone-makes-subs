import { useEffect, useState } from 'react';
import type { Summary } from '../../../shared/contract';

/** F13.2: `GET /api/stages/:id/summary?lang=` — cached server-side, refetched each time the sheet opens. */
export function useSummary(stageId: string, lang: string, enabled: boolean): { summary: Summary | null; loading: boolean } {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/stages/${stageId}/summary?lang=${lang}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled) setSummary(json);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stageId, lang, enabled]);

  return { summary, loading };
}
