import { useCallback, useEffect, useState } from 'react';
import type { Job } from '../../../shared/contract';
import { api } from '../lib/api';

const ACTIVE = new Set(['queued', 'transcribing', 'burning']);

/** `GET /api/jobs`, polled every 2 s while a job is running (10 s otherwise). F18.2. */
export function useJobs(): { jobs: Job[]; refetch: () => void } {
  const [jobs, setJobs] = useState<Job[]>([]);
  const refetch = useCallback(() => {
    api.get<Job[]>('/api/jobs').then(setJobs).catch(() => {});
  }, []);
  useEffect(() => {
    refetch();
  }, [refetch]);
  const active = jobs.some((j) => ACTIVE.has(j.status));
  useEffect(() => {
    const id = setInterval(refetch, active ? 2000 : 10_000);
    return () => clearInterval(id);
  }, [active, refetch]);
  return { jobs, refetch };
}
