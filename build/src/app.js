// Runs after unlock. The gate passes { data, decrypt, decryptText }.
// eslint-disable-next-line no-unused-vars
function main(PH) {
  'use strict';
  const D = PH.data;
  const $ = (sel, el = document) => el.querySelector(sel);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids) if (c != null) el.append(c);
    return el;
  }

  // ---- scenes: decrypted html is cached, each view gets its own blob url --------------------

  const sceneText = new Map();
  function sceneUrl(card) {
    const p = sceneText.has(card.scene) ? Promise.resolve(sceneText.get(card.scene))
      : PH.decryptText(card.scene).then(t => { sceneText.set(card.scene, t); return t; });
    return p.then(t => URL.createObjectURL(new Blob([t], { type: 'text/html' })));
  }

  function sceneFrame(url, title) {
    const f = h('iframe', { src: url, title, allow: 'fullscreen; autoplay', loading: 'eager' });
    f.addEventListener('load', () => {
      // blob: frames are same origin, so Esc can be caught inside the scene
      try { f.contentWindow.addEventListener('keydown', onKey); } catch (e) { /* ignore */ }
    });
    return f;
  }

  // ---- kodama cards ---------------------------------------------------------------------------

  const series = [...new Set(D.cards.map(c => c.series))].sort();
  const sel = $('#f-series');
  // a single series is no filter at all
  if (series.length < 2) sel.closest('label').remove();
  else for (const s of series) sel.append(h('option', { value: s, text: s }));

  const chips = $('#chips');
  const groupsEl = $('#groups');
  const cardEls = [];
  const groupEls = [];

  for (const g of D.groups) {
    chips.append(h('a', { class: 'btn', href: '#g-' + g.id }, g.title + ' ', h('i', { text: String(g.count) })));
    const grid = h('div', { class: 'grid' });
    const count = h('i', { text: String(g.count) });
    const sec = h('div', { class: 'group', id: 'g-' + g.id }, h('h3', { class: 'group-h' }, g.title, count), grid);
    groupEls.push({ el: sec, id: g.id, count, total: g.count });
    groupsEl.append(sec);
    for (const c of D.cards.filter(x => x.group === g.id)) {
      const img = h('img', { alt: '', decoding: 'async' });
      const plate = h('div', { class: 'plate' }, img);
      const pv = h('button', { class: 'btn', type: 'button', 'data-act': 'preview', 'aria-pressed': 'false', text: 'Preview' });
      const fsb = h('button', { class: 'btn', type: 'button', 'data-act': 'full', text: 'Full screen' });
      const el = h('article', { class: 'card', 'data-kid': c.kid },
        plate,
        h('div', { class: 'card-b' },
          h('div', { class: 'card-t' }, h('span', { class: 'kid', text: c.kid }), h('h4', { text: c.title })),
          c.desc ? h('p', { class: 'desc', text: c.desc }) : null,
          c.sci ? h('p', { class: 'sci', text: c.sci }) : null,
          c.tide ? h('p', { class: 'tide', text: c.tide }) : null,
          h('div', { class: 'acts' }, pv, fsb)));
      const rec = { c, el, plate, img, pv, group: g.id, hay: [c.kid, c.title, c.desc, c.sci, c.tide, c.series].join(' ').toLowerCase() };
      pv.addEventListener('click', () => (live === rec ? stopPreview() : startPreview(rec)));
      fsb.addEventListener('click', () => openFull(rec.c));
      cardEls.push(rec);
      grid.append(el);
    }
  }

  // stills decrypt as they approach the viewport
  const stillIO = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      stillIO.unobserve(e.target);
      const rec = cardEls.find(r => r.plate === e.target);
      PH.decrypt(rec.c.still).then(u => {
        rec.img.src = URL.createObjectURL(new Blob([u], { type: 'image/jpeg' }));
        rec.img.onload = () => rec.img.classList.add('on');
      }).catch(err => console.error(err));
    }
  }, { rootMargin: '800px 0px' });
  for (const r of cardEls) stillIO.observe(r.plate);

  // filters
  const q = $('#f-q'), shown = $('#f-n'), empty = $('#f-empty');
  function applyFilter() {
    const s = sel.isConnected ? sel.value : '', words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let n = 0;
    const per = {};
    for (const r of cardEls) {
      const ok = (!s || r.c.series === s) && words.every(w => r.hay.includes(w));
      r.el.hidden = !ok;
      if (ok) { n++; per[r.group] = (per[r.group] || 0) + 1; }
      if (!ok && live === r) stopPreview();
    }
    for (const g of groupEls) {
      const k = per[g.id] || 0;
      g.el.hidden = k === 0;
      g.count.textContent = k === g.total ? String(g.total) : k + ' / ' + g.total;
    }
    for (const a of chips.children) a.hidden = !per[a.getAttribute('href').slice(3)];
    shown.textContent = n + ' shown';
    empty.hidden = n > 0;
  }
  if (sel.isConnected) sel.addEventListener('change', applyFilter);
  q.addEventListener('input', applyFilter);
  applyFilter();

  // one live preview at a time (WebGL context budget)
  let live = null, liveUrl = null, liveTok = 0;
  const plateRO = new ResizeObserver(entries => {
    for (const e of entries) e.target.style.setProperty('--s', String(e.contentRect.width / 1280));
  });
  for (const r of cardEls) plateRO.observe(r.plate);
  function stopPreview() {
    if (!live) return;
    live.plate.querySelectorAll('iframe,.live').forEach(n => n.remove());
    live.el.classList.remove('is-live');
    live.pv.setAttribute('aria-pressed', 'false');
    live.pv.textContent = 'Preview';
    if (liveUrl) URL.revokeObjectURL(liveUrl);
    live = null; liveUrl = null; liveTok++;
  }
  function startPreview(rec) {
    stopPreview();
    live = rec;
    const tok = ++liveTok;
    rec.el.classList.add('is-live');
    rec.pv.setAttribute('aria-pressed', 'true');
    rec.pv.textContent = 'Stop';
    sceneUrl(rec.c).then(url => {
      if (tok !== liveTok) { URL.revokeObjectURL(url); return; }
      liveUrl = url;
      rec.plate.append(sceneFrame(url, rec.c.kid + ' preview'), h('span', { class: 'live', text: 'LIVE' }));
    }).catch(err => { console.error(err); stopPreview(); });
  }

  // ---- full screen overlay (kodama scenes) ----------------------------------------------------

  const fs = $('#fs'), fsBody = $('#fs-body'), fsTitle = $('#fs-title');
  let fsUrl = null, fsTok = 0;
  function openFull(card) {
    stopPreview();
    const tok = ++fsTok;
    fsTitle.textContent = card.kid + '  ' + card.title;
    fs.hidden = false;
    document.body.classList.add('fs-open');
    $('#fs-close').focus();
    sceneUrl(card).then(url => {
      if (tok !== fsTok) { URL.revokeObjectURL(url); return; }
      fsUrl = url;
      const f = sceneFrame(url, card.kid);
      fsBody.append(f);
      f.addEventListener('load', () => f.focus());
    }).catch(err => { console.error(err); closeFull(); });
  }
  function closeFull() {
    fsTok++;
    fsBody.textContent = '';
    if (fsUrl) URL.revokeObjectURL(fsUrl);
    fsUrl = null;
    fs.hidden = true;
    document.body.classList.remove('fs-open');
  }
  $('#fs-close').addEventListener('click', closeFull);

  function onKey(e) {
    if (e.key !== 'Escape') return;
    if (!fs.hidden) { e.preventDefault(); closeFull(); return; }
    const full = tiles.find(t => t.full);
    if (full) { e.preventDefault(); setFull(full, false); }
  }
  document.addEventListener('keydown', onKey);

  // ---- hydras ---------------------------------------------------------------------------------

  const tilesEl = $('#tiles');
  const tiles = D.hydras.map(s => {
    const canvas = h('canvas', { 'aria-label': s.title + ' by ' + s.artist });
    const pre = h('pre', { hidden: true, text: s.code });
    const x = h('button', { class: 'btn btn-sig x', type: 'button', text: 'Close' });
    const stage = h('div', { class: 'stage' }, canvas, pre, x);
    const play = h('button', { class: 'btn', type: 'button', 'data-act': 'play' });
    const code = h('button', { class: 'btn', type: 'button', 'data-act': 'code', 'aria-pressed': 'false', text: 'Code' });
    const full = h('button', { class: 'btn', type: 'button', 'data-act': 'full', text: 'Full screen' });
    const orig = h('a', { class: 'btn', href: s.url, target: '_blank', rel: 'noopener noreferrer', text: 'Original' });
    const by = h('p', { class: 'by' }, 'by ', s.link
      ? h('a', { href: s.link, target: '_blank', rel: 'noopener noreferrer', text: s.artist }) : s.artist);
    const el = h('article', { class: 'tile', 'data-sketch': s.id }, stage,
      h('div', { class: 'tile-b' }, h('h4', { text: s.title }), by, h('div', { class: 'acts' }, play, code, full, orig)));
    tilesEl.append(el);
    const t = { s, el, stage, canvas, pre, play, hydra: null, visible: false, playing: !reduceMotion, full: false };
    play.addEventListener('click', () => { t.playing = !t.playing; syncPlay(t); });
    code.addEventListener('click', () => { pre.hidden = !pre.hidden; code.setAttribute('aria-pressed', String(!pre.hidden)); });
    full.addEventListener('click', () => setFull(t, true));
    x.addEventListener('click', () => setFull(t, false));
    syncPlay(t);
    return t;
  });

  function syncPlay(t) {
    t.play.textContent = t.playing ? 'Pause' : 'Play';
    t.play.setAttribute('aria-pressed', String(!t.playing));
  }

  function sizeOf(t) {
    const r = t.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    return [Math.max(2, Math.round(r.width * dpr)), Math.max(2, Math.round(r.height * dpr))];
  }

  function startHydra(t) {
    const [w, hgt] = sizeOf(t);
    t.canvas.width = w; t.canvas.height = hgt;
    t.hydra = new window.Hydra({
      canvas: t.canvas, width: w, height: hgt, autoLoop: false, makeGlobal: false,
      detectAudio: false, enableStreamCapture: false,
    });
    t.hydra.hush();
    t.hydra.synth.time = 0;
    // sketches run against this instance only; `with` keeps `time` live per instance
    new Function('h', 'with(h){' + t.s.code + '\n}')(t.hydra.synth);
    t.hydra.tick(16); // one frame so a paused tile is not blank
  }

  function resizeHydra(t) {
    if (!t.hydra) return;
    const [w, hgt] = sizeOf(t);
    t.hydra.setResolution(w, hgt);
    if (!t.playing) t.hydra.tick(0);
  }

  function setFull(t, on) {
    t.full = on;
    t.stage.classList.toggle('is-full', on);
    document.body.classList.toggle('fs-open', on);
    if (on && t.stage.requestFullscreen) t.stage.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    requestAnimationFrame(() => resizeHydra(t));
  }
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) for (const t of tiles) if (t.full) setFull(t, false);
  });
  window.addEventListener('resize', () => { for (const t of tiles) if (t.hydra) resizeHydra(t); });

  let hydraLib = null;
  function loadHydraLib() {
    return hydraLib || (hydraLib = new Promise((res, rej) => {
      const s = h('script', { src: 'vendor/hydra-synth/hydra-synth.js' });
      s.onload = () => res(); s.onerror = rej;
      document.head.append(s);
    }));
  }

  // only tiles on screen tick
  const tileIO = new IntersectionObserver(entries => {
    for (const e of entries) {
      const t = tiles.find(x => x.el === e.target);
      t.visible = e.isIntersecting;
      if (t.visible && !t.hydra) loadHydraLib().then(() => { if (!t.hydra) startHydra(t); }).catch(err => console.error(err));
    }
  }, { rootMargin: '100px 0px' });
  for (const t of tiles) tileIO.observe(t.el);

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(100, now - last);
    last = now;
    for (const t of tiles) if (t.hydra && t.playing && (t.visible || t.full)) t.hydra.tick(dt);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  window.__ph = { cards: cardEls.length, tiles };
}
