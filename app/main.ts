// F01.4 "hello world": proves the installer pipeline. F14 replaces this with
// startServer() + a window on /setup or /admin.
import { app, BrowserWindow } from 'electron';

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Everyone Makes Subs</title>
<style>html,body{margin:0;height:100%;background:#0B0C0E;color:#F2F2F2;
font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:grid;place-items:center}
h1{font-size:40px}</style></head><body><h1>Everyone Makes Subs</h1></body></html>`;

function createWindow(): void {
  const win = new BrowserWindow({ width: 900, height: 600, backgroundColor: '#0B0C0E', title: 'Everyone Makes Subs' });
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
