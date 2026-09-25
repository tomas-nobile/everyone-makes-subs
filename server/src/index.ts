import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import type { EventInfo, StageEvent, StageState } from '../../shared/contract.js';
import { loadConfig, type Config } from './config.js';
import { PublicWatch, publicUrl, startCloudflared } from './public/access.js';
import { adminRoutes } from './routes/admin.js';
import { setupRoutes } from './routes/setup.js';
import { StageManager } from './stage/StageManager.js';
import { toSrt, toTxt, toVtt } from './store/export.js';

export interface ServerHandle { app: FastifyInstance; config: Config; stages: StageManager; close: () => Promise<void> }

export const EVENT_NAME = process.env.EVENT_NAME || 'Everyone Makes Subs';
const STATES: StageState[] = ['idle', 'connecting', 'live', 'paused', 'no_signal', 'degraded', 'error'];

export async function startServer(opts: { dataDir?: string; port?: number; host?: string; samplesDir?: string } = {}): Promise<ServerHandle> {
  const config = loadConfig(opts);
  fs.mkdirSync(config.dataDir, { recursive: true });
  const samplesDir = path.resolve(opts.samplesDir ?? process.env.SAMPLES_DIR ?? 'samples');

  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  await app.register(websocket);

  const stages = new StageManager(config);
  stages.load();
  if ((config.fakeBackend || config.demo) && stages.list().length === 0) stages.createDemoStages(samplesDir);

  const watch = new PublicWatch(config);
  watch.start();
  if (config.publicMode === 'cloudflare' && config.cloudflareToken) {
    startCloudflared(config, config.cloudflareToken).catch((err) => console.log(`[cloudflared] ${(err as Error).message}`));
  }

  const notFound = (id: string) => ({ error: 'STAGE_NOT_FOUND', message: `Stage ${id} does not exist` });

  // ── public ──

  app.get<{ Querystring: { nonce?: string } }>('/api/health', async (req) => ({ ok: true, nonce: req.query.nonce }));

  app.get('/api/event', async (): Promise<EventInfo> => ({
    name: EVENT_NAME,
    publicUrl: publicUrl(config),
    stages: stages.list().map((rt) => stages.summaryOf(rt)),
  }));

  app.get<{ Params: { id: string } }>('/api/stages/:id/stream', (req, reply) => {
    const rt = stages.get(req.params.id);
    if (!rt) return reply.code(404).send(notFound(req.params.id));

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

    send(null, { type: 'hello', state: rt.stage.state, talk: stages.talkOf(rt), next: stages.nextOf(rt), last: stages.lastOf(rt), lastSeq: rt.bus.lastSeq, recent: stages.recent(rt) });
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

  app.get<{ Params: { id: string }; Querystring: { before?: string; talk?: string } }>('/api/stages/:id/history', async (req, reply) => {
    const rt = stages.get(req.params.id);
    if (!rt) return reply.code(404).send(notFound(req.params.id));
    return stages.history(rt, Number(req.query.before) || Number.MAX_SAFE_INTEGER, req.query.talk);
  });

  app.get<{ Params: { id: string }; Querystring: { lang?: string } }>('/api/stages/:id/summary', async (req, reply) => {
    const rt = stages.get(req.params.id);
    if (!rt) return reply.code(404).send(notFound(req.params.id));
    return stages.summary(rt, req.query.lang || rt.stage.targetLangs[0]);
  });

  app.get<{ Params: { id: string; fmt: string }; Querystring: { lang?: string } }>('/api/talks/:id/export.:fmt', async (req, reply) => {
    const { id, fmt } = req.params;
    const talk = stages.getTalk(id);
    const segs = stages.store.findTalk(id, talk?.stageId);
    if (!talk && segs.length === 0) return reply.code(404).send({ error: 'TALK_NOT_FOUND', message: `Talk ${id} does not exist` });
    const lang = req.query.lang || undefined;
    const name = `${id}${lang ? `.${lang}` : ''}.${fmt}`;
    const body = fmt === 'srt' ? toSrt(segs, lang) : fmt === 'vtt' ? toVtt(segs, lang) : fmt === 'txt' ? toTxt(segs, lang, talk?.title) : null;
    if (body === null) return reply.code(400).send({ error: 'BAD_FORMAT', message: 'Use srt, vtt or txt' });
    const type = fmt === 'vtt' ? 'text/vtt' : fmt === 'srt' ? 'application/x-subrip' : 'text/plain';
    return reply.header('Content-Type', `${type}; charset=utf-8`).header('Content-Disposition', `attachment; filename="${name}"`).send(body);
  });

  // F07.5: force a state from the fake backend to see every attendee screen.
  app.get<{ Querystring: { stage?: string; state?: string } }>('/api/dev/state', async (req, reply) => {
    if (!config.fakeBackend) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Only in fake mode' });
    const state = STATES.includes(req.query.state as StageState) ? (req.query.state as StageState) : undefined;
    stages.forceState(req.query.stage ?? '', state);
    return { ok: true, stage: req.query.stage, state: state ?? 'auto' };
  });

  // F08.2: room station audio (PCM s16le mono 16 kHz, binary frames).
  app.get<{ Params: { id: string }; Querystring: { key?: string } }>('/api/stages/:id/ingest', { websocket: true }, (socket, req) => {
    const id = req.params.id;
    const key = req.query.key ?? '';
    const check = stages.ingest(id, key, Buffer.alloc(0));
    if (check !== 'ok') {
      console.log(`[${id}] station rejected (${check})`);
      socket.close(check === 'bad_key' ? 4001 : 4004, check);
      return;
    }
    console.log(`[${id}] station connected`);
    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) stages.ingest(id, key, Buffer.isBuffer(data) ? data : Buffer.from(data));
    });
    socket.on('close', () => console.log(`[${id}] station disconnected`));
  });

  await adminRoutes(app, config, stages, watch);
  await setupRoutes(app, config, stages, samplesDir);

  // Built web (npm run build). In dev, Vite serves web/ and proxies /api here.
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/web');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown route' });
      return reply.sendFile('index.html');
    });
  }

  await app.listen({ port: config.port, host: opts.host ?? '0.0.0.0' });
  console.log(`[server] listening on :${config.port}${config.fakeBackend ? ' (FAKE_BACKEND)' : ''} · public ${publicUrl(config)}`);

  return {
    app, config, stages,
    close: async () => {
      stages.stopAll();
      watch.stop();
      await app.close();
    },
  };
}

// CLI when run directly (tsx server/src/index.ts or node server/dist/index.js)
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.loadEnvFile(); } catch { /* no .env */ }
  startServer().then((h) => {
    const bye = () => { h.close().finally(() => process.exit(0)); };
    process.on('SIGINT', bye);
    process.on('SIGTERM', bye);
  }).catch((err) => {
    console.error('[server] failed to start', err);
    process.exit(1);
  });
  process.on('uncaughtException', (err) => console.error('[server] uncaught', err));
  process.on('unhandledRejection', (err) => console.error('[server] unhandled rejection', err));
}
