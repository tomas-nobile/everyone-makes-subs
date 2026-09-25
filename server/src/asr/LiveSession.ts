import { EventEmitter } from 'node:events';
import { Modality, type LiveServerMessage, type Session } from '@google/genai';
import { genai } from '../gemini.js';

/**
 * One ASR connection. Events:
 *  'interim' (text: string)  accumulated text of the current utterance
 *  'final'   (text: string)  the utterance is done
 *  'goaway'  ()              the server will close soon
 *  'close'   (reason: string, unexpected: boolean)
 */
export interface AsrSession extends EventEmitter {
  readonly id: number;
  ready: Promise<void>;
  send(chunk: Buffer): void;
  end(): void;               // audioStreamEnd
  close(): void;
}

export interface AsrOptions { apiKey: string; model: string; lang?: string; vocabulary: string[]; label: string }

let nextId = 1;

/**
 * Gemini Live transcription session. Interims arrive in `interimInputTranscription` (cumulative);
 * the utterance ends with `inputTranscription` + `generationComplete` / ACTIVITY_END (F03.1).
 * Deltas would also work: `mergeInterim` appends text that does not extend the previous one.
 */
export class LiveSession extends EventEmitter implements AsrSession {
  readonly id = nextId++;
  ready: Promise<void>;
  private session?: Session;
  private closedByUs = false;
  private utterance = '';
  private finalBuf = '';

  constructor(private opts: AsrOptions) {
    super();
    this.ready = this.connect();
    this.ready.catch(() => { /* surfaced as 'close' */ });
  }

  private async connect(): Promise<void> {
    try {
      this.session = await genai(this.opts.apiKey).live.connect({
        model: this.opts.model,
        config: {
          responseModalities: [Modality.TEXT],
          inputAudioTranscription: {
            languageCodes: this.opts.lang ? [this.opts.lang] : [],
            customVocabulary: this.opts.vocabulary.slice(0, 100),
            mode: 'VERBATIM' as never,
          },
        },
        callbacks: {
          onmessage: (m) => this.onMessage(m),
          onerror: (e) => console.log(`[${this.opts.label}] asr#${this.id} error: ${(e as ErrorEvent).message ?? 'unknown'}`),
          onclose: (e) => this.onClose(`${(e as CloseEvent).code ?? ''} ${(e as CloseEvent).reason ?? ''}`.trim()),
        },
      });
    } catch (err) {
      console.log(`[${this.opts.label}] asr#${this.id} connect failed: ${(err as Error).message}`);
      setImmediate(() => this.emit('close', `connect failed: ${(err as Error).message}`, true));
      throw err;
    }
  }

  private onMessage(m: LiveServerMessage): void {
    if (m.goAway) this.emit('goaway');
    // Verified in F03.1: interims are cumulative (the whole utterance so far); the final is an
    // `inputTranscription` with the full text but no `finished`, followed by `generationComplete`
    // and `voiceActivity` ACTIVITY_END. The raw message says `voiceActivity.type`; the SDK types
    // say `voiceActivityType`: accept both.
    const va = m.voiceActivity as { type?: string; voiceActivityType?: string } | undefined;
    const activity = va?.type ?? va?.voiceActivityType;
    const sc = m.serverContent;
    if (activity === 'ACTIVITY_START') this.flushFinal();   // never merge two utterances
    const interim = sc?.interimInputTranscription?.text;
    if (interim) {
      this.utterance = interim;   // cumulative: each interim is the whole utterance so far
      this.emit('interim', this.utterance);
    }
    const fin = sc?.inputTranscription;
    if (fin?.text) this.finalBuf = mergeInterim(this.finalBuf, fin.text);
    if (fin?.finished || sc?.turnComplete || sc?.generationComplete || activity === 'ACTIVITY_END') this.flushFinal();
  }

  private flushFinal(): void {
    const text = (this.finalBuf || this.utterance).trim();
    this.finalBuf = '';
    this.utterance = '';
    if (text) this.emit('final', text);
  }

  private onClose(reason: string): void {
    this.flushFinal();
    this.emit('close', reason, !this.closedByUs);
  }

  send(chunk: Buffer): void {
    this.session?.sendRealtimeInput({ audio: { data: chunk.toString('base64'), mimeType: 'audio/pcm;rate=16000' } });
  }

  end(): void {
    this.session?.sendRealtimeInput({ audioStreamEnd: true });
  }

  close(): void {
    this.closedByUs = true;
    try { this.session?.close(); } catch { /* already closed */ }
  }
}

/** Cumulative interims replace the text; deltas are appended. */
export function mergeInterim(prev: string, next: string): string {
  if (!prev) return next;
  const p = prev.trim().toLowerCase();
  const n = next.trim().toLowerCase();
  if (n.startsWith(p.slice(0, Math.max(1, Math.floor(p.length * 0.6))))) return next; // cumulative (may revise the tail)
  const sep = /^[\s.,;:!?]/.test(next) || /\s$/.test(prev) ? '' : ' ';
  return prev + sep + next;
}
