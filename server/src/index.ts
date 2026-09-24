import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { loadConfig, type Config } from './config.js';

export interface ServerHandle { app: FastifyInstance; config: Config; close: () => Promise<void> }

export async function startServer(opts: { dataDir?: string; port?: number; host?: string } = {}): Promise<ServerHandle> {
  const config = loadConfig(opts);
  fs.mkdirSync(config.dataDir, { recursive: true });

  const app = Fastify({ logger: false });

  app.get('/api/health', async () => ({ ok: true }));

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

  return { app, config, close: () => app.close() };
}

// CLI when run directly (tsx server/src/index.ts or node server/dist/index.js)
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.loadEnvFile(); } catch { /* no .env */ }
  startServer().catch((err) => {
    console.error('[server] failed to start', err);
    process.exit(1);
  });
}
