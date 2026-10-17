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

const browser = await chromium.launch({ args: GPU_ARGS });
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

await page.locator('#hydras').scrollIntoViewIfNeeded();
await page.evaluate(() => document.getElementById('hydras').scrollIntoView());
await page.waitForFunction(() => window.__ph.tiles.every(t => t.hydra), null, { timeout: 30000 });
await page.waitForTimeout(3000);
const diffs = [];
for (let i = 0; i < 6; i++) {
  const t = page.locator('.tile').nth(i);
  await t.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  diffs.push(await drawn(page, t.locator('canvas')));
}
const ids = await page.$$eval('.tile', els => els.map(e => e.dataset.sketch));
check('six hydra canvases draw', diffs.every(d => d > 30), ids.map((id, i) => id + ':' + diffs[i]).join(' '));
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

await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(800);
const offscreen = await page.evaluate(async () => {
  const t = window.__ph.tiles[5]; const a = t.hydra.synth.time;
  await new Promise(r => setTimeout(r, 500)); return [t.visible, t.hydra.synth.time === a];
});
check('off-screen tiles do not tick', !offscreen[0] && offscreen[1]);

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
