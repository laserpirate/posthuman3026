// Writes a self-contained hydra benchmark page for the show laptops (no network, no install).
//   node bench.mjs   -> .cache/hydra-bench.html
// Copy it to the laptop, open it in Chrome (and Safari on the Mac), press run, paste the JSON back.
// It holds the sketch code in plaintext: keep it out of docs/ and do not publish it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const hydra = fs.readFileSync(path.join(HERE, 'node_modules', 'hydra-synth', 'dist', 'hydra-synth.js'), 'utf8');
const sketches = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'hydra-sketches.json'), 'utf8')).sketches
  .map(s => ({ id: s.id, code: s.code }));
const json = v => JSON.stringify(v).replace(/</g, '\\u003c');

const html = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width"><meta name=robots content="noindex,nofollow">
<title>hydra bench</title>
<style>body{margin:0;background:#000;color:#ddd;font:13px ui-monospace,monospace}#ui{padding:12px}#stage{display:flex;flex-wrap:wrap}
#stage canvas{width:320px;height:180px}button{border-radius:0;padding:8px 14px;font:inherit}
table{border-collapse:collapse;margin-top:8px}td,th{border:1px solid #444;padding:3px 8px;text-align:right}</style>
<div id=ui><button id=go>run (about 90 s, keep this window in front, plugged in)</button> <button id=copy>copy JSON</button>
<p id=info></p><table id=t></table></div><div id=stage></div>
<script>/* hydra-synth, Olivia Jack, AGPL-3.0 */
${hydra.replace(/<\/script/gi, '<\\/script')}</script>
<script>
// sketches: their credited artists, CC BY-NC-SA 4.0
const SK = ${json(sketches)};
const SIZES = { '540p': [960, 540], '720p': [1280, 720], '1080p': [1920, 1080] };

// decks tick; comp adds a compositor that pulls the deck canvases in, as on the set page
async function run({ decks, comp, w, h, cap, secs }) {
  stage.textContent = '';
  const mk = () => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; stage.append(c);
    return new Hydra({ canvas: c, width: w, height: h, autoLoop: false, makeGlobal: false, detectAudio: false, enableStreamCapture: false });
  };
  const inst = decks.map(i => { const hy = mk(); hy.hush(); new Function('h', 'with(h){' + SK[i].code + '\\n}')(hy.synth); return hy; });
  if (comp) {
    const c = mk(), s = c.synth;
    s.s0.init({ src: inst[0].canvas }); s.s1.init({ src: (inst[1] || inst[0]).canvas });
    s.src(s.s0).blend(s.src(s.s1), () => 0.5 + 0.5 * Math.sin(s.time)).scale(() => 1 + 0.05 * Math.sin(s.time * 8))
      .brightness(() => 0.1 * Math.sin(s.time * 4)).kaleid(4).out(s.o0);
    inst.push(c);
  }
  const gl = inst[0].regl._gl, ext = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const ticks = []; let acc = 0, last = performance.now(); const t0 = last;
  await new Promise(done => {
    function loop(now) {
      acc += now - last; last = now;
      if (acc >= 1000 / cap - 1) { for (const hy of inst) hy.tick(acc); gl.finish(); ticks.push(now); acc = 0; }
      if (now - t0 < secs * 1000) requestAnimationFrame(loop); else done();
    }
    requestAnimationFrame(loop);
  });
  const warm = ticks.filter(t => t - t0 > 1000);
  const fps = warm.length > 1 ? (warm.length - 1) * 1000 / (warm.at(-1) - warm[0]) : 0;
  return { renderer, fps: +fps.toFixed(1) };
}

const out = { ua: navigator.userAgent, dpr: devicePixelRatio, cores: navigator.hardwareConcurrency, rows: [] };
go.onclick = async () => {
  go.disabled = true;
  t.innerHTML = '<tr><th>size<th>cap<th>1 canvas<th>2 (deck + comp)<th>3 (crossfade)';
  const heavy = ['nesso_0', 'ritchse_1'].map(id => SK.findIndex(s => s.id === id));
  for (const [size, [w, h]] of Object.entries(SIZES)) for (const cap of [30, 60]) {
    const row = { size, cap };
    for (const [k, cfg] of [['one', { decks: [heavy[0]] }], ['two', { decks: [heavy[0]], comp: true }], ['three', { decks: heavy, comp: true }]]) {
      const r = await run({ ...cfg, w, h, cap, secs: 4 });
      row[k] = r.fps; out.renderer = r.renderer; info.textContent = r.renderer;
    }
    out.rows.push(row);
    t.insertAdjacentHTML('beforeend', '<tr><td>' + size + '<td>' + cap + '<td>' + row.one + '<td>' + row.two + '<td>' + row.three);
  }
  stage.textContent = ''; go.disabled = false; go.textContent = 'done, run again';
};
copy.onclick = () => navigator.clipboard.writeText(JSON.stringify(out, null, 1)).then(() => { copy.textContent = 'copied'; });
</script>
`;
fs.mkdirSync(path.join(HERE, '.cache'), { recursive: true });
fs.writeFileSync(path.join(HERE, '.cache', 'hydra-bench.html'), html);
console.log('bench: .cache/hydra-bench.html (' + Math.round(html.length / 1024) + ' KB). Keep it out of docs/.');
