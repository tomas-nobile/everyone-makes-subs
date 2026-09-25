import { useEffect, useState } from 'react';
import type { AdminMetrics } from '../../../shared/contract';

/** `GET /api/admin/metrics`: one full `AdminMetrics` snapshot per second, plain SSE `data:` messages. */
export function useAdminMetrics(enabled: boolean): { metrics: AdminMetrics | null; connected: boolean } {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource('/api/admin/metrics');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (ev) => {
      try {
        setMetrics(JSON.parse(ev.data));
      } catch {
        // ignore a malformed frame; the next one-per-second tick will correct it
      }
    };
    return () => es.close();
  }, [enabled]);

  return { metrics, connected };
}
