// Desktop app (F14.2): runs the server in-process and opens a window on /setup (first run) or /admin.
// The server bundle is ESM (server/dist/index.js), loaded with import() from this CJS main.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, Menu, nativeImage, powerSaveBlocker, session, shell, Tray } from 'electron';

interface ServerHandle {
  config: { port: number; geminiApiKey: string; setupDone?: boolean };
  stages: { list(): Array<{ stage: { state: string } }> };
  close(): Promise<void>;
}

const PORT = Number(process.env.PORT) || 8080;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let server: ServerHandle | null = null;
let quitting = false;

// app/dist/main.cjs → the repo root in dev, resources/app when packaged
const root = path.resolve(__dirname, '../..');

async function boot(): Promise<void> {
  // Packaged: ffmpeg-static lives unpacked next to the app (asar disabled), samples ship in the app.
  const mod = (await import(pathToFileURL(path.join(root, 'server/dist/index.js')).href)) as {
    startServer(o: { dataDir: string; port: number; samplesDir: string }): Promise<ServerHandle>;
  };
  try {
    server = await mod.startServer({ dataDir: app.getPath('userData'), port: PORT, samplesDir: path.join(root, 'samples') });
  } catch (err) {
    dialog.showErrorBox('Everyone Makes Subs', `Could not start on port ${PORT}. Is another copy already open?\n\n${(err as Error).message}`);
    app.exit(1);
    return;
  }
  powerSaveBlocker.start('prevent-app-suspension');
  // The room station page on this machine needs the microphone.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media' || permission === 'notifications'));
  createWindow();
  createTray();
}

function startPage(): string {
  const c = server!.config;
  const first = !c.geminiApiKey || !c.setupDone;
  return `http://127.0.0.1:${PORT}${first ? '/setup' : '/admin'}`;
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, backgroundColor: '#0B0C0E', title: 'Everyone Makes Subs',
    icon: path.join(root, 'app/icons/icon.png'),
  });
  win.setMenuBarVisibility(false);
  win.loadURL(startPage());
  // Links to other sites (AI Studio, Tailscale, Cloudflare) open in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://127.0.0.1:${PORT}`) || url.startsWith(`http://localhost:${PORT}`)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('close', (e) => {
    if (quitting) return;
    const live = liveCount();
    const choice = dialog.showMessageBoxSync(win!, {
      type: 'question',
      buttons: ['Keep running in the background', 'Stop the captions and quit', 'Cancel'],
      defaultId: 0, cancelId: 2,
      message: 'Stop the captions?',
      detail: live ? `${live} stage${live === 1 ? ' is' : 's are'} live. If you quit, phones stop receiving captions.` : 'No stage is live right now.',
    });
    if (choice === 1) { quitting = true; return; }
    e.preventDefault();
    if (choice === 0) win!.hide();
  });
}

function liveCount(): number {
  return server?.stages.list().filter((rt) => ['live', 'paused', 'degraded'].includes(rt.stage.state)).length ?? 0;
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromPath(path.join(root, 'app/icons/tray.png')));
  const refresh = () => {
    const n = liveCount();
    const label = n ? `${n} stage${n === 1 ? '' : 's'} live` : 'No stages live';
    tray!.setToolTip(`Everyone Makes Subs · ${label}`);
    tray!.setContextMenu(Menu.buildFromTemplate([
      { label, enabled: false },
      { type: 'separator' },
      { label: 'Open dashboard', click: () => { if (!win || win.isDestroyed()) createWindow(); else { win.show(); win.focus(); } } },
      { label: 'Open in browser', click: () => shell.openExternal(`http://localhost:${PORT}/admin`) },
      { type: 'separator' },
      { label: 'Stop the captions and quit', click: () => { quitting = true; app.quit(); } },
    ]));
  };
  refresh();
  setInterval(refresh, 5000);
  tray.on('click', () => { win?.show(); win?.focus(); });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { win?.show(); win?.focus(); });
  app.whenReady().then(boot);
  app.on('activate', () => { if (server && (!win || win.isDestroyed())) createWindow(); else win?.show(); });
  app.on('window-all-closed', () => { /* keep running in the tray */ });
  app.on('before-quit', (e) => {
    quitting = true;
    if (server) {
      e.preventDefault();
      const s = server;
      server = null;
      s.close().finally(() => app.quit());
    }
  });
}
