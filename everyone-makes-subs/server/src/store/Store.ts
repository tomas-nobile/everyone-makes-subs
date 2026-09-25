import fs from 'node:fs';
import path from 'node:path';
import type { Segment } from '../../../shared/contract.js';

/** One JSONL per talk: <dataDir>/<stage>/<talk>.jsonl, one Segment (with translations) per line. */
export class Store {
  private cache = new Map<string, Segment[]>();

  constructor(private dataDir: string) {}

  private file(stageId: string, talkId: string): string {
    return path.join(this.dataDir, safe(stageId), `${safe(talkId)}.jsonl`);
  }

  list(stageId: string, talkId: string): Segment[] {
    const key = `${stageId}/${talkId}`;
    let segs = this.cache.get(key);
    if (!segs) {
      segs = [];
      try {
        for (const line of fs.readFileSync(this.file(stageId, talkId), 'utf8').split('\n')) {
          if (line.trim()) try { segs.push(JSON.parse(line)); } catch { /* torn last line */ }
        }
      } catch { /* no file yet */ }
      this.cache.set(key, segs);
    }
    return segs;
  }

  append(stageId: string, seg: Segment): void {
    const segs = this.list(stageId, seg.talkId);
    segs.push(seg);
    const file = this.file(stageId, seg.talkId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(seg) + '\n');
  }

  /** Talk segments by talk id alone (export): looks in every stage folder. */
  findTalk(talkId: string, stageId?: string): Segment[] {
    if (stageId) return this.list(stageId, talkId);
    try {
      for (const dir of fs.readdirSync(this.dataDir)) {
        if (fs.existsSync(path.join(this.dataDir, dir, `${safe(talkId)}.jsonl`))) return this.list(dir, talkId);
      }
    } catch { /* no data dir */ }
    return [];
  }
}

function safe(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}
