import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { AdminStage } from '../../../shared/contract';

/** `GET /api/stages` (admin): full stage records — station key, source, and every talk. Refetch after any mutation. */
export function useAdminStages(): { stages: AdminStage[]; refetch: () => void } {
  const [stages, setStages] = useState<AdminStage[]>([]);

  const refetch = useCallback(() => {
    api
      .get<AdminStage[]>('/api/stages')
      .then(setStages)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { stages, refetch };
}
