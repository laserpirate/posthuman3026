// Headless end to end over http (as on Pages) plus a file:// unlock smoke test.
//   PH_PASSWORD=... node e2e.mjs [--shots DIR] [--base https://live.url/]   (--base skips the local server and file://)
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(HERE, '..', 'docs');
const PW = process.env.PH_PASSWORD;
if (!PW) { console.error('set PH_PASSWORD'); process.exit(2); }
const si = process.argv.indexOf('--shots');
const SHOTS = si > -1 ? path.resolve(process.argv[si + 1]) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const GPU_ARGS = ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'];

// fake line-in: 10 s of 55 Hz kicks at 2 per second over a little hiss, looped by Chromium
function fakeBass(file) {
  const rate = 48000, n = rate * 10, data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate, k = t % 0.5;
    const v = Math.sin(2 * Math.PI * 55 * k) * Math.exp(-k * 9) * 0.9 + (Math.random() * 2 - 1) * 0.04;
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return file;
}
const WAV = fakeBass(path.join(HERE, '.cache', 'fake-bass.wav'));
const MEDIA_ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + WAV];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  const p = path.join(DOCS, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  if (!p.startsWith(DOCS) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
const bi = process.argv.indexOf('--base');
const LIVE = bi > -1 ? process.argv[bi + 1] : null;
if (!LIVE) await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = LIVE || `http://127.0.0.1:${server.address().port}/`;
console.log('base:', BASE);

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
const shot = async (target, name) => { if (SHOTS) await target.screenshot({ path: path.join(SHOTS, name + '.png') }); };

// rendered if the element's pixels are not one flat colour
async function drawn(page, locator) {
  const buf = await locator.screenshot();
  return page.evaluate(async b64 => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 16) { const v = d[i] + d[i + 1] + d[i + 2]; if (v < min) min = v; if (v > max) max = v; }
    return max - min;
  }, buf.toString('base64'));
}

const browser = await chromium.launch({ args: [...GPU_ARGS, ...MEDIA_ARGS] });
{
  const p = await browser.newPage();
  console.log('renderer:', await p.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return gl ? (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no webgl';
  }));
  await p.close();
}
const errors = [];
async function newPage(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  return page;
}
async function unlock(page, pw) {
  await page.fill('#pw', pw);
  await page.click('#go');
}

// ---- desktop ----
const page = await newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE);
await shot(page, '1-gate');
await unlock(page, 'not-the-password');
await page.waitForFunction(() => document.getElementById('err')?.textContent.length > 0, null, { timeout: 30000 });
check('wrong password rejected', (await page.textContent('#err')) === 'Wrong password' && !(await page.$('#kodamas')));

await unlock(page, PW);
await page.waitForSelector('#kodamas', { timeout: 30000 });
check('password unlocks', true);
const n = await page.locator('.card').count();
const groupIds = await page.$$eval('.group', els => els.map(e => e.id));
check('12 cards in 2 groups', n === 12 && groupIds.join() === 'g-delta,g-spec', `${n} ${groupIds}`);
check('series filter dropped', !(await page.$('#f-series')));
const rows = await page.evaluate(() => ['delta', 'spec'].map(g => {
  const tops = [...document.querySelectorAll('#g-' + g + ' .card')].map(c => Math.round(c.getBoundingClientRect().top));
  return [...new Set(tops)].map(t => tops.filter(x => x === t).length).join('+');
}));
check('desktop: 3 cards per row', rows.every(r => r === '3+3'), rows.join(' '));
await page.waitForTimeout(1500);
await shot(page, '2-top');

await page.fill('#f-q', 'pk08');
const q = await page.locator('.card:not([hidden])').count();
const shownQ = await page.textContent('#f-n');
const deltaHidden = await page.locator('#g-delta').isHidden();
check('filter works', q === 1 && shownQ === '1 shown' && deltaHidden, `q=pk08:${q} (${shownQ}) delta hidden=${deltaHidden}`);
await page.fill('#f-q', '');

const first = page.locator('.card').first();
await first.locator('[data-act=preview]').click();
await page.waitForSelector('.card.is-live .plate iframe');
await page.waitForTimeout(4000);
const pvDiff = await drawn(page, first.locator('.plate'));
check('preview renders', pvDiff > 60, 'range ' + pvDiff);
await first.scrollIntoViewIfNeeded();
await shot(page, '3-kodamas-preview');
await page.locator('.card').nth(1).locator('[data-act=preview]').click();
await page.waitForTimeout(500);
check('one preview at a time', (await page.locator('.plate iframe').count()) === 1);

