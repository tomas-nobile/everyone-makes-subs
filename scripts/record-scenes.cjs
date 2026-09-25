// Electron main used by scripts/demo-video.ts: records each scene of a plan as JPEG frames.
// electron scripts/record-scenes.cjs <plan.json>
//   plan: { scenes: [{ url, seconds, warm?, js?, dir }] }  → writes <dir>/00001.jpg… and <dir>/meta.json
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const plan = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'));
const W = plan.width || 1280;
const H = plan.height || 720;
const FRAME_MS = 100;   // ~10 fps is plenty for UI

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// windows are created and destroyed one per scene: don't quit when the last one closes
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  for (const [i, s] of plan.scenes.entries()) {
    fs.mkdirSync(s.dir, { recursive: true });
    const win = new BrowserWindow({
      width: W, height: H, useContentSize: true, show: false, frame: false, backgroundColor: '#0B0C0E',
      webPreferences: { backgroundThrottling: false },
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await win.loadURL(s.url); break; } catch (e) { console.log(`scene ${i + 1}: load failed (${e.code || e.message}), retrying`); await sleep(1000); }
    }
    await sleep(s.warm ?? 1500);
    if (s.js) {
      try { await win.webContents.executeJavaScript(s.js); } catch (e) { console.log(`scene ${i}: js failed: ${e.message}`); }
      await sleep(800);
    }
    let n = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < s.seconds * 1000) {
      const t = Date.now();
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(s.dir, `${String(++n).padStart(5, '0')}.jpg`), img.resize({ width: W, height: H }).toJPEG(88));
      await sleep(Math.max(0, FRAME_MS - (Date.now() - t)));
    }
    const seconds = (Date.now() - t0) / 1000;
    fs.writeFileSync(path.join(s.dir, 'meta.json'), JSON.stringify({ frames: n, seconds }));
    console.log(`scene ${i + 1}/${plan.scenes.length}: ${n} frames in ${seconds.toFixed(1)} s`);
    win.destroy();
  }
  app.quit();
});
