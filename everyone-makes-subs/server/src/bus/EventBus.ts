import { EventEmitter } from 'node:events';
import type { StageEvent } from '../../../shared/contract.js';

export interface BusEntry { id: number; ev: StageEvent }

const RING_SIZE = 300;

// One bus per stage. `live` and `level` are ephemeral: they go to current listeners
// but are not kept in the ring used for Last-Event-ID replay.
export class EventBus {
  private emitter = new EventEmitter();
  private ring: BusEntry[] = [];
  private nextId = 1;
  lastSeq = 0;

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(ev: StageEvent): void {
    const entry = { id: this.nextId++, ev };
    if (ev.type === 'segment') this.lastSeq = Math.max(this.lastSeq, ev.seq);
    if (ev.type !== 'live' && ev.type !== 'level') {
      this.ring.push(entry);
      if (this.ring.length > RING_SIZE) this.ring.shift();
    }
    this.emitter.emit('ev', entry);
  }

  /** Entries in the ring after `afterId` (for Last-Event-ID replay). */
  since(afterId: number): BusEntry[] {
    return this.ring.filter((e) => e.id > afterId);
  }

  subscribe(fn: (e: BusEntry) => void): () => void {
    this.emitter.on('ev', fn);
    return () => this.emitter.off('ev', fn);
  }

  listenerCount(): number {
    return this.emitter.listenerCount('ev');
  }
}