await page.locator('.card').nth(2).locator('[data-act=full]').click();
await page.waitForSelector('#fs:not([hidden]) iframe');
await page.waitForTimeout(4000);
const fsDiff = await drawn(page, page.locator('#fs-body'));
check('full screen renders', fsDiff > 60, 'range ' + fsDiff);
check('preview stopped by full screen', (await page.locator('.plate iframe').count()) === 0);
const frame = page.frameLocator('#fs-body iframe');
await frame.locator('body').click({ position: { x: 5, y: 5 }, force: true }).catch(() => {});
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Esc inside scene closes full screen', await page.locator('#fs').isHidden());
await page.locator('.card').nth(2).locator('[data-act=full]').click();
await page.waitForSelector('#fs:not([hidden]) iframe');
const fxDesk = await page.evaluate(() => getComputedStyle(document.getElementById('fx')).display);
await page.click('#fs-close');
await page.waitForTimeout(300);
const closedByBtn = await page.locator('#fs').isHidden();
await page.locator('.card').nth(2).locator('[data-act=full]').click();
await page.waitForSelector('#fs:not([hidden])');
await page.goBack();
await page.waitForTimeout(300);
check('desktop: header close and back close the viewer, floating close hidden',
  closedByBtn && await page.locator('#fs').isHidden() && page.url().startsWith(BASE) && fxDesk === 'none', `fx=${fxDesk}`);

await page.locator('#hydras').scrollIntoViewIfNeeded();
await page.evaluate(() => document.getElementById('hydras').scrollIntoView());
await page.waitForFunction(() => window.__ph.tiles.every(t => t.hydra), null, { timeout: 30000 });
await page.waitForTimeout(3000);
const diffs = [];
const nTiles = await page.locator('.tile').count();
for (let i = 0; i < nTiles; i++) {
  const t = page.locator('.tile').nth(i);
  await t.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  diffs.push(await drawn(page, t.locator('canvas')));
}
const ids = await page.$$eval('.tile', els => els.map(e => e.dataset.sketch));
check('seven hydra canvases draw', nTiles === 7 && diffs.every(d => d > 30), ids.map((id, i) => id + ':' + diffs[i]).join(' '));
await page.evaluate(() => document.getElementById('hydras').scrollIntoView());
await page.waitForTimeout(800);
await shot(page, '4-hydras');

const before = await page.evaluate(() => window.__ph.tiles[0].hydra.synth.time);
await page.locator('.tile').first().locator('[data-act=play]').click();
await page.waitForTimeout(500);
const p1 = await page.evaluate(() => window.__ph.tiles[0].hydra.synth.time);
await page.waitForTimeout(500);
const p2 = await page.evaluate(() => window.__ph.tiles[0].hydra.synth.time);
check('hydra pause stops time', p1 === p2 && p1 > before);
await page.locator('.tile').first().locator('[data-act=code]').click();
check('code overlay shows sketch', (await page.locator('.tile').first().locator('pre').isVisible()));
await page.locator('.tile').nth(1).locator('[data-act=full]').click();
await page.waitForTimeout(400);
await page.locator('.stage.is-full .x').click();
await page.waitForTimeout(400);
check('desktop: hydra full screen close button', !(await page.$('.stage.is-full')));

await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(800);
const offscreen = await page.evaluate(async () => {
  const t = window.__ph.tiles[5]; const a = t.hydra.synth.time;
  await new Promise(r => setTimeout(r, 500)); return [t.visible, t.hydra.synth.time === a];
});
check('off-screen tiles do not tick', !offscreen[0] && offscreen[1]);

// ---- quality ----
console.log('quality profile:', await page.evaluate(() => JSON.stringify({ gpu: window.__ph.q.gpu, ...window.__ph.q.prof })));
await page.evaluate(() => document.getElementById('hydras').scrollIntoView());
await page.waitForTimeout(800);
const runCount = () => page.evaluate(async () => {
  const ts = window.__ph.tiles, a = ts.map(t => t.hydra && t.hydra.synth.time);
  await new Promise(r => setTimeout(r, 600));
  return { ran: ts.filter((t, i) => t.hydra && t.hydra.synth.time !== a[i]).length, visible: ts.filter(t => t.visible).length };
});
await page.selectOption('#h-q', 'low');
await page.waitForTimeout(300);
const lowRun = await runCount();
const lowFps = await page.evaluate(async () => { await new Promise(r => setTimeout(r, 2500)); return window.__ph.q.guard.fps; });
const lowTile = await page.evaluate(() => Math.max(window.__ph.tiles[0].canvas.width, window.__ph.tiles[0].canvas.height));
check('quality low: one tile runs, 30 fps cap, tile <= 480', lowRun.ran === 1 && lowRun.visible >= 3 && lowFps > 25 && lowFps < 32 && lowTile <= 480,
  JSON.stringify({ ...lowRun, fps: +lowFps.toFixed(1), tile: lowTile }));
