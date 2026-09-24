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
  demo: boolean;
  fakeBackend: boolean;
}

const DEFAULTS: Omit<Config, 'dataDir'> = {
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
  demo: false,
  fakeBackend: false,
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
  demo: 'DEMO',
  fakeBackend: 'FAKE_BACKEND',
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
  return cfg;
}
