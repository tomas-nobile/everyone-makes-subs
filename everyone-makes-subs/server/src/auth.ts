import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { saveConfig, type Config } from './config.js';

// Admin auth (F09.1 / F11.2): password → signed httpOnly cookie. Open from 127.0.0.1 while no
// password exists. The password is stored as a scrypt hash; ADMIN_PASSWORD (env) is compared as is.

const COOKIE = 'ems_admin';
const MAX_AGE_SEC = 7 * 24 * 3600;

export function hasPassword(cfg: Config): boolean {
  return !!(cfg.adminPassword || cfg.adminPasswordHash);
}

export function setPassword(cfg: Config, password: string): void {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  saveConfig(cfg, { adminPasswordHash: `${salt}:${hash}` });
}

export function checkPassword(cfg: Config, password: string): boolean {
  if (cfg.adminPassword) return safeEqual(password, cfg.adminPassword);
  if (!cfg.adminPasswordHash) return false;
  const [salt, hash] = cfg.adminPasswordHash.split(':');
  return safeEqual(crypto.scryptSync(password, salt, 32).toString('hex'), hash);
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function secret(cfg: Config): string {
  if (!cfg.cookieSecret) saveConfig(cfg, { cookieSecret: crypto.randomBytes(32).toString('hex') });
  return cfg.cookieSecret!;
}

function sign(cfg: Config, payload: string): string {
  return crypto.createHmac('sha256', secret(cfg)).update(payload).digest('base64url');
}

/** A request that really comes from this machine (not proxied in by a tunnel). */
export function isLocal(req: FastifyRequest): boolean {
  const ip = req.socket.remoteAddress ?? '';
  const loopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  const h = req.headers;
  const proxied = !!(h['x-forwarded-for'] || h['cf-connecting-ip'] || h['tailscale-user-login'] || h['tailscale-funnel-request'] || h['x-real-ip']);
  return loopback && !proxied;
}

function readCookie(req: FastifyRequest, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
}

export function isAdmin(cfg: Config, req: FastifyRequest): boolean {
  if (!hasPassword(cfg)) return isLocal(req);
  const c = readCookie(req, COOKIE);
  if (!c) return false;
  const [exp, sig] = c.split('.');
  return !!sig && Number(exp) > Date.now() / 1000 && safeEqual(sig, sign(cfg, exp));
}

export function setAdminCookie(cfg: Config, req: FastifyRequest, reply: FastifyReply): void {
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE_SEC);
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.protocol === 'https' ? '; Secure' : '';
  reply.header('Set-Cookie', `${COOKIE}=${exp}.${sign(cfg, exp)}; HttpOnly; Path=/; Max-Age=${MAX_AGE_SEC}; SameSite=Lax${secure}`);
}

export function clearAdminCookie(reply: FastifyReply): void {
  reply.header('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

/** Setup routes answer without auth from 127.0.0.1 or while no password exists. */
export function canSetup(cfg: Config, req: FastifyRequest): boolean {
  return isLocal(req) || !hasPassword(cfg) || isAdmin(cfg, req);
}
