// Phone responsive checks at 360 / 390 / 430 portrait and 390 landscape, touch emulation.
//   PH_PASSWORD=... node phone.mjs [--shots DIR] [--base https://live.url/]   (default: serves ../docs locally)
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(HERE, '..', 'docs');
const PW = process.env.PH_PASSWORD;
if (!PW) { console.error('set PH_PASSWORD'); process.exit(2); }
const arg = n => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : null; };
const SHOTS = arg('shots') && path.resolve(arg('shots'));
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const LIVE = arg('base');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  const p = path.join(DOCS, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  if (!p.startsWith(DOCS) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
if (!LIVE) await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = LIVE || `http://127.0.0.1:${server.address().port}/`;
console.log('base:', BASE);

const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

// anything sticking out sideways, plus the document scroll widths
const overflow = page => page.evaluate(() => {
  const W = innerWidth, bad = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.plate,.stage,#fs-body,pre')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.right > W + 0.5 || r.left < -0.5) bad.push(`${el.tagName.toLowerCase()}.${el.className}[${Math.round(r.left)},${Math.round(r.right)}]`);
  }
  const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  return { ok: sw === W && !bad.length, sw, W, bad: bad.slice(0, 4) };
});

// visible tap targets shorter than 40px
const smallTargets = page => page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll('button,.btn,.sections a,input,select')) {
    const r = el.getBoundingClientRect();
    if (!r.width || el.closest('[hidden]')) continue;
    if (getComputedStyle(el).display === 'none') continue;
    if (r.height < 40) bad.push(`${el.textContent.trim().slice(0, 14) || el.id}:${Math.round(r.height)}`);
  }
  return bad;
});

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

const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const errors = [];
const SIZES = [[360, 740], [390, 844], [430, 932], [844, 390]];

