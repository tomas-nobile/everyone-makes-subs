import type { Job } from '../../../shared/contract';
import { api } from '../lib/api';

const LABEL: Record<Job['status'], { text: string; cls: string }> = {
  queued: { text: 'Queued', cls: 'off' },
  transcribing: { text: 'Transcribing', cls: 'info' },
  burning: { text: 'Burning subtitles', cls: 'info' },
  done: { text: 'Done', cls: 'ok' },
  error: { text: 'Failed', cls: 'bad' },
};

function eta(sec: number): string {
  if (sec <= 0) return '';
  return sec < 60 ? `about ${sec} s left` : `about ${Math.round(sec / 60)} min left`;
}

/** F18.2: the list of video jobs with progress, and the subtitled video + downloads when done. */
export function JobsPanel({ jobs, onChanged }: { jobs: Job[]; onChanged: () => void }) {
  if (jobs.length === 0) return null;
  const remove = async (job: Job) => {
    if (!window.confirm(`Delete "${job.title}" and its files?`)) return;
    await api.del(`/api/jobs/${job.id}`).catch(() => {});
    onChanged();
  };
  return (
    <div className="jobs" aria-label="Subtitled videos">
      {jobs.map((job) => {
        const badge = LABEL[job.status];
        const active = job.status === 'queued' || job.status === 'transcribing' || job.status === 'burning';
        return (
          <div key={job.id} className="job">
            <div style={{ minWidth: 0 }}>
              <div className="t">{job.title}</div>
              <div className="s">
                {job.source.kind === 'url' ? job.source.url : job.source.name} → {job.lang.toUpperCase()}
                {job.durationSec ? ` · ${Math.round(job.durationSec / 60)} min` : ''}
                {job.speed && job.speed > 1 ? ` · ${job.speed}× speed` : ''}
                {job.message ? ` · ${job.message}` : ''}
                {active && job.etaSec > 0 ? ` · ${eta(job.etaSec)}` : ''}
              </div>
            </div>
            <div className="acts">
              <span className={`badge ${badge.cls}`}>{badge.text}</span>
              {job.status === 'done' && (
                <>
                  <a className="btn sm primary" href={`/api/jobs/${job.id}/video.mp4?download=1`}>
                    Download video
                  </a>
                  <a className="btn sm" href={`/api/jobs/${job.id}/video.vtt`}>
                    VTT
                  </a>
                  <a className="btn sm" href={`/api/jobs/${job.id}/video.srt`}>
                    SRT
                  </a>
                </>
              )}
              {!active && (
                <button className="btn sm ghost" onClick={() => remove(job)}>
                  Delete
                </button>
              )}
            </div>
            {active && (
              <div className="progress" role="progressbar" aria-valuenow={Math.round(job.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                <i style={{ width: `${Math.round(job.progress * 100)}%` }} />
              </div>
            )}
            {job.status === 'done' && <video controls preload="metadata" src={`/api/jobs/${job.id}/video.mp4`} />}
          </div>
        );
      })}
    </div>
  );
}
