import { useEffect, useState } from 'react';
import { useStationAudio } from '../hooks/useStationAudio';
import { useStageStream } from '../hooks/useStageStream';
import { useEventInfo } from '../hooks/useEventInfo';
import { useWakeLock } from '../hooks/useWakeLock';

const METER_BARS = 30;

function formatElapsed(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** `/station/:id?key=<stationKey>`: the room tech's page — pick the input, watch the level, send audio. */
export function Station({ stageId }: { stageId: string }) {
  const params = new URLSearchParams(location.search);
  const stationKey = params.get('key') ?? '';
  const audio = useStationAudio(stageId, stationKey);
  const { data: event } = useEventInfo();
  const stage = event?.stages.find((s) => s.id === stageId);
  const { live, segments } = useStageStream(stageId);

  const [tabHidden, setTabHidden] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [, tick] = useState(0);

  useWakeLock(audio.connectionState === 'sending');

  useEffect(() => {
    const onVis = () => setTabHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Started automatically once we land on the page — that's the whole point of the room-laptop flow.
  useEffect(() => {
    audio.start().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const lastPhrase = [...segments].reverse().find((s) => s.kind === 'speech')?.text ?? '';
  const previewText = live || lastPhrase || '…';

  const sending = audio.connectionState === 'sending';
  const n = Math.round(audio.level * METER_BARS);

  const onSelectDevice = async (id: string) => {
    audio.setDeviceId(id);
    await audio.start(id);
  };

  const runTest = async () => {
    setTesting(true);
    setTestMsg('Listening for 5 seconds…');
    const result = await audio.testAudio();
    setTesting(false);
    setTestMsg(result.ok ? '✓ We can hear you. Average level: good.' : 'Too low: turn up the gain and try again.');
  };

  return (
    <div className="station-page">
      <div className="station">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ color: 'var(--muted)', fontSize: 14 }}>Room station</div>
            <h2>{stage?.name ?? stageId}</h2>
          </div>
        </div>

        <div className={`st-status ${sending ? (audio.level < 0.05 ? 'warn' : 'ok') : ''}`}>
          <span style={{ fontSize: 24 }} aria-hidden="true">
            ●
          </span>
          <div>
            <span>
              {audio.connectionState === 'sending' && 'Sending audio to Everyone Makes Subs'}
              {audio.connectionState === 'connecting' && 'Connecting…'}
              {audio.connectionState === 'reconnecting' && 'Reconnecting… buffering audio'}
              {audio.connectionState === 'stopped' && 'Stopped'}
              {audio.connectionState === 'idle' && 'Requesting microphone access…'}
              {audio.connectionState === 'error' && 'Could not access the microphone'}
            </span>
            <small>
              {audio.startedAt ? `For ${formatElapsed(Date.now() - audio.startedAt)} · ` : ''}
              reconnects automatically if the network drops
            </small>
          </div>
        </div>

        {tabHidden && sending && <div className="help" style={{ color: 'var(--warn)' }}>Don't close this tab — captions stop if it does.</div>}

        <div className="field">
          <label htmlFor="stDev">Audio input</label>
          <select id="stDev" value={audio.deviceId ?? ''} onChange={(e) => onSelectDevice(e.target.value)}>
            {audio.devices.length === 0 && <option value="">No inputs found</option>}
            {audio.devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Microphone'}
              </option>
            ))}
          </select>
          <p className="help">Connect the mixer's aux output to the USB audio interface. Select the interface here, not the laptop microphone.</p>
        </div>

        <div className="field">
          <label>Level</label>
          <div className="big-meter">
            {Array.from({ length: METER_BARS }, (_, k) => (
              <i key={k} className={k < n ? `on${k >= 22 ? ' hot' : ''}${k >= 27 ? ' clip' : ''}` : ''} />
            ))}
          </div>
          <div className="meter-legend">
            <span>Silence</span>
            <span>Good</span>
            <span>Too loud</span>
          </div>
        </div>

        <div className="field">
          <label>What's being transcribed</label>
          <div className="preview">
            <small>Original · live</small>
            <span>{previewText}</span>
          </div>
          <p className="help">If you see music or the presenter from another room here, the input is wrong.</p>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" onClick={runTest} disabled={testing}>
            {testing ? 'Testing…' : 'Test audio (5 s)'}
          </button>
          <button className="btn danger" onClick={() => (sending || audio.connectionState === 'reconnecting' ? audio.stop() : audio.start())}>
            {sending || audio.connectionState === 'reconnecting' ? 'Stop sending' : 'Start sending'}
          </button>
        </div>
        {testMsg && <div className="help">{testMsg}</div>}

        <ul className="warnlist">
          <li>Don't close this tab. If the laptop goes to sleep, captions stop.</li>
          <li>If the internet drops, we buffer 10 seconds of audio and send it when the connection is back.</li>
        </ul>
      </div>
    </div>
  );
}