await page.selectOption('#h-q', 'med');
await page.waitForTimeout(300);
const medRun = await runCount();
check('quality med: up to three tiles run', medRun.ran === Math.min(3, medRun.visible), JSON.stringify(medRun));
await page.locator('.tile').nth(1).locator('[data-act=full]').click();
await page.waitForTimeout(600);
const fsSize = await page.evaluate(() => { const c = window.__ph.tiles[1].canvas; return [c.width, c.height]; });
await page.locator('.stage.is-full .x').click();
await page.waitForTimeout(300);
check('full screen renders at 720p class (long side 1280) at med', fsSize[0] === 1280, fsSize.join('x'));
await page.selectOption('#h-q', 'auto');
await page.waitForTimeout(300);
const autoRun = await runCount();
const autoWant = await page.evaluate(() => Math.min(window.__ph.q.cfg.live, window.__ph.tiles.filter(t => t.visible && t.playing).length));
check('quality auto follows the GPU profile', autoRun.ran === autoWant, JSON.stringify({ ...autoRun, want: autoWant }));
const drop = await page.evaluate(() => {
  let drops = 0;
  const g = window.__ph.makeGuard(() => drops++);
  let t = 1000;
  for (let i = 0; i < 4.5 * 20; i++) g.frame(t += 50);   // 20 fps for 4.5 s: not yet
  const early = drops;
  for (let i = 0; i < 2 * 20; i++) g.frame(t += 50);     // past 5 s: one drop
  const at5 = drops;
  for (let i = 0; i < 3 * 30; i++) g.frame(t += 33.4);   // 30 fps: no more
  return { early, at5, after: drops };
});
check('auto-drop after 5 s under 24 fps', drop.early === 0 && drop.at5 === 1 && drop.after === 1, JSON.stringify(drop));

