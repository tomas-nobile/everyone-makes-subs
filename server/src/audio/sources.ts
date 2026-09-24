import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import ffmpegPath from 'ffmpeg-static';
import type { SourceSpec } from '../../../shared/contract.js';
import { BYTES_PER_SEC, Chunker } from './chunker.js';

const PCM_OUT = ['-vn', '-f', 's16le', '-ac', '1', '-ar', '16000', 'pipe:1'];

/**
 * Turns a SourceSpec into the internal stream: PCM s16le mono 16 kHz, exact 3,200-byte chunks.
 * Events: 'chunk' (Buffer). `clock` = bytes read from the source / 32,000 (seconds).
 */
export class AudioSource extends EventEmitter {
  private bytesRead = 0;
  private proc?: ChildProcess;
  private chunker = new Chunker();
  private running = false;

  constructor(private spec: SourceSpec, private label: string) {
    super();
  }

  get clock(): number {
    return this.bytesRead / BYTES_PER_SEC;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.spawnFfmpeg();
  }

  stop(): void {
    this.running = false;
    this.proc?.kill('SIGKILL');
    this.proc = undefined;
  }

  private ffmpegArgs(): string[] {
    switch (this.spec.kind) {
      case 'file':
        return ['-hide_banner', '-loglevel', 'error', '-re', '-i', this.spec.path, ...PCM_OUT];
      default:
        throw new Error(`source kind not supported yet: ${this.spec.kind}`);
    }
  }

  private spawnFfmpeg(): void {
    if (!ffmpegPath) throw new Error('ffmpeg-static has no binary for this platform');
    const proc = spawn(ffmpegPath, this.ffmpegArgs(), { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    this.chunker.reset();
    proc.stdout!.on('data', (data: Buffer) => {
      this.bytesRead += data.length;
      for (const chunk of this.chunker.push(data)) this.emit('chunk', chunk);
    });
    proc.stderr!.on('data', (d: Buffer) => console.log(`[${this.label}] ffmpeg: ${d.toString().trim()}`));
    proc.on('exit', (code) => {
      if (this.proc !== proc || !this.running) return;
      this.proc = undefined;
      if (this.spec.kind === 'file' && this.spec.loop && code === 0) {
        console.log(`[${this.label}] file ended, looping`);
        this.spawnFfmpeg();
      } else {
        console.log(`[${this.label}] ffmpeg exited (code ${code})`);
        this.running = false;
        this.emit('end', code);
      }
    });
  }
}
