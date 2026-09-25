// Electron main used by scripts/demo-video.ts: records each scene of a plan as JPEG frames, or
// renders a page once to a PNG with alpha (the chapter panels, F16.1).
// electron scripts/record-scenes.cjs <plan.json>
//   plan: { width, height, scenes: [{ url, seconds, warm?, js?, dir, width?, height?, waitVideo? } | { url, png, warm?, width?, height? }] }
//   frames: writes <dir>/00001.jpg… and <dir>/meta.json { frames, seconds, startedAt }  (startedAt = wall clock of frame 1)
//   png:    writes the page with a transparent background to <png>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const plan = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'));
const W = plan.width || 1280;
const H = plan.height || 720;
const FRAME_MS = 100;   // ~10 fps is plenty for UI

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// windows are created and destroyed one per scene: don't quit when the last one closes
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  for (const [i, s] of plan.scenes.entries()) {
    const w = s.width || W;
    const h = s.height || H;
    const png = Boolean(s.png);
    const win = new BrowserWindow({
      width: w, height: h, useContentSize: true, show: false, frame: false,
      ...(png ? { transparent: true } : { backgroundColor: '#0B0C0E' }),
      webPreferences: { backgroundThrottling: false },
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await win.loadURL(s.url); break; } catch (e) { console.log(`scene ${i + 1}: load failed (${e.code || e.message}), retrying`); await sleep(1000); }
    }
    await sleep(s.warm ?? (png ? 400 : 1500));
    if (s.js) {
      try { await win.webContents.executeJavaScript(s.js); } catch (e) { console.log(`scene ${i}: js failed: ${e.message}`); }
      await sleep(800);
    }
    if (png) {
      const img = await win.webContents.capturePage();
      fs.mkdirSync(path.dirname(s.png), { recursive: true });
      fs.writeFileSync(s.png, img.toPNG());
      console.log(`panel ${i + 1}/${plan.scenes.length}: ${path.basename(s.png)}`);
      win.destroy();
      continue;
    }
    if (s.waitVideo) {
      // a <video> in the page: start capturing on its first frame so audio can be muxed from t=0
      try { await win.webContents.executeJavaScript("new Promise((r) => { const v = document.querySelector('video'); if (!v || v.currentTime > 0) r(); else v.addEventListener('playing', () => r(), { once: true }); })"); } catch { /* no video */ }
    }
    fs.mkdirSync(s.dir, { recursive: true });
    let n = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < s.seconds * 1000) {
      const t = Date.now();
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(s.dir, `${String(++n).padStart(5, '0')}.jpg`), img.resize({ width: w, height: h }).toJPEG(88));
      await sleep(Math.max(0, FRAME_MS - (Date.now() - t)));
    }
    const seconds = (Date.now() - t0) / 1000;
    fs.writeFileSync(path.join(s.dir, 'meta.json'), JSON.stringify({ frames: n, seconds, startedAt: t0 }));
    console.log(`scene ${i + 1}/${plan.scenes.length}: ${n} frames in ${seconds.toFixed(1)} s`);
    win.destroy();
  }
  app.quit();
});
