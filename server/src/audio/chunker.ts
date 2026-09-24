// Internal audio contract: PCM s16le, mono, 16 kHz → 32,000 bytes/s, 3,200-byte chunks (100 ms).
export const BYTES_PER_SEC = 32_000;
export const CHUNK_BYTES = 3_200;

/** Splits an arbitrary byte stream into exact CHUNK_BYTES chunks; the remainder waits for the next push. */
export class Chunker {
  private rest: Buffer = Buffer.alloc(0);

  push(data: Buffer): Buffer[] {
    const buf = this.rest.length ? Buffer.concat([this.rest, data]) : data;
    const out: Buffer[] = [];
    let off = 0;
    while (buf.length - off >= CHUNK_BYTES) {
      out.push(Buffer.from(buf.subarray(off, off + CHUNK_BYTES)));
      off += CHUNK_BYTES;
    }
    this.rest = Buffer.from(buf.subarray(off));
    return out;
  }

  get pending(): number {
    return this.rest.length;
  }

  reset(): void {
    this.rest = Buffer.alloc(0);
  }
}
