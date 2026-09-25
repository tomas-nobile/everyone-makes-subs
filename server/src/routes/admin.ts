import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AgendaProposal, Glossary, SourceSpec, StageInput, TalkInput } from '../../../shared/contract.js';
import { parseAgenda } from '../ai/auxModel.js';
import { checkPassword, clearAdminCookie, hasPassword, isAdmin, setAdminCookie } from '../auth.js';
import type { Config } from '../config.js';
import type { JobInput, Jobs } from '../jobs/Jobs.js';
import { publicUrl, type PublicWatch } from '../public/access.js';
import type { StageManager } from '../stage/StageManager.js';

const EVENT_NAME = process.env.EVENT_NAME || 'Everyone Makes Subs';
const LANG = /^[a-z]{2}$/;

function bad(reply: FastifyReply, message: string, error = 'VALIDATION_ERROR') {
  return reply.code(400).send({ error, message });
}

function validSource(s: unknown): s is SourceSpec {
  const x = s as SourceSpec;
  if (!x || typeof x !== 'object') return false;
  switch (x.kind) {
    case 'station': return true;
    case 'url': return typeof x.url === 'string' && /^(https?|rtmp|rtsp|srt):\/\//.test(x.url);
    case 'file': return typeof x.path === 'string' && x.path.length > 0;
    case 'mediamtx': return typeof x.path === 'string' && /^[\w-]+$/.test(x.path);
    default: return false;
  }
}

function validTalk(b: unknown): b is TalkInput {
  const t = b as TalkInput;
  return !!t && typeof t.title === 'string' && t.title.trim().length > 0 && t.title.length <= 300
    && (t.lang === undefined || t.lang === '' || LANG.test(t.lang));
}

