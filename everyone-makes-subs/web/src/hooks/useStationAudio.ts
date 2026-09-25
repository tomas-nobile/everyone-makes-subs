import { useCallback, useEffect, useRef, useState } from 'react';
import { readPref, writePref } from '../lib/prefs';

export type ConnectionState = 'idle' | 'connecting' | 'sending' | 'reconnecting' | 'stopped' | 'error';

const CHUNK_MS = 100;
const BUFFER_SECONDS = 10;
const MAX_QUEUE = (BUFFER_SECONDS * 1000) / CHUNK_MS; // 100 chunks
const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

function rmsLevel(data: Uint8Array): number {
  let sumSquares = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sumSquares += v * v;
  }
  return Math.sqrt(sumSquares / data.length);
}

export interface StationAudio {
  devices: MediaDeviceInfo[];
  deviceId: string | null;
  setDeviceId: (id: string) => void;
  permission: 'idle' | 'granted' | 'denied';
  level: number;
  connectionState: ConnectionState;
  startedAt: number | null;
  start: (overrideDeviceId?: string) => Promise<void>;
  stop: () => void;
  testAudio: () => Promise<{ ok: boolean; avgLevel: number }>;
}

/** F08.1/.2/.3: mic pick + level meter + 16kHz Int16 encode + resilient WS send to the room's stage. */
export function useStationAudio(stageId: string, stationKey: string): StationAudio {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceIdState] = useState<string | null>(() => readPref(`station.${stageId}.deviceId`, null));
  const [permission, setPermission] = useState<'idle' | 'granted' | 'denied'>('idle');
  const [level, setLevel] = useState(0);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const queueRef = useRef<ArrayBuffer[]>([]);
  const backoffRef = useRef(BACKOFF_START_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const setDeviceId = useCallback(
    (id: string) => {
      setDeviceIdState(id);
      writePref(`station.${stageId}.deviceId`, id);
    },
    [stageId],
  );

  const refreshDevices = useCallback(async () => {
    const list = await navigator.mediaDevices.enumerateDevices();
    setDevices(list.filter((d) => d.kind === 'audioinput'));
  }, []);

  const connectWs = useCallback(() => {
    if (stoppedRef.current) return;
    setConnectionState((s) => (s === 'idle' ? 'connecting' : 'reconnecting'));
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/api/stages/${stageId}/ingest?key=${encodeURIComponent(stationKey)}`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      backoffRef.current = BACKOFF_START_MS;
      setConnectionState('sending');
      setStartedAt((prev) => prev ?? Date.now());
      // Flush whatever built up in the 10s buffer while we were disconnected.
      while (queueRef.current.length) {
        const chunk = queueRef.current.shift();
        if (chunk) ws.send(chunk);
      }
    };
    ws.onclose = () => {
      wsRef.current = null;
      if (stoppedRef.current) return;
      setConnectionState('reconnecting');
      const wait = backoffRef.current;
      backoffRef.current = Math.min(backoffRef.current * 2, BACKOFF_MAX_MS);
      reconnectTimerRef.current = setTimeout(connectWs, wait);
    };
    ws.onerror = () => ws.close();
    wsRef.current = ws;
  }, [stageId, stationKey]);

  const sendOrQueue = useCallback((chunk: ArrayBuffer) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(chunk);
    } else {
      queueRef.current.push(chunk);
      while (queueRef.current.length > MAX_QUEUE) queueRef.current.shift();
    }
  }, []);

  const start = useCallback(async (overrideDeviceId?: string) => {
    stoppedRef.current = false;
    const effectiveId = overrideDeviceId ?? deviceId;
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        ...(effectiveId ? { deviceId: { exact: effectiveId } } : {}),
      },
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    setPermission('granted');
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = stream;
    await refreshDevices();

    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);

    // Meter (F08.1): a plain AnalyserNode, independent of the encode path.
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyserRef.current = analyser;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      setLevel(rmsLevel(data));
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();

    // Encode path (F08.2): AudioWorklet → 16kHz Int16 → WS.
    const workletUrl = new URL('../worklets/pcmDownsampler.ts', import.meta.url);
    await ctx.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(ctx, 'pcm-downsampler');
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => sendOrQueue(e.data);
    source.connect(node);

    connectWs();
  }, [deviceId, refreshDevices, connectWs, sendOrQueue]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    wsRef.current?.close();
    wsRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setConnectionState('stopped');
    setStartedAt(null);
    setLevel(0);
  }, []);

  const testAudio = useCallback(async (): Promise<{ ok: boolean; avgLevel: number }> => {
    const analyser = analyserRef.current;
    if (!analyser) return { ok: false, avgLevel: 0 };
    const data = new Uint8Array(analyser.fftSize);
    const samples: number[] = [];
    const start2 = Date.now();
    while (Date.now() - start2 < 5000) {
      analyser.getByteTimeDomainData(data);
      samples.push(rmsLevel(data));
      await new Promise((r) => setTimeout(r, 100));
    }
    const avg = samples.reduce((a, b) => a + b, 0) / (samples.length || 1);
    return { ok: avg > 0.03, avgLevel: avg };
  }, []);

  useEffect(() => {
    navigator.mediaDevices.addEventListener?.('devicechange', refreshDevices);
    refreshDevices().catch(() => {});
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', refreshDevices);
  }, [refreshDevices]);

  useEffect(() => stop, [stop]);

  return { devices, deviceId, setDeviceId, permission, level, connectionState, startedAt, start, stop, testAudio };
}
