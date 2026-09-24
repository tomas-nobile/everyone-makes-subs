import path from 'node:path';
import { emptyGlossary, type Stage, type StageState, type Talk } from '../../../shared/contract.js';
import { EventBus } from '../bus/EventBus.js';
import { FakeBackend, loadTranscript } from '../asr/FakeBackend.js';

export interface StageRuntime {
  stage: Stage;
  bus: EventBus;
  talk: Talk | null;
  next: Talk | null;
  stop?: () => void;
}

// Minimal for F01: in-memory stages. Persistence, agenda and real workers arrive in F05/F10.
export class StageManager {
  private stages = new Map<string, StageRuntime>();

  list(): StageRuntime[] {
    return [...this.stages.values()];
  }

  get(id: string): StageRuntime | undefined {
    return this.stages.get(id);
  }

  setState(id: string, state: StageState): void {
    const rt = this.stages.get(id);
    if (!rt || rt.stage.state === state) return;
    rt.stage.state = state;
    rt.bus.publish({ type: 'state', state, talk: rt.talk, next: rt.next });
    console.log(`[${id}] state → ${state}`);
  }

  /** DEMO=1 or FAKE_BACKEND=1: "Auditorium" (es) and "Room 2" (en) replaying the samples. */
  createDemoStages(samplesDir: string, targetLangs: string[]): void {
    const demo = [
      { id: 'auditorium', name: 'Auditorium', file: 'es.transcript.json' },
      { id: 'room-2', name: 'Room 2', file: 'en.transcript.json' },
    ];
    for (const d of demo) {
      const transcript = loadTranscript(path.join(samplesDir, d.file));
      const talk: Talk = {
        id: `${d.id}-demo`, stageId: d.id, title: transcript.title, speaker: transcript.speaker,
        lang: transcript.lang, glossary: emptyGlossary(), status: 'live',
      };
      const rt: StageRuntime = {
        stage: { id: d.id, name: d.name, source: { kind: 'file', path: `samples/${d.file}`, loop: true },
          targetLangs, state: 'idle', talkId: talk.id, viewers: 0 },
        bus: new EventBus(),
        talk,
        next: null,
      };
      this.stages.set(d.id, rt);
      const fake = new FakeBackend(d.id, rt.bus, transcript, (s) => this.setState(d.id, s));
      rt.stop = () => fake.stop();
      fake.start();
    }
  }

  stopAll(): void {
    for (const rt of this.stages.values()) rt.stop?.();
  }
}