for (const [w, hgt] of SIZES) {
  const tag = `${w}x${hgt}`;
  const full = w === 390;
  const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(tag + ' ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(tag + ' console: ' + m.text()); });
  const shot = async (name, target = page) => { if (SHOTS && full) await target.screenshot({ path: path.join(SHOTS, name + '.png') }); };

  // gate
  await page.goto(BASE);
  await page.waitForTimeout(400);
  const gate = await page.evaluate(() => {
    const f = document.getElementById('gate-form').getBoundingClientRect();
    const i = document.getElementById('pw').getBoundingClientRect(), b = document.getElementById('go').getBoundingClientRect();
    return { l: f.left, r: innerWidth - f.right, row: Math.abs(i.top - b.top) < 1, fs: getComputedStyle(document.getElementById('pw')).fontSize };
  });
  let o = await overflow(page);
  check(`${tag} gate fits`, gate.l >= 16 && gate.r >= 16 && gate.row && gate.fs === '16px' && o.ok, JSON.stringify({ ...gate, sw: o.sw, bad: o.bad }));
  const gt = await smallTargets(page);
  check(`${tag} gate tap targets >= 40px`, !gt.length, gt.join(' '));
  await shot('p1-gate');

  await page.fill('#pw', PW);
  await page.tap('#go');
  await page.waitForSelector('#kodamas', { timeout: 30000 });
  await page.waitForTimeout(1200);

  // top bar on one line, no overlap
  const top = await page.evaluate(() => {
    const items = [document.querySelector('.brand'), ...document.querySelectorAll('.sections a')].map(e => e.getBoundingClientRect());
    const oneLine = items.every(r => Math.abs(r.top + r.height / 2 - (items[0].top + items[0].height / 2)) < 4);
    const overlap = items.some((r, i) => i && r.left < items[i - 1].right);
    return { oneLine, overlap, labels: [...document.querySelectorAll('.sections a')].map(a => a.innerText.replace(/\s+/g, ' ')) };
  });
  check(`${tag} top bar one line`, top.oneLine && !top.overlap, top.labels.join(' | '));
  await shot('p2-top');

  const cols = await page.evaluate(() => new Set([...document.querySelectorAll('#g-delta .card')].map(c => Math.round(c.getBoundingClientRect().left))).size);
  const want = w <= 600 ? 1 : 2;
  check(`${tag} kodama columns = ${want}`, cols === want, String(cols));
  const searchFull = await page.evaluate(() => {
    const r = document.getElementById('f-q').getBoundingClientRect(), wr = document.querySelector('#kodamas').getBoundingClientRect();
    return Math.round(wr.width - r.width);
  });
  if (w <= 600) check(`${tag} search full width`, searchFull <= 1, 'gap ' + searchFull);
  o = await overflow(page);
  check(`${tag} no horizontal scroll (kodamas)`, o.ok, JSON.stringify(o));
  const kt = await smallTargets(page);
  check(`${tag} tap targets >= 40px`, !kt.length, kt.slice(0, 8).join(' '));

  // preview in card
  const card = page.locator('.card').first();
  await card.scrollIntoViewIfNeeded();
  await card.locator('[data-act=preview]').tap();
  await page.waitForSelector('.card.is-live .plate iframe');
  await page.waitForTimeout(3500);
  const pv = await drawn(page, card.locator('.plate'));
  await page.locator('.card').nth(1).locator('[data-act=preview]').tap();
  await page.waitForTimeout(400);
  const nFrames = await page.locator('.plate iframe').count();
  check(`${tag} preview renders, one at a time`, pv > 60 && nFrames === 1, `range ${pv}, frames ${nFrames}`);
  await page.locator('.card').nth(1).scrollIntoViewIfNeeded();
  await shot('p3-kodamas', page);
  await page.locator('.card').nth(1).locator('[data-act=preview]').tap();

  // kodama full screen viewer with the floating close
  const fxState = () => page.evaluate(() => {
    const fx = document.getElementById('fx'), r = fx.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const body = document.getElementById('fs-body').getBoundingClientRect();
    const hidden = el => !el || getComputedStyle(el).display === 'none';
    return { w: Math.round(r.width), h: Math.round(r.height), inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      onTop: !!hit && !!hit.closest('#fx'), clearOfScene: document.getElementById('fs').hidden || r.bottom <= body.top,
      oldHidden: hidden(document.getElementById('fs-close')) && hidden(document.querySelector('.stage.is-full .x')) };
  });
  const fxOk = x => x.w >= 44 && x.h >= 44 && x.inView && x.onTop && x.clearOfScene && x.oldHidden;
  const kFull = page.locator('.card').nth(4).locator('[data-act=full]');
  await kFull.scrollIntoViewIfNeeded();
  const y0 = await page.evaluate(() => scrollY);
  await kFull.tap();
  await page.waitForSelector('#fs:not([hidden]) iframe');
  await page.waitForTimeout(3500);
  const fsv = await page.evaluate(() => {
    const b = document.getElementById('fs-body').getBoundingClientRect(), bar = document.querySelector('.fs-bar').getBoundingClientRect();
    const t = document.getElementById('fs-title');
    return { fill: Math.round(bar.height + b.height) === innerHeight, truncates: t.scrollWidth <= t.clientWidth || getComputedStyle(t).textOverflow === 'ellipsis' };
  });
  const fsd = await drawn(page, page.locator('#fs-body'));
  const kfx = await fxState();
  check(`${tag} kodama viewer: floating close`, fxOk(kfx) && fsv.fill && fsv.truncates && fsd > 60, JSON.stringify({ ...kfx, ...fsv, range: fsd }));
  await shot('p5-fullscreen');
  await page.tap('#fx');
  await page.waitForTimeout(400);
  const kClosed = await page.evaluate(y0 => ({ hidden: document.getElementById('fs').hidden, focus: document.activeElement.dataset.act === 'full'
    && document.activeElement.closest('.card') === document.querySelectorAll('.card')[4], scroll: Math.abs(scrollY - y0) <= 2,
    state: history.state === null || !history.state.phViewer, len: history.length }), y0);
  check(`${tag} kodama viewer: tap closes, focus + scroll restored`, kClosed.hidden && kClosed.focus && kClosed.scroll && kClosed.state, JSON.stringify(kClosed));
  await kFull.tap();
  await page.waitForSelector('#fs:not([hidden])');
  await page.waitForTimeout(800);
  await page.goBack();
  await page.waitForTimeout(400);
  const kBack = await page.evaluate(() => ({ hidden: document.getElementById('fs').hidden, len: history.length, onSite: !!document.getElementById('kodamas') }));
  check(`${tag} kodama viewer: back closes, stays on site, no history pile-up`,
    kBack.hidden && kBack.onSite && page.url().startsWith(BASE) && kBack.len === kClosed.len, JSON.stringify({ ...kBack, before: kClosed.len, url: page.url() }));

  // hydras
  await page.evaluate(() => document.getElementById('hydras').scrollIntoView());
  await page.waitForFunction(() => window.__ph.tiles.some(t => t.hydra), null, { timeout: 30000 });
  const sizes = [], diffs = [];
  for (let i = 0; i < 6; i++) {
    const t = page.locator('.tile').nth(i);
    await t.scrollIntoViewIfNeeded();
    await page.waitForFunction(i => window.__ph.tiles[i].hydra, i, { timeout: 30000 });
    await page.waitForTimeout(700);
    diffs.push(await drawn(page, t.locator('canvas')));
    sizes.push(await page.evaluate(i => { const c = window.__ph.tiles[i].canvas; return c.width + 'x' + c.height; }, i));
  }
  const capped = sizes.every(s => s.split('x').every(n => Number(n) <= 480));
  check(`${tag} hydras draw, canvas <= 480`, diffs.every(d => d > 30) && capped, sizes.map((s, i) => s + ':' + diffs[i]).join(' '));
  const tick = await page.evaluate(async () => {
    const before = window.__ph.tiles.map(t => t.hydra && t.hydra.synth.time);
    await new Promise(r => setTimeout(r, 400));
    return window.__ph.tiles.map((t, i) => {
      const r = t.el.getBoundingClientRect();
      const onScreen = r.bottom > -100 && r.top < innerHeight + 100;
      const ran = !!t.hydra && t.hydra.synth.time !== before[i];
      return { onScreen, ran };
    });
  });
  check(`${tag} only on-screen tiles run`, tick.every(x => x.onScreen === x.ran || (!x.onScreen && !x.ran)) && tick.every(x => !x.ran || x.onScreen),
    tick.map(x => (x.onScreen ? 'on' : 'off') + '/' + (x.ran ? 'run' : 'idle')).join(' '));
  await page.evaluate(() => document.getElementById('hydras').scrollIntoView());
  await page.waitForTimeout(600);
  o = await overflow(page);
  check(`${tag} no horizontal scroll (hydras)`, o.ok, JSON.stringify(o));
  await shot('p4-hydras');

  // hydra full screen with the code panel open
  const t0 = page.locator('.tile').first(), hFull = t0.locator('[data-act=full]');
  await hFull.scrollIntoViewIfNeeded();
  const hy0 = await page.evaluate(() => scrollY);
  await hFull.tap();
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__ph.tiles[0].pre.hidden = false; });
  await page.waitForTimeout(300);
  const hfx = await fxState();
  const hf = await page.evaluate(async () => {
    const st = document.querySelector('.stage.is-full'), r = st.getBoundingClientRect();
    const others = window.__ph.tiles.slice(1).filter(t => t.hydra), t0 = window.__ph.tiles[0];
    const a = others.map(t => t.hydra.synth.time), a0 = t0.hydra.synth.time;
    await new Promise(res => setTimeout(res, 400));
    return { fill: Math.round(r.height) === innerHeight && Math.round(r.width) === innerWidth, fullRuns: t0.hydra.synth.time !== a0,
      gridPaused: others.every((t, i) => t.hydra.synth.time === a[i]), canvas: st.querySelector('canvas').width + 'x' + st.querySelector('canvas').height };
  });
  check(`${tag} hydra full + code panel: floating close on top`, fxOk(hfx) && hf.fill && hf.fullRuns && hf.gridPaused, JSON.stringify({ ...hfx, ...hf }));
  await shot('p6-hydra-full');
  await page.tap('#fx');
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__ph.tiles[0].pre.hidden = true; });
  const hClosed = await page.evaluate(y0 => ({ closed: !document.querySelector('.stage.is-full'), focus: document.activeElement.dataset.act === 'full'
    && document.activeElement.closest('.tile') === document.querySelector('.tile'), scroll: Math.abs(scrollY - y0) <= 2,
    resumed: (() => { const t = window.__ph.tiles[0]; return t.visible; })() }), hy0);
  const resumed = await page.evaluate(async () => { const t = window.__ph.tiles[0], a = t.hydra.synth.time; await new Promise(r => setTimeout(r, 300)); return t.hydra.synth.time !== a; });
  check(`${tag} hydra full: tap closes, focus + scroll restored, tiles resume`, hClosed.closed && hClosed.focus && hClosed.scroll && resumed, JSON.stringify({ ...hClosed, resumed }));
  await hFull.tap();
  await page.waitForTimeout(500);
  await page.goBack();
  await page.waitForTimeout(400);
  const hBack = await page.evaluate(() => ({ closed: !document.querySelector('.stage.is-full'), onSite: !!document.getElementById('hydras') }));
  check(`${tag} hydra full: back closes, stays on site`, hBack.closed && hBack.onSite && page.url().startsWith(BASE), JSON.stringify(hBack));
  o = await overflow(page);
  check(`${tag} no horizontal scroll after viewers`, o.ok, JSON.stringify(o));
  // a second back leaves the site normally
  await page.goBack();
  await page.waitForTimeout(500);
  check(`${tag} second back leaves the site`, !page.url().startsWith(BASE), page.url());
  await ctx.close();
}

check('zero page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
if (!LIVE) server.close();
const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
