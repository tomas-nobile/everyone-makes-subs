import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import ffmpegPath from 'ffmpeg-static';
import type { SourceSpec } from '../../../shared/contract.js';
import { BYTES_PER_SEC, Chunker } from './chunker.js';

const PCM_OUT = ['-vn', '-f', 's16le', '-ac', '1', '-ar', '16000', 'pipe:1'];
const NO_DATA_MS = 5_000;
const MAX_BACKOFF_MS = 30_000;

export type SourceState = 'connecting' | 'live' | 'no_signal';

/**
 * Turns a SourceSpec into the internal stream: PCM s16le mono 16 kHz, exact 3,200-byte chunks.
 * Events: 'chunk' (Buffer), 'state' (SourceState), 'end' (a non-looping file finished).
 * `clock` = bytes read from the source / 32,000 (seconds); it keeps counting across restarts.
 * If ffmpeg exits or sends nothing for 5 s → 'no_signal' and restart with backoff 1, 2, 4… 30 s.
 */
export class AudioSource extends EventEmitter {
  state: SourceState = 'connecting';
  private bytesRead = 0;
  private proc?: ChildProcess;
  private chunker = new Chunker();
  private running = false;
  private attempt = 0;
  private lastDataAt = 0;
  private watchdog?: NodeJS.Timeout;
  private restartTimer?: NodeJS.Timeout;

  constructor(private spec: SourceSpec, private label: string) {
    super();
  }

  get clock(): number {
    return this.bytesRead / BYTES_PER_SEC;
  }

  get pid(): number | undefined {
    return this.proc?.pid;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.setState('connecting');
    this.watchdog = setInterval(() => this.checkData(), 1000);
    this.spawnFfmpeg();
  }

  stop(): void {
    this.running = false;
    clearInterval(this.watchdog);
    clearTimeout(this.restartTimer);
    this.kill();
  }

  private setState(s: SourceState): void {
    if (this.state === s) return;
    this.state = s;
    console.log(`[${this.label}] source → ${s}`);
    this.emit('state', s);
  }

  private kill(): void {
    const proc = this.proc;
    this.proc = undefined;
    if (proc && proc.exitCode === null) proc.kill('SIGKILL');
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
    if (!this.running) return;
    if (!ffmpegPath) throw new Error('ffmpeg-static has no binary for this platform');
    const proc = spawn(ffmpegPath, this.ffmpegArgs(), { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    this.chunker.reset();
    this.lastDataAt = Date.now();
    proc.stdout!.on('data', (data: Buffer) => {
      this.lastDataAt = Date.now();
      this.attempt = 0;
      this.setState('live');
      this.bytesRead += data.length;
      for (const chunk of this.chunker.push(data)) this.emit('chunk', chunk);
    });
    proc.stderr!.on('data', (d: Buffer) => console.log(`[${this.label}] ffmpeg: ${d.toString().trim()}`));
    proc.on('error', (err) => console.log(`[${this.label}] ffmpeg spawn error: ${err.message}`));
    proc.on('exit', (code, signal) => {
      if (this.proc !== proc || !this.running) return;
      this.proc = undefined;
      if (this.spec.kind === 'file' && code === 0) {
        if (this.spec.loop) {
          console.log(`[${this.label}] file ended, looping`);
          this.spawnFfmpeg();
        } else {
          this.stop();
          this.emit('end');
        }
        return;
      }
      console.log(`[${this.label}] ffmpeg exited (code ${code ?? signal})`);
      this.scheduleRestart();
    });
  }

  private checkData(): void {
    if (!this.proc || Date.now() - this.lastDataAt < NO_DATA_MS) return;
    console.log(`[${this.label}] no data for ${NO_DATA_MS / 1000} s, restarting ffmpeg`);
    this.kill();
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    this.setState('no_signal');
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt);
    this.attempt++;
    console.log(`[${this.label}] restart in ${delay / 1000} s (attempt ${this.attempt})`);
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => this.spawnFfmpeg(), delay);
  }
}
