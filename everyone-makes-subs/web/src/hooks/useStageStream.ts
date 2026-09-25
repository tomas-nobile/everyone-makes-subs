import { useCallback, useEffect, useRef, useState } from 'react';
import type { Segment, StageEvent, StageState, Talk } from '../../../shared/contract';

export interface StageStreamState {
  /** True while the SSE connection is open (F07.5 "Reconnecting…" banner is `!connected`, after the first hello). */
  connected: boolean;
  gotHello: boolean;
  state: StageState | null;
  talk: Talk | null;
  next: Talk | null;
  last: Talk | null;
  /** Confirmed segments, sorted by seq, translations merged in as they arrive. */
  segments: Segment[];
  /** Current interim text of the original language (`live` event); cleared once the segment lands. */
  live: string;
  /** 0..1 mic level, ~4/s. */
  level: number;
  /** Seconds from end-of-speech to publication, from the most recent `segment` event that carried one. */
  lastLag: number | null;
  loadOlder: () => Promise<void>;
  hasOlder: boolean;
  loadingOlder: boolean;
}

const MAX_SEGMENTS = 300;
const emptySegment = (seq: number): Segment => ({ seq, talkId: '', src: '', text: '', tr: {}, t0: 0, t1: 0, kind: 'speech', ms: { asr: 0 } });

/** Owns the one SSE connection per stage (`hello`/`live`/`segment`/`tr`/`state`/`level`). One per attendee/TV/overlay view. */
export function useStageStream(stageId: string): StageStreamState {
  const [connected, setConnected] = useState(false);
  const [gotHello, setGotHello] = useState(false);
  const [state, setState] = useState<StageState | null>(null);
  const [talk, setTalk] = useState<Talk | null>(null);
  const [next, setNext] = useState<Talk | null>(null);
  const [last, setLast] = useState<Talk | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [live, setLive] = useState('');
  const [level, setLevel] = useState(0);
  const [lastLag, setLastLag] = useState<number | null>(null);
  const [hasOlder, setHasOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const segMapRef = useRef(new Map<number, Segment>());

  const applySeg = useCallback((partial: Partial<Segment> & { seq: number }) => {
    const map = segMapRef.current;
    const prev = map.get(partial.seq);
    const merged: Segment = {
      ...(prev ?? emptySegment(partial.seq)),
      ...partial,
      tr: { ...(prev?.tr ?? {}), ...(partial.tr ?? {}) },
    };
    map.set(partial.seq, merged);
    const sorted = [...map.values()].sort((a, b) => a.seq - b.seq);
    while (sorted.length > MAX_SEGMENTS) {
      const gone = sorted.shift();
      if (gone) map.delete(gone.seq);
    }
    setSegments(sorted);
  }, []);

  useEffect(() => {
    segMapRef.current = new Map();
    setSegments([]);
    setLive('');
    setHasOlder(true);
    setGotHello(false);
    const es = new EventSource(`/api/stages/${stageId}/stream`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (ev) => {
      let data: StageEvent;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (data.type) {
        case 'hello':
          setConnected(true);
          setGotHello(true);
          setState(data.state);
          setTalk(data.talk);
          setNext(data.next ?? null);
          setLast(data.last ?? null);
          if (data.recent) for (const s of data.recent) applySeg(s);
          break;
        case 'state':
          setState(data.state);
          if (data.talk !== undefined) setTalk(data.talk);
          if (data.next !== undefined) setNext(data.next ?? null);
          if (data.last !== undefined) setLast(data.last ?? null);
          break;
        case 'live':
          setLive(data.text);
          break;
        case 'segment':
          setLive('');
          applySeg({ seq: data.seq, src: data.src, text: data.text, t0: data.t0, t1: data.t1, kind: data.kind });
          if (typeof data.lag === 'number') setLastLag(data.lag);
          break;
        case 'tr':
          applySeg({ seq: data.seq, tr: data.tr });
          break;
        case 'level':
          setLevel(data.v);
          break;
      }
    };
    return () => es.close();
  }, [stageId, applySeg]);

  const loadOlder = useCallback(async () => {
    if (!hasOlder || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const seqs = [...segMapRef.current.keys()];
      const oldest = seqs.length ? Math.min(...seqs) : undefined;
      const url = `/api/stages/${stageId}/history${oldest !== undefined ? `?before=${oldest}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) {
        setHasOlder(false);
        return;
      }
      const older: Segment[] = await res.json();
      if (older.length === 0) {
        setHasOlder(false);
        return;
      }
      for (const s of older) applySeg(s);
    } catch {
      setHasOlder(false);
    } finally {
      setLoadingOlder(false);
    }
  }, [stageId, hasOlder, loadingOlder, applySeg]);

  return { connected, gotHello, state, talk, next, last, segments, live, level, lastLag, loadOlder, hasOlder, loadingOlder };
}