// ---- audio ----
const t0 = page.locator('.tile').first();
await t0.scrollIntoViewIfNeeded();
if (!(await page.evaluate(() => window.__ph.tiles[0].playing))) await t0.locator('[data-act=play]').click();
await t0.locator('.acts [data-act=audio]').click();
await page.waitForFunction(() => { const t = window.__ph.tiles[0]; return t.fx && t.fx.synth.a.meyda; }, null, { timeout: 15000 });
const inputs = await page.$$eval('#h-in option', os => os.map(o => o.textContent));
check('audio: input picker lists devices after permission', inputs.length >= 1 && await page.locator('#h-in-f').isVisible(), inputs.join(' | '));
const aud = await page.evaluate(async () => {
  const t = window.__ph.tiles[0], fft = [], zoom = [];
  for (let i = 0; i < 30; i++) { await new Promise(r => setTimeout(r, 70)); fft.push(t.fx.synth.a.fft[0]); zoom.push(t.fxv.zoom()); }
  const meter = t.fx.synth.a.canvas, cs = getComputedStyle(meter);
  const g = meter.getContext('2d').getImageData(0, 0, meter.width, meter.height).data;
  let lit = 0; for (let i = 3; i < g.length; i += 4) if (g[i]) lit++;
  return { fftMax: Math.max(...fft), zMin: Math.min(...zoom), zMax: Math.max(...zoom), meter: cs.display !== 'none' && lit > 50,
    raw: (s => ({ ec: s.echoCancellation, ns: s.noiseSuppression, agc: s.autoGainControl }))(t.fx.synth.a.stream.getAudioTracks()[0].getSettings()) };
});
check('audio: fake line-in moves the bass band and the meters', aud.fftMax > 0.05 && aud.meter, JSON.stringify(aud));
check('audio: master FX zoom pumps with the bass', aud.zMax - aud.zMin > 0.01 && aud.zMin >= 1, `zoom ${aud.zMin.toFixed(3)}..${aud.zMax.toFixed(3)}`);
check('audio: voice processing off on the input', aud.raw.ec === false && aud.raw.ns === false && aud.raw.agc === false, JSON.stringify(aud.raw));
const fxDiff = await drawn(page, t0.locator('canvas.fxc'));
check('audio: FX canvas draws the sketch', fxDiff > 30, 'range ' + fxDiff);
await shot(page, '7-hydra-audio');
await page.evaluate(() => { const r = document.querySelector('.tile .ab-s input'); r.value = '0'; r.dispatchEvent(new Event('input')); });
const z0 = await page.evaluate(async () => { const t = window.__ph.tiles[0], z = []; for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 60)); z.push(t.fxv.zoom()); } return z; });
check('audio: react 0 holds the FX still', z0.every(v => v === 1));
check('audio: sketch code unchanged', await page.evaluate(() => window.__ph.tiles[0].pre.textContent === window.__ph.tiles[0].s.code));
await t0.locator('[data-act=full]').click();
await page.waitForTimeout(600);
const fsAudio = await page.evaluate(() => {
  const st = document.querySelector('.stage.is-full'), b = st.querySelector('.ab [data-act=audio]'), r = b.getBoundingClientRect();
  return { btn: getComputedStyle(b).display !== 'none' && r.width > 0, pressed: b.getAttribute('aria-pressed'), meter: !!st.querySelector('.meter') };
});
await shot(page, '8-hydra-full-audio');
await page.locator('.stage.is-full .ab [data-act=audio]').click();
await page.waitForTimeout(300);
const off = await page.evaluate(() => { const t = window.__ph.tiles[0]; return { fx: !!t.fx, meter: !!t.stage.querySelector('.meter'), fxc: !!t.stage.querySelector('.fxc') }; });
await page.locator('.stage.is-full .x').click();
await page.waitForTimeout(300);
check('audio: toggle in full screen, off removes FX and meters', fsAudio.btn && fsAudio.pressed === 'true' && fsAudio.meter && !off.fx && !off.meter && !off.fxc,
  JSON.stringify({ ...fsAudio, ...off }));

