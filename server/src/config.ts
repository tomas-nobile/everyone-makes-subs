import fs from 'node:fs';
import path from 'node:path';

// Precedence: env > <dataDir>/config.json > defaults. Empty env vars count as unset.

export interface Config {
  dataDir: string;
  port: number;
  geminiApiKey: string;
  adminPassword: string;
  publicMode: 'tailscale' | 'cloudflare' | 'lan' | 'url';
  publicUrl: string;
  targetLangs: string[];
  transcribeModel: string;
  translateModel: string;
  translateFallbackModel: string;
  auxModel: string;
  sessionRotateSec: number;
  sessionHardCutSec: number;
  forceCommitMs: number;
  // F17.2 / F17.3 latency knobs (env VAD_END_MS, ASR_SILENCE_MS, SENTENCE_MIN_WORDS, COMMA_MIN_WORDS, MAX_PHRASE_WORDS)
  vadEndMs: number;               // hybrid VAD: audioStreamEnd after this much silence (0 = off)
  asrSilenceMs: number;           // server-side VAD silenceDurationMs (0 = model default)
  sentenceMinWords: number;
  commaMinWords: number;
  maxPhraseWords: number;
  translateStream: boolean;       // F17.4: stream the translation and publish `es` as soon as it closes
  translateConcurrency: number;   // F17.5: parallel translation calls per stage
  jobSpeed: number;               // F18.1: feed a video job's audio at N× real time
  demo: boolean;
  demoStages: number;
  fakeBackend: boolean;
  bench: boolean;                 // BENCH=1: stamp segment/tr events with wall-clock times (F17.1)
  // only in config.json (written by the setup wizard)
  adminPasswordHash?: string;
  cookieSecret?: string;
  cloudflareToken?: string;
  setupDone?: boolean;
  keyFromEnv?: boolean;
}

type EnvConfig = Omit<Config, 'dataDir' | 'adminPasswordHash' | 'cookieSecret' | 'cloudflareToken' | 'setupDone' | 'keyFromEnv'>;

const DEFAULTS: EnvConfig = {
  port: 8080,
  geminiApiKey: '',
  adminPassword: '',
  publicMode: 'tailscale',
  publicUrl: '',
  targetLangs: ['es', 'en', 'pt'],
  transcribeModel: 'gemini-3.5-transcribe-live',
  translateModel: 'gemini-3.5-flash-lite',
  translateFallbackModel: 'gemini-3.1-flash-lite',
  auxModel: 'gemini-3.5-flash',
  sessionRotateSec: 510,
  sessionHardCutSec: 580,
  forceCommitMs: 4500,
  vadEndMs: 500,
  asrSilenceMs: 0,
  sentenceMinWords: 5,
  commaMinWords: 8,
  maxPhraseWords: 18,
  translateStream: true,
  translateConcurrency: 2,
  jobSpeed: 1,
  demo: false,
  demoStages: 2,
  fakeBackend: false,
  bench: false,
};

const ENV_KEYS: Record<keyof typeof DEFAULTS, string> = {
  port: 'PORT',
  geminiApiKey: 'GEMINI_API_KEY',
  adminPassword: 'ADMIN_PASSWORD',
  publicMode: 'PUBLIC_MODE',
  publicUrl: 'PUBLIC_URL',
  targetLangs: 'TARGET_LANGS',
  transcribeModel: 'TRANSCRIBE_MODEL',
  translateModel: 'TRANSLATE_MODEL',
  translateFallbackModel: 'TRANSLATE_FALLBACK_MODEL',
  auxModel: 'AUX_MODEL',
  sessionRotateSec: 'SESSION_ROTATE_SEC',
  sessionHardCutSec: 'SESSION_HARD_CUT_SEC',
  forceCommitMs: 'FORCE_COMMIT_MS',
  vadEndMs: 'VAD_END_MS',
  asrSilenceMs: 'ASR_SILENCE_MS',
  sentenceMinWords: 'SENTENCE_MIN_WORDS',
  commaMinWords: 'COMMA_MIN_WORDS',
  maxPhraseWords: 'MAX_PHRASE_WORDS',
  translateStream: 'TRANSLATE_STREAM',
  translateConcurrency: 'TRANSLATE_CONCURRENCY',
  jobSpeed: 'JOB_SPEED',
  demo: 'DEMO',
  demoStages: 'DEMO_STAGES',
  fakeBackend: 'FAKE_BACKEND',
  bench: 'BENCH',
};

function parseEnv(key: keyof typeof DEFAULTS, raw: string): unknown {
  const def = DEFAULTS[key];
  if (typeof def === 'number') return Number(raw);
  if (typeof def === 'boolean') return raw === '1' || raw.toLowerCase() === 'true';
  if (Array.isArray(def)) return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return raw;
}

export function configPath(dataDir: string): string {
  return path.join(dataDir, 'config.json');
}

export function loadConfig(opts: { dataDir?: string; port?: number } = {}): Config {
  const dataDir = path.resolve(opts.dataDir ?? process.env.DATA_DIR ?? './data');
  let file: Partial<Config> = {};
  try {
    file = JSON.parse(fs.readFileSync(configPath(dataDir), 'utf8'));
  } catch {
    // no config.json yet: first run
  }
  const cfg = { ...DEFAULTS, ...file, dataDir } as Config;
  for (const key of Object.keys(ENV_KEYS) as (keyof typeof DEFAULTS)[]) {
    const raw = process.env[ENV_KEYS[key]];
    if (raw !== undefined && raw.trim() !== '') (cfg as unknown as Record<string, unknown>)[key] = parseEnv(key, raw.trim());
  }
  if (opts.port !== undefined) cfg.port = opts.port;
  cfg.keyFromEnv = !!process.env.GEMINI_API_KEY?.trim();
  return cfg;
}

/** Merges `patch` into <dataDir>/config.json (mode 0600) and into the live config object. */
export function saveConfig(cfg: Config, patch: Partial<Config>): void {
  const file = configPath(cfg.dataDir);
  let current: Record<string, unknown> = {};
  try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first write */ }
  Object.assign(current, patch);
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(current, null, 2), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* windows */ }
  Object.assign(cfg, patch);
}
