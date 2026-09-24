import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { StageEvent } from '../../shared/contract.js';
import { loadConfig, type Config } from './config.js';
import { StageManager } from './stage/StageManager.js';

export interface ServerHandle { app: FastifyInstance; config: Config; close: () => Promise<void> }

export async function startServer(opts: { dataDir?: string; port?: number; host?: string } = {}): Promise<ServerHandle> {
  const config = loadConfig(opts);
  fs.mkdirSync(config.dataDir, { recursive: true });

  const app = Fastify({ logger: false });

  const stages = new StageManager();
  if (config.fakeBackend || config.demo) {
    // TODO(F05): with DEMO=1 and a real key, run real workers on the sample audio instead.
    stages.createDemoStages(path.resolve(process.env.SAMPLES_DIR ?? 'samples'), config.targetLangs);
  }

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/event', async () => ({
    name: 'Everyone Makes Subs',
    stages: stages.list().map((rt) => ({ ...rt.stage, talk: rt.talk, next: rt.next })),
  }));

  app.get('/api/stages', async () => stages.list().map((rt) => rt.stage));

  app.get<{ Params: { id: string } }>('/api/stages/:id/stream', (req, reply) => {
    const rt = stages.get(req.params.id);
    if (!rt) return reply.code(404).send({ error: 'STAGE_NOT_FOUND', message: `Stage ${req.params.id} does not exist` });

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (id: number | null, ev: StageEvent) =>
      res.write(`${id !== null ? `id: ${id}\n` : ''}data: ${JSON.stringify(ev)}\n\n`);

    send(null, { type: 'hello', state: rt.stage.state, talk: rt.talk, next: rt.next, lastSeq: rt.bus.lastSeq });
    const lastEventId = Number(req.headers['last-event-id']);
    if (lastEventId > 0) for (const e of rt.bus.since(lastEventId)) send(e.id, e.ev);

    const unsubscribe = rt.bus.subscribe((e) => send(e.id, e.ev));
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    rt.stage.viewers++;
    req.raw.on('close', () => {
      unsubscribe();
      clearInterval(ping);
      rt.stage.viewers--;
    });
  });

  // Built web (npm run build). In dev, Vite serves web/ and proxies /api here.
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/web');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'NOT_FOUND' });
      return reply.sendFile('index.html');
    });
  }

  await app.listen({ port: config.port, host: opts.host ?? '0.0.0.0' });
  console.log(`[server] listening on :${config.port}${config.fakeBackend ? ' (FAKE_BACKEND)' : ''}`);

  return {
    app, config,
    close: async () => {
      stages.stopAll();
      await app.close();
    },
  };
}

// CLI when run directly (tsx server/src/index.ts or node server/dist/index.js)
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.loadEnvFile(); } catch { /* no .env */ }
  startServer().catch((err) => {
    console.error('[server] failed to start', err);
    process.exit(1);
  });
}