/** Streams a file honouring `Range` (the dashboard's <video> seeks with it). */
function sendFile(req: FastifyRequest, reply: FastifyReply, file: string, type: string, download?: string) {
  const size = fs.statSync(file).size;
  if (download) reply.header('Content-Disposition', `attachment; filename="${download}"`);
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (!m) return reply.headers({ 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' }).send(fs.createReadStream(file));
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start > end || start >= size) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
  return reply.code(206).headers({ 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' }).send(fs.createReadStream(file, { start, end }));
}

export async function adminRoutes(app: FastifyInstance, cfg: Config, stages: StageManager, watch: PublicWatch, jobs: Jobs): Promise<void> {
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isAdmin(cfg, req)) return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Log in to the dashboard' });
  };
  const notFound = (reply: FastifyReply, id: string) => reply.code(404).send({ error: 'STAGE_NOT_FOUND', message: `Stage ${id} does not exist` });

  // ── session ──

  app.get('/api/admin/me', async (req) => ({ authed: isAdmin(cfg, req), hasPassword: hasPassword(cfg) }));

  app.post<{ Body: { password?: string } }>('/api/admin/login', async (req, reply) => {
    if (!hasPassword(cfg)) return { ok: true };
    if (typeof req.body?.password !== 'string' || !checkPassword(cfg, req.body.password)) {
      return reply.code(401).send({ error: 'WRONG_PASSWORD', message: 'Wrong password' });
    }
    setAdminCookie(cfg, req, reply);
    return { ok: true };
  });

  app.post('/api/admin/logout', async (_req, reply) => {
    clearAdminCookie(reply);
    return { ok: true };
  });

  // ── metrics SSE (F09.2) ──

  app.get('/api/admin/metrics', { preHandler: guard }, (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const push = () => res.write(`data: ${JSON.stringify(stages.metrics(EVENT_NAME, publicUrl(cfg), { reachable: watch.reachable, addressChanged: watch.addressChanged }))}\n\n`);
    push();
    const timer = setInterval(push, 1000);
    req.raw.on('close', () => clearInterval(timer));
  });

  // ── stages (F05.1, F09.5) ──

  app.get('/api/stages', { preHandler: guard }, async () => stages.list().map((rt) => stages.adminView(rt)));

  app.post<{ Body: StageInput }>('/api/stages', { preHandler: guard }, async (req, reply) => {
    const b = req.body;
    if (!b || typeof b.name !== 'string' || !b.name.trim() || b.name.length > 80) return bad(reply, 'A stage needs a name');
    if (!validSource(b.source)) return bad(reply, 'Choose where the audio comes from');
    if (b.targetLangs && (!Array.isArray(b.targetLangs) || !b.targetLangs.every((l) => LANG.test(l)))) return bad(reply, 'Languages must be 2-letter codes');
    const rt = stages.create(b);
    return reply.code(201).send(stages.adminView(rt));
  });

  app.patch<{ Params: { id: string }; Body: Partial<StageInput> }>('/api/stages/:id', { preHandler: guard }, async (req, reply) => {
    const b = req.body ?? {};
    if (b.source !== undefined && !validSource(b.source)) return bad(reply, 'Choose where the audio comes from');
    const rt = stages.update(req.params.id, b);
    return rt ? stages.adminView(rt) : notFound(reply, req.params.id);
  });

  app.delete<{ Params: { id: string } }>('/api/stages/:id', { preHandler: guard }, async (req, reply) =>
    stages.remove(req.params.id) ? { ok: true } : notFound(reply, req.params.id));

  for (const action of ['start', 'stop', 'next-talk'] as const) {
    app.post<{ Params: { id: string } }>(`/api/stages/:id/${action}`, { preHandler: guard }, async (req, reply) => {
      const id = req.params.id;
      const rt = action === 'start' ? stages.start(id) : action === 'stop' ? stages.stop(id) : stages.nextTalk(id);
      return rt ? stages.adminView(rt) : notFound(reply, id);
    });
  }

  // ── talks and vocabulary (F10.1) ──

  app.post<{ Params: { id: string }; Body: TalkInput }>('/api/stages/:id/talk', { preHandler: guard }, async (req, reply) => {
    if (!stages.get(req.params.id)) return notFound(reply, req.params.id);
    if (!validTalk(req.body)) return bad(reply, 'A talk needs a title');
    return stages.addTalk(req.params.id, req.body);
  });

  app.put<{ Params: { id: string }; Body: Glossary }>('/api/talks/:id/glossary', { preHandler: guard }, async (req, reply) => {
    const g = req.body;
    const strings = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === 'string');
    if (!g || !strings(g.asrVocabulary) || !strings(g.doNotTranslate ?? [])) return bad(reply, 'Vocabulary must be a list of terms');
    const talk = stages.updateGlossary(req.params.id, { asrVocabulary: g.asrVocabulary, doNotTranslate: g.doNotTranslate ?? [], preferred: g.preferred ?? {}, replacements: g.replacements ?? {} });
    return talk ?? reply.code(404).send({ error: 'TALK_NOT_FOUND', message: `Talk ${req.params.id} does not exist` });
  });

  app.delete<{ Params: { id: string } }>('/api/talks/:id', { preHandler: guard }, async (req, reply) =>
    stages.deleteTalk(req.params.id) ? { ok: true } : reply.code(404).send({ error: 'TALK_NOT_FOUND', message: `Talk ${req.params.id} does not exist` }));

  // ── agenda (F10.2) ──

  app.post<{ Body: { text?: string } }>('/api/agenda/parse', { preHandler: guard }, async (req, reply) => {
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim()) return bad(reply, 'Paste the schedule first');
    return parseAgenda(cfg, text);
  });

  app.post<{ Body: AgendaProposal }>('/api/agenda', { preHandler: guard }, async (req, reply) => {
    const p = req.body;
    if (!p || !Array.isArray(p.talks) || !p.talks.every((t) => t && typeof t.room === 'string' && validTalk(t))) return bad(reply, 'Every talk needs a room and a title');
    const out = await stages.applyAgenda({ rooms: Array.isArray(p.rooms) ? p.rooms : [], talks: p.talks });
    return { stages: out.stages.map((rt) => stages.adminView(rt)), talks: out.talks };
  });

  // ── alerts (F10.3 "Wait 5 min") ──

  app.post<{ Params: { id: string } }>('/api/alerts/:id/snooze', { preHandler: guard }, async (req) => {
    stages.snooze(req.params.id);
    return { ok: true };
  });

  // ── uploads (F09.5 "Audio file") ──

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 1024 * 1024 * 1024 }, (_req, body, done) => done(null, body));
  app.post<{ Querystring: { name?: string } }>('/api/uploads', { preHandler: guard, bodyLimit: 1024 * 1024 * 1024 }, async (req, reply) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) return bad(reply, 'The file is empty');
    const name = (req.query.name ?? 'audio').replace(/[^\w.-]+/g, '_').slice(-80);
    const dir = path.join(cfg.dataDir, 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${name}`);
    fs.writeFileSync(file, body);
    console.log(`[uploads] ${path.basename(file)} (${Math.round(body.length / 1024)} KB)`);
    return { path: file };
  });

  // ── video jobs (F18.1): raw upload with the metadata in the query, or JSON { url, … } ──

  const jobNotFound = (reply: FastifyReply, id: string) => reply.code(404).send({ error: 'JOB_NOT_FOUND', message: `Job ${id} does not exist` });
  const validLangs = (i: JobInput) => [i.lang, i.srcLang].every((l) => !l || LANG.test(l));

  app.post<{ Querystring: JobInput & { name?: string }; Body: unknown }>('/api/jobs', { preHandler: guard, bodyLimit: 1024 * 1024 * 1024 }, async (req, reply) => {
    if (Buffer.isBuffer(req.body)) {
      const q = req.query;
      const meta: JobInput = { lang: q.lang, srcLang: q.srcLang, title: q.title, speaker: q.speaker, abstract: q.abstract };
      if (req.body.length === 0) return bad(reply, 'The file is empty');
      if (!validLangs(meta)) return bad(reply, 'Languages must be 2-letter codes');
      return reply.code(201).send(jobs.createFromUpload((q.name ?? 'video.mp4').replace(/[^\w.-]+/g, '_').slice(-80), req.body, meta));
    }
    const b = (req.body ?? {}) as JobInput & { url?: string };
    if (typeof b.url !== 'string' || !/^https?:\/\//.test(b.url)) return bad(reply, 'Paste a video link or upload a file');
    if (!validLangs(b)) return bad(reply, 'Languages must be 2-letter codes');
    return reply.code(201).send(jobs.createFromUrl(b.url.trim(), b));
  });

  app.get('/api/jobs', { preHandler: guard }, async () => jobs.list());

  app.get<{ Params: { id: string } }>('/api/jobs/:id', { preHandler: guard }, async (req, reply) => jobs.get(req.params.id) ?? jobNotFound(reply, req.params.id));

  app.delete<{ Params: { id: string } }>('/api/jobs/:id', { preHandler: guard }, async (req, reply) =>
    jobs.remove(req.params.id) ? { ok: true } : jobNotFound(reply, req.params.id));

  app.get<{ Params: { id: string; name: string } }>('/api/jobs/:id/:name', { preHandler: guard }, async (req, reply) => {
    const { id, name } = req.params;
    if (name !== 'video.mp4' && name !== 'video.vtt' && name !== 'video.srt') return reply.code(404).send({ error: 'NOT_FOUND', message: 'Use video.mp4, video.vtt or video.srt' });
    const file = jobs.output(id, name);
    if (!file) return jobNotFound(reply, id);
    const job = jobs.get(id)!;
    const base = `${job.title.replace(/[^\w.-]+/g, '_').slice(0, 60) || id}.${job.lang}`;
    if (name === 'video.mp4') return sendFile(req, reply, file, 'video/mp4', req.query && 'download' in (req.query as object) ? `${base}.mp4` : undefined);
    const type = name === 'video.vtt' ? 'text/vtt' : 'application/x-subrip';
    return sendFile(req, reply, file, `${type}; charset=utf-8`, `${base}.${name.slice(-3)}`);
  });
}
