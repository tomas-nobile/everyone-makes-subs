import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

function releaseAsset(): string {
  if (process.platform === 'win32') return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  return process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
}

let cached: string | undefined;
let downloading: Promise<string> | undefined;

/** yt-dlp from PATH, else <dataDir>/bin, else downloads the standalone binary there (first use). */
export async function findYtDlp(dataDir: string): Promise<string> {
  if (cached) return cached;
  if (spawnSync('yt-dlp', ['--version'], { stdio: 'ignore' }).status === 0) return (cached = 'yt-dlp');
  const local = path.join(dataDir, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  if (fs.existsSync(local)) return (cached = local);
  downloading ??= download(local).finally(() => (downloading = undefined));
  return (cached = await downloading);
}

async function download(dest: string): Promise<string> {
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${releaseAsset()}`;
  console.log(`[yt-dlp] not found, downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`yt-dlp download failed: HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()), { mode: 0o755 });
  fs.renameSync(tmp, dest);
  console.log(`[yt-dlp] saved to ${dest}`);
  return dest;
}

export function isYouTube(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\.|^m\./, '');
    return host === 'youtube.com' || host === 'youtu.be' || host === 'music.youtube.com';
  } catch {
    return false;
  }
}

/**
 * YouTube also serves AI-dubbed audio tracks (e.g. an automatic English dub of a Spanish talk), often
 * at a higher bitrate than the original: prefer the track marked "original", then the default one.
 */
export const ORIGINAL_AUDIO = 'ba[format_note*=original]/ba[format_note*=default]/bestaudio/best';

/** Resolves a YouTube link to a direct audio URL. `isLive` decides whether ffmpeg uses -re. */
export async function resolveYouTube(url: string, dataDir: string): Promise<{ input: string; isLive: boolean }> {
  const bin = await findYtDlp(dataDir);
  const { stdout } = await run(bin, ['-f', ORIGINAL_AUDIO, '--no-playlist', '--no-warnings',
    '--print', 'is_live', '--print', 'urls', url], { timeout: 60_000, maxBuffer: 1 << 20 });
  const [isLive, direct] = stdout.trim().split(/\r?\n/);
  if (!direct?.startsWith('http')) throw new Error(`yt-dlp returned no URL for ${url}`);
  return { input: direct, isLive: isLive === 'True' };
}