// ---- 03 Set ----
await page.evaluate(() => window.scrollTo(0, 0));
await page.click('#nav-set');
await page.waitForFunction(() => window.__ph.set.ready && !document.getElementById('set').hidden, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const SS = () => page.evaluate(() => {
  const s = window.__ph.set;
  return { fader: s.fader, a: s.decks[0].item, b: s.decks[1].item, ta: s.decks[0].hydra.synth.time, tb: s.decks[1].hydra.synth.time,
    cr: document.getElementById('set-cr').textContent, black: !document.getElementById('set-black').hidden };
});
const s1 = await SS();
await page.waitForTimeout(500);
const s2 = await SS();
const outDiff = await drawn(page, page.locator('#set-out canvas'));
check('set: opens, deck A plays, idle deck B paused, output draws, credits on',
  s1.a === 0 && s2.ta > s1.ta && s2.tb === s1.tb && outDiff > 30 && /· CC BY-NC-SA 4\.0$/.test(s1.cr), JSON.stringify({ ...s2, range: outDiff }));
const fpsTxt = await page.textContent('#set-fps');
check('set: fps readout in the controller only', /^fps \d+ · \w+$/.test(fpsTxt) && !(await page.locator('#set-out').innerText()).includes('fps'), fpsTxt);
await shot(page, '9-set');
await page.keyboard.press(' ');
await page.waitForTimeout(1500);
const mid = await page.evaluate(async () => {
  const s = window.__ph.set, a = s.decks.map(d => d.hydra.synth.time);
  await new Promise(r => setTimeout(r, 300));
  return { fader: s.fader, both: s.decks.every((d, i) => d.hydra.synth.time !== a[i]) };
});
await page.keyboard.press('b');
const bl = await SS();
const blTop = await page.evaluate(() => { const e = document.elementFromPoint(innerWidth * 0.75, innerHeight * 0.5); return e && e.id; });
await page.keyboard.press('b');
await page.waitForTimeout(2200);
const s3 = await SS();
check('set: space crossfades over 3 s, both decks tick during it', mid.fader > 0.1 && mid.fader < 0.9 && mid.both && s3.fader === 1 && s3.b === 1,
  JSON.stringify({ mid, after: { fader: s3.fader, b: s3.b } }));
check('set: blackout mid-crossfade covers the output', bl.black && blTop === 'set-black', String(blTop));
await page.keyboard.press('5');
const cued = await SS();
await page.keyboard.press('Shift+Space');
await page.waitForTimeout(200);
const s4 = await SS();
check('set: 5 cues to the other deck, shift+space cuts', cued.a === 4 && cued.fader === 1 && s4.fader === 0, JSON.stringify({ cuedA: cued.a, fader: s4.fader }));
await page.evaluate(() => { for (const r of document.querySelectorAll('#set-pl input[type=number]')) { r.value = '2'; r.dispatchEvent(new Event('change')); } });
await page.waitForTimeout(5600);
const s5 = await SS();
await page.evaluate(() => { for (const r of document.querySelectorAll('#set-pl input[type=number]')) { r.value = '60'; r.dispatchEvent(new Event('change')); } });
check('set: auto-advance by timer', s5.fader === 1 && s5.b === 5, JSON.stringify({ fader: s5.fader, b: s5.b }));
await page.keyboard.press('h');
await page.keyboard.press('b');
const hb = await page.evaluate(() => [document.getElementById('set-ui').hidden, !document.getElementById('set-black').hidden]);
await page.keyboard.press('b');
await page.keyboard.press('h');
await page.keyboard.press('?');
const help = await page.locator('#set-help').isVisible();
await shot(page, '10-set-help');
await page.keyboard.press('b');
const hb2 = !(await page.locator('#set-black').isHidden());
await page.keyboard.press('b');
await page.keyboard.press('?');
check('set: H hides controls, ? shows the key card, blackout works in both', hb[0] && hb[1] && help && hb2, JSON.stringify({ hb, help, hb2 }));
await page.keyboard.press('a');
await page.waitForFunction(() => { const c = window.__ph.set.comp; return c.synth.a && c.synth.a.meyda; }, null, { timeout: 15000 });
const sa = await page.evaluate(async () => {
  const s = window.__ph.set, z = [];
  for (let i = 0; i < 30; i++) { await new Promise(r => setTimeout(r, 70)); z.push(s.fxv.zoom()); }
  return { zMin: Math.min(...z), zMax: Math.max(...z), meterInUi: !!document.querySelector('#set-ui .set-meter'), meterOnOutput: !!document.querySelector('#set-out canvas:not(.set-c)'),
    inputs: document.querySelectorAll('#set-in option').length };
});
await shot(page, '11-set-audio');
await page.keyboard.press('a');
check('set: A audio with fake mic pumps the master FX, meter in the controller', sa.zMax - sa.zMin > 0.01 && sa.meterInUi && !sa.meterOnOutput && sa.inputs >= 1, JSON.stringify(sa));
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
const closed = await page.evaluate(() => document.getElementById('set').hidden && !window.__ph.set.open && !document.fullscreenElement);
check('set: Esc exits', closed);

// ---- mobile ----
const m = await newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await m.goto(BASE);
await unlock(m, PW);
await m.waitForSelector('#kodamas', { timeout: 30000 });
await m.waitForTimeout(1500);
const overflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('mobile overflow 0', overflow === 0, String(overflow));
await shot(m, '5-mobile');
await m.evaluate(() => document.getElementById('hydras').scrollIntoView());
await m.waitForTimeout(1500);
const overflow2 = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('mobile overflow 0 at hydras', overflow2 === 0, String(overflow2));
await shot(m, '6-mobile-hydras');

// ---- reduced motion: hydras start paused ----
const r = await newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
await r.goto(BASE);
await unlock(r, PW);
await r.waitForSelector('#hydras');
await r.evaluate(() => document.getElementById('hydras').scrollIntoView());
await r.waitForFunction(() => window.__ph.tiles[0].hydra, null, { timeout: 30000 });
await r.waitForTimeout(600);
check('reduced motion: hydras start paused', await r.evaluate(() => window.__ph.tiles.every(t => !t.playing)));

// ---- session key: reload skips the gate ----
await r.reload();
await r.waitForSelector('#kodamas', { timeout: 30000 });
check('session key remembered on reload', true);

// ---- file:// ----
if (!LIVE) {
  const f = await newPage({ viewport: { width: 1280, height: 800 } });
  await f.goto(pathToFileURL(path.join(DOCS, 'index.html')).href);
  await unlock(f, PW);
  await f.waitForSelector('#kodamas', { timeout: 30000 });
  check('file:// unlocks', (await f.locator('.card').count()) === 12);
}

check('zero page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
if (!LIVE) server.close();
const failed = results.filter(x => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
