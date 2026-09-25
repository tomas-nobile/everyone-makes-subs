import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PublicMode, SetupState } from '../../../shared/contract.js';
import { testKey } from '../ai/auxModel.js';
import { canSetup, hasPassword, setAdminCookie, setPassword } from '../auth.js';
import { saveConfig, type Config } from '../config.js';
import { errorStatus } from '../gemini.js';
import { inDocker, lanUrl, nonceTest, publicUrl, startCloudflared, stopCloudflared, tailscaleFunnel, tailscaleStatus, tailscaleUp } from '../public/access.js';
import type { StageManager } from '../stage/StageManager.js';

/** Plain-language reason for a failed key test (F11.1). */
export function keyError(err: unknown): { error: string; message: string } {
  const status = errorStatus(err);
  const msg = String((err as Error)?.message ?? '');
  if (/api key not valid|API_KEY_INVALID|invalid api key/i.test(msg) || status === 400 || status === 401) {
    return { error: 'INVALID_KEY', message: 'The key is not valid. Copy it again from AI Studio.' };
  }
  if (status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(msg)) {
    return { error: 'NO_QUOTA', message: 'The key works, but its project has no quota left. Check billing in AI Studio.' };
  }
  if (status === 403 || status === 404 || /permission|not found|not supported/i.test(msg)) {
    return { error: 'NO_MODEL_ACCESS', message: 'The key belongs to a project without access to this model.' };
  }
  return { error: 'NETWORK', message: 'Could not reach Gemini. Check the internet connection and try again.' };
}

export async function setupRoutes(app: FastifyInstance, cfg: Config, stages: StageManager, samplesDir: string): Promise<void> {
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!canSetup(cfg, req)) return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Log in to the dashboard' });
  };

  app.get('/api/setup/state', { preHandler: guard }, async (): Promise<SetupState> => ({
    hasKey: !!cfg.geminiApiKey,
    keyFromEnv: !!cfg.keyFromEnv,
    hasPassword: hasPassword(cfg),
    publicMode: cfg.publicMode,
    publicUrl: publicUrl(cfg),
    lanUrl: lanUrl(cfg.port),
    docker: inDocker,
    port: cfg.port,
    stages: stages.list().length,
    done: !!cfg.setupDone,
  }));

  app.post<{ Body: { key?: string } }>('/api/setup/key', { preHandler: guard }, async (req, reply) => {
    const key = req.body?.key?.trim();
    if (!key) return reply.code(400).send({ error: 'INVALID_KEY', message: 'Paste the key first.' });
    try {
      await testKey(cfg, key);
    } catch (err) {
      const e = keyError(err);
      console.log(`[setup] key test failed: ${e.error}`);
      return reply.code(400).send(e);
    }
    saveConfig(cfg, { geminiApiKey: key });
    console.log('[setup] Gemini key saved');
    // stages that were waiting for a key start transcribing now
    for (const rt of stages.list()) if (rt.running) { stages.stop(rt.stage.id); stages.start(rt.stage.id); }
    return { ok: true };
  });

  app.post<{ Body: { password?: string } }>('/api/setup/password', { preHandler: guard }, async (req, reply) => {
    const pw = req.body?.password ?? '';
    if (pw.length < 6) return reply.code(400).send({ error: 'PASSWORD_TOO_SHORT', message: 'Use at least 6 characters.' });
    if (cfg.adminPassword) return reply.code(409).send({ error: 'PASSWORD_FROM_ENV', message: 'The password is set with ADMIN_PASSWORD on the server.' });
    setPassword(cfg, pw);
    setAdminCookie(cfg, req, reply);
    return { ok: true };
  });

  app.get('/api/setup/tailscale', { preHandler: guard }, async () => tailscaleStatus(cfg.port));
  app.post('/api/setup/tailscale/up', { preHandler: guard }, async () => tailscaleUp(cfg.port));
  app.post('/api/setup/tailscale/funnel', { preHandler: guard }, async () => tailscaleFunnel(cfg.port));

  app.post<{ Body: { mode?: PublicMode; url?: string; token?: string } }>('/api/setup/public', { preHandler: guard }, async (req, reply) => {
    const { mode, token } = req.body ?? {};
    const url = req.body?.url?.trim().replace(/\/+$/, '') ?? '';
    if (!mode || !['tailscale', 'cloudflare', 'lan', 'url'].includes(mode)) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Choose how phones will get in.' });
    if (mode !== 'lan' && !/^https?:\/\/[^\s/]+/.test(url)) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Enter the full public address, starting with https://' });
    if (mode === 'cloudflare') {
      if (!token?.trim()) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Paste the tunnel token from the Cloudflare dashboard.' });
      try { await startCloudflared(cfg, token.trim()); } catch (err) {
        return reply.code(500).send({ error: 'CLOUDFLARED_FAILED', message: (err as Error).message });
      }
    } else stopCloudflared();
    saveConfig(cfg, { publicMode: mode, publicUrl: mode === 'lan' ? '' : url });
    console.log(`[setup] public access: ${mode} ${publicUrl(cfg)}`);
    return { ok: true, publicUrl: publicUrl(cfg) };
  });

  app.post<{ Body: { url?: string } }>('/api/setup/test', { preHandler: guard }, async (req, reply) => {
    const url = req.body?.url?.trim();
    if (!url || !/^https?:\/\//.test(url)) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Enter an address starting with https://' });
    return nonceTest(url);
  });

  app.post('/api/setup/demo', { preHandler: guard }, async () => ({
    stages: (await stages.createDemoStages(samplesDir)).map((rt) => stages.adminView(rt)),
  }));

  app.post('/api/setup/done', { preHandler: guard }, async () => {
    saveConfig(cfg, { setupDone: true });
    return { ok: true };
  });
}
