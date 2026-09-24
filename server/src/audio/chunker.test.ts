import { describe, expect, it } from 'vitest';
import { CHUNK_BYTES, Chunker } from './chunker.js';

describe('Chunker', () => {
  it('emits only exact 3,200-byte chunks and buffers the remainder', () => {
    const c = new Chunker();
    expect(c.push(Buffer.alloc(1000))).toHaveLength(0);
    const out = c.push(Buffer.alloc(6000)); // 7000 total → 2 chunks, 600 left
    expect(out.map((b) => b.length)).toEqual([CHUNK_BYTES, CHUNK_BYTES]);
    expect(c.pending).toBe(600);
    expect(c.push(Buffer.alloc(2600))).toHaveLength(1);
    expect(c.pending).toBe(0);
  });

  it('keeps byte order across pushes', () => {
    const c = new Chunker();
    const a = Buffer.alloc(2000, 1);
    const b = Buffer.alloc(1200, 2);
    const [chunk] = c.push(Buffer.concat([a])).concat(c.push(b));
    expect(chunk[1999]).toBe(1);
    expect(chunk[2000]).toBe(2);
  });
});
