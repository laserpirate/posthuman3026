// Still plate per scene: load each prepared scene, let it run, save a jpeg.
//   node capture.mjs [kid ...]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENES = path.join(HERE, '.cache', 'scenes');
const OUT = path.join(HERE, '.cache', 'stills');
const SETTLE_MS = Number(process.env.SETTLE_MS || 4000);
export const GPU_ARGS = ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader'];

const only = process.argv.slice(2);
const kids = fs.readdirSync(SCENES).map(f => f.replace(/\.html$/, '')).filter(k => !only.length || only.includes(k));
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: GPU_ARGS });
const ctx = await browser.newContext({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 });
const probe = await ctx.newPage();
const renderer = await probe.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl');
  const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return gl ? (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no webgl';
});
console.log('renderer:', renderer);
await probe.close();

const problems = [];
for (const kid of kids) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(pathToFileURL(path.join(SCENES, kid + '.html')).href, { waitUntil: 'load' });
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: path.join(OUT, kid + '.jpg'), type: 'jpeg', quality: 72 });
  const kb = Math.round(fs.statSync(path.join(OUT, kid + '.jpg')).size / 1024);
  console.log(kid.padEnd(5), String(kb).padStart(4) + 'KB', errs.length ? 'ERR ' + errs[0] : '');
  if (errs.length || kb < 12) problems.push(kid);
  await page.close();
}
await browser.close();
console.log(problems.length ? 'check: ' + problems.join(' ') : 'all stills ok');
