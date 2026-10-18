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
      fsb.addEventListener('click', () => openFull(rec.c, fsb));
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
  function openFull(card, opener) {
    stopPreview();
    const tok = ++fsTok;
    fsTitle.textContent = card.kid + '  ' + card.title;
    fs.hidden = false;
    document.body.classList.add('fs-open');
    $('#fs-close').focus();
    enterViewer(fs, opener, closeFull);
    sceneUrl(card).then(url => {
      if (tok !== fsTok) { URL.revokeObjectURL(url); return; }
      fsUrl = url;
      const f = sceneFrame(url, card.kid);
      fsBody.append(f);
      f.addEventListener('load', () => f.focus());
    }).catch(err => { console.error(err); leaveViewer(); });
  }
  function closeFull() {
    fsTok++;
    fsBody.textContent = '';
    if (fsUrl) URL.revokeObjectURL(fsUrl);
    fsUrl = null;
    fs.hidden = true;
    document.body.classList.remove('fs-open');
  }
  $('#fs-close').addEventListener('click', () => leaveViewer());

  // ---- viewers: one open at a time, with a history entry so phone back closes it -------------

  // floating close for phones and touch; it moves into the open viewer so it also shows in
  // element full screen, where only the full screen element's subtree is drawn
  const fx = $('#fx');
  let viewer = null, popSkip = false;
  function enterViewer(host, opener, close) {
    viewer = { close, opener, y: window.scrollY };
    host.append(fx);
    fx.hidden = false;
    try { history.pushState({ phViewer: true }, ''); viewer.pushed = true; } catch (e) { /* file:// may refuse */ }
  }
  // fromPop: the browser already left the viewer's history entry
  function leaveViewer(fromPop) {
    if (!viewer) return;
    const v = viewer;
    viewer = null;
    fx.hidden = true;
    const wasFull = !!document.fullscreenElement;
    v.close();
    const restore = () => {
      window.scrollTo({ top: v.y, behavior: 'instant' });
      if (v.opener) v.opener.focus({ preventScroll: true });
    };
    restore();
    // leaving element full screen resets scroll and focus once it settles; restore again then
    if (wasFull) document.addEventListener('fullscreenchange', () => requestAnimationFrame(restore), { once: true });
    if (!fromPop && v.pushed && history.state && history.state.phViewer) { popSkip = true; history.back(); }
  }
  window.addEventListener('popstate', () => {
    if (popSkip) { popSkip = false; return; }
    leaveViewer(true);
  });
  fx.addEventListener('click', () => leaveViewer());

  function onKey(e) {
    if (e.key !== 'Escape' || !viewer) return;
    e.preventDefault();
    leaveViewer();
  }
  document.addEventListener('keydown', onKey);


  // ---- quality: one level picks render size, frame cap and how many tiles run ---------------

  const LEVELS = ['low', 'med', 'high'];
  const LEVEL = {
    low: { w: 960, h: 540, fps: 30, tile: 480, live: 1 },
    med: { w: 1280, h: 720, fps: 30, tile: 640, live: 3 },
    high: { w: 1920, h: 1080, fps: 60, tile: 960, live: 6 },
  };

  function gpuName() {
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return '';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String((ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || '');
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return name;
    } catch (e) { return ''; }
  }

  // starting level per machine: Luna (RX 7700S / 780M), the M4, Stardust (RTX 40 laptop), software GL
  function profileFor(name) {
    if (/swiftshader|llvmpipe|software|basic render/i.test(name)) return { level: 'low', fps60: false };
    if (/RX\s*7700S/i.test(name)) return { level: 'high', fps60: true };
    if (/RTX\s*(3080|3090|40[789]0|50[6-9]0)/i.test(name)) return { level: 'high', fps60: true };
    if (/RTX|780M|Radeon\(TM\) Graphics|Radeon Graphics/i.test(name)) return { level: 'med', fps60: false };
    if (/Apple/i.test(name)) return { level: 'med', fps60: true };
    return { level: 'low', fps60: false };
  }

  // fps meter: after `secs` whole seconds under `min` fps, calls onDrop once and starts over
  function makeGuard(onDrop, min = 24, secs = 5) {
    let n = 0, t0 = 0, slow = 0, fps = 0;
    return {
      get fps() { return fps; },
      frame(now) {
        if (!t0 || now - t0 > 2000) { n = 0; t0 = now; return; } // first frame or back from a stall
        n++;
        if (now - t0 < 1000) return;
        fps = n * 1000 / (now - t0);
        n = 0; t0 = now;
        slow = fps < min ? slow + 1 : 0;
        if (slow >= secs) { slow = 0; onDrop(); }
      },
      idle() { n = 0; t0 = 0; slow = 0; },
    };
  }

  const Q = (() => {
    const gpu = gpuName(), prof = profileFor(gpu), subs = [];
    let pick = 'auto';
    try { pick = localStorage.getItem('ph.q') || 'auto'; } catch (e) { /* storage blocked */ }
    let level = LEVELS.includes(pick) ? pick : prof.level, dropped = false;
    const emit = () => subs.forEach(f => f());
    const guard = makeGuard(() => {
      if (level === 'low') return;
      level = LEVELS[LEVELS.indexOf(level) - 1];
      dropped = true;
      emit();
    });
    return {
      gpu, prof, guard,
      get pick() { return pick; },
      get level() { return level; },
      get dropped() { return dropped; },
      get cfg() { const c = LEVEL[level]; return level === 'med' && prof.fps60 ? { ...c, fps: 60 } : c; },
      set(p) {
        pick = p;
        try { localStorage.setItem('ph.q', p); } catch (e) { /* storage blocked */ }
        level = LEVELS.includes(p) ? p : prof.level;
        dropped = false;
        guard.idle();
        emit();
      },
      on(f) { subs.push(f); },
    };
  })();

  // ---- hydras ---------------------------------------------------------------------------------

  const hMsg = $('#h-msg');
  const qSel = $('#h-q');
  function syncQuality() {
    qSel.value = Q.pick;
    qSel.options[0].textContent = 'Auto · ' + Q.prof.level;
    hMsg.textContent = Q.dropped ? 'Quality dropped to ' + Q.level : '';
    for (const t of tiles) if (t.hydra) resizeHydra(t);
  }
  qSel.addEventListener('change', () => Q.set(qSel.value));

  const slider = (label, min, max, step, value, on) => {
    const input = h('input', { type: 'range', min, max, step, value: String(value) });
    input.addEventListener('input', () => on(Number(input.value)));
    return h('label', { class: 'sl' }, h('span', { text: label }), input);
  };

  const tilesEl = $('#tiles');
  const tiles = D.hydras.map(s => {
    const canvas = h('canvas', { class: 'sk', 'aria-label': s.title + ' by ' + s.artist });
    const pre = h('pre', { hidden: true, text: s.code });
    const x = h('button', { class: 'btn btn-sig x', type: 'button', text: 'Close' });
    const t = { s, canvas, pre, hydra: null, visible: false, ratio: 0, playing: !reduceMotion, full: false,
      audio: false, fx: null, fxc: null, fxv: null, react: 0.5, smooth: 0.6, scale: 16, kal: false };
    // audio controls live inside the stage so they also show in element full screen
    const abOn = h('button', { class: 'btn', type: 'button', 'data-act': 'audio', 'aria-pressed': 'false', text: 'Audio' });
    const kal = h('button', { class: 'btn', type: 'button', 'data-act': 'kaleid', 'aria-pressed': 'false', text: 'Kaleid' });
    const sls = h('div', { class: 'ab-s' },
      slider('React', 0, 1, 0.01, t.react, v => { t.react = v; }),
      slider('Smooth', 0, 0.95, 0.01, t.smooth, v => { t.smooth = v; if (t.fx) t.fx.synth.a.setSmooth(v); }),
      slider('Scale', 2, 40, 1, t.scale, v => { t.scale = v; if (t.fx) t.fx.synth.a.setScale(v); }),
      kal);
    const ab = h('div', { class: 'ab' }, abOn, sls);
    const stage = h('div', { class: 'stage' }, canvas, pre, ab, x);
    const play = h('button', { class: 'btn', type: 'button', 'data-act': 'play' });
    const code = h('button', { class: 'btn', type: 'button', 'data-act': 'code', 'aria-pressed': 'false', text: 'Code' });
    const audio = h('button', { class: 'btn', type: 'button', 'data-act': 'audio', 'aria-pressed': 'false', text: 'Audio' });
    const full = h('button', { class: 'btn', type: 'button', 'data-act': 'full', text: 'Full screen' });
    const orig = h('a', { class: 'btn', href: s.url, target: '_blank', rel: 'noopener noreferrer', text: 'Edit in Hydra' });
    const by = h('p', { class: 'by' }, 'by ', s.link
      ? h('a', { href: s.link, target: '_blank', rel: 'noopener noreferrer', text: s.artist }) : s.artist);
    const el = h('article', { class: 'tile', 'data-sketch': s.id }, stage,
      h('div', { class: 'tile-b' }, h('h4', { text: s.title }), by, h('div', { class: 'acts' }, play, code, audio, full, orig)));
    tilesEl.append(el);
    Object.assign(t, { el, stage, play, audioBtns: [audio, abOn] });
    play.addEventListener('click', () => { t.playing = !t.playing; syncPlay(t); });
    code.addEventListener('click', () => { pre.hidden = !pre.hidden; code.setAttribute('aria-pressed', String(!pre.hidden)); });
    for (const b of t.audioBtns) b.addEventListener('click', () => setAudio(t, !t.audio));
    kal.addEventListener('click', () => { t.kal = !t.kal; kal.setAttribute('aria-pressed', String(t.kal)); });
    full.addEventListener('click', () => { setFull(t, true); enterViewer(stage, full, () => setFull(t, false)); });
    x.addEventListener('click', () => leaveViewer());
    syncPlay(t);
    return t;
  });

  function syncPlay(t) {
    t.play.textContent = t.playing ? 'Pause' : 'Play';
    t.play.setAttribute('aria-pressed', String(!t.playing));
  }

  // long side capped per quality level (phones: 480 in a tile, 720 full screen);
  // full screen never renders above DPR 1 and stays at 720p or more
  const small = () => Math.min(innerWidth, innerHeight) <= 600;
  function sizeOf(t) {
    const r = t.canvas.getBoundingClientRect();
    const long = Math.max(r.width, r.height, 1);
    const cap = small() ? (t.full ? 720 : 480) : (t.full ? Math.max(1280, Q.cfg.w) : Q.cfg.tile);
    const s = Math.min(t.full ? 1 : Math.min(window.devicePixelRatio || 1, 1.5), cap / long);
    return [Math.max(2, Math.round(r.width * s)), Math.max(2, Math.round(r.height * s))];
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
    if (t.audio) fxOn(t);
  }

  function resizeHydra(t) {
    if (!t.hydra) return;
    const [w, hgt] = sizeOf(t);
    if (w === t.canvas.width && hgt === t.canvas.height) return;
    t.hydra.setResolution(w, hgt);
    if (t.fx) t.fx.setResolution(w, hgt);
    if (!t.playing) { t.hydra.tick(0); if (t.fx) t.fx.tick(0); }
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
    if (!document.fullscreenElement && tiles.some(t => t.full)) leaveViewer();
  });
  window.addEventListener('resize', () => { for (const t of tiles) if (t.hydra) resizeHydra(t); });

  // ---- audio: one input stream, hydra's own analyser per tile, master FX after the sketch -----
  // Sketches stay verbatim. A second small hydra canvas pulls the tile in with s0.init and adds
  // a zoom pump and a flash on the bass band, and an optional kaleid on the high band.

  const inFld = $('#h-in-f'), inSel = $('#h-in');
  // line feeds want the raw signal: no voice processing
  const RAW = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  const input = { stream: null, id: '' };

  function openInput(id) {
    if (input.stream && input.id === id) return Promise.resolve(input.stream);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('no audio input'));
    return navigator.mediaDevices.getUserMedia({ audio: id ? { ...RAW, deviceId: { exact: id } } : RAW, video: false })
      .then(stream => {
        if (input.stream) input.stream.getTracks().forEach(k => k.stop());
        input.stream = stream; input.id = id;
        return listInputs().then(() => stream);
      });
  }

  // device labels are only readable once permission is granted
  function listInputs() {
    return navigator.mediaDevices.enumerateDevices().then(ds => {
      const cur = input.stream.getAudioTracks()[0].getSettings().deviceId;
      inSel.textContent = '';
      for (const d of ds.filter(x => x.kind === 'audioinput')) {
        inSel.append(h('option', { value: d.deviceId, text: d.label || 'Input ' + (inSel.length + 1) }));
      }
      if (cur && [...inSel.options].some(o => o.value === cur)) inSel.value = cur;
      inFld.hidden = false;
    });
  }
  inSel.addEventListener('change', () => {
    openInput(inSel.value).then(() => {
      for (const t of tiles) if (t.fx) { fxOff(t); fxOn(t); }
    }).catch(audioFailed);
  });

  function audioFailed(err) {
    console.warn(err);
    hMsg.textContent = err && err.name === 'NotAllowedError' ? 'Audio input blocked' : 'No audio input';
    for (const t of tiles) if (t.audio && !t.fx) setAudio(t, false);
  }

  function setAudio(t, on) {
    t.audio = on;
    t.stage.classList.toggle('is-audio', on);
    for (const b of t.audioBtns) b.setAttribute('aria-pressed', String(on));
    if (on) fxOn(t); else fxOff(t);
  }

  function fxOn(t) {
    if (!t.hydra || t.fx) return;
    openInput(input.id).then(stream => {
      if (!t.audio || t.fx) return;
      const c = h('canvas', { class: 'fxc', 'aria-hidden': 'true' });
      c.width = t.canvas.width; c.height = t.canvas.height;
      t.stage.insertBefore(c, t.pre);
      const F = new window.Hydra({
        canvas: c, width: c.width, height: c.height, autoLoop: false, makeGlobal: false,
        detectAudio: false, enableStreamCapture: false,
      });
      // hydra's Audio asks for the default mic with voice processing on; hand it our stream
      const md = navigator.mediaDevices;
      md.getUserMedia = () => Promise.resolve(stream.clone());
      try { F._initAudio(); } finally { delete md.getUserMedia; }
      F.detectAudio = true;
      const s = F.synth, a = s.a;
      a.setSmooth(t.smooth); a.setScale(t.scale); a.show();
      a.canvas.classList.add('meter');
      const bass = () => Math.min(1.5, a.fft[0]), high = () => Math.min(1.5, a.fft[3]);
      t.fxv = {
        zoom: () => 1 + bass() * 0.25 * t.react,
        flash: () => bass() * bass() * 0.3 * t.react,
        kal: () => (t.kal ? Math.min(1, high() * t.react) : 0),
      };
      s.s0.init({ src: t.canvas });
      s.src(s.s0).scale(t.fxv.zoom)
        .blend(s.src(s.s0).kaleid(4).scale(t.fxv.zoom), t.fxv.kal)
        .brightness(t.fxv.flash)
        .out(s.o0);
      F.tick(16);
      t.fx = F; t.fxc = c;
    }).catch(audioFailed);
  }

  function fxOff(t) {
    if (!t.fx) return;
    const a = t.fx.synth.a;
    try {
      if (a.stream) a.stream.getTracks().forEach(k => k.stop());
      if (a.context) a.context.close();
      a.canvas.remove();
      const lose = t.fx.regl._gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    } catch (e) { console.warn(e); }
    t.fxc.remove();
    t.fx = null; t.fxc = null; t.fxv = null;
  }

  // ---- loop -----------------------------------------------------------------------------------

  let hydraLib = null;
  function loadHydraLib() {
    return hydraLib || (hydraLib = new Promise((res, rej) => {
      const s = h('script', { src: 'vendor/hydra-synth/hydra-synth.js' });
      s.onload = () => res(); s.onerror = rej;
      document.head.append(s);
    }));
  }

  // tiles near the screen get an instance; the most visible ones (up to the level's budget) run,
  // the rest hold their last frame
  const tileIO = new IntersectionObserver(entries => {
    for (const e of entries) {
      const t = tiles.find(x => x.el === e.target);
      t.visible = e.isIntersecting;
      t.ratio = e.intersectionRatio;
      if (t.visible && !t.hydra) loadHydraLib().then(() => { if (!t.hydra) startHydra(t); }).catch(err => console.error(err));
    }
  }, { rootMargin: '100px 0px', threshold: [0, 0.25, 0.5, 0.75, 1] });
  for (const t of tiles) tileIO.observe(t.el);

  function liveTiles() {
    // with a viewer open only a full screen tile runs; the grid resumes on close
    if (viewer) return tiles.filter(t => t.full && t.hydra && t.playing);
    return tiles.filter(t => t.hydra && t.playing && t.visible)
      .sort((a, b) => b.ratio - a.ratio).slice(0, Q.cfg.live);
  }

  let last = performance.now(), acc = 0;
  function loop(now) {
    acc += Math.min(100, now - last);
    last = now;
    // frame cap, with 1 ms of slack for rAF jitter
    if (acc >= 1000 / Q.cfg.fps - 1) {
      const live = liveTiles();
      for (const t of live) {
        t.hydra.tick(acc);
        if (t.fx) t.fx.tick(acc);
      }
      if (live.length) Q.guard.frame(now); else Q.guard.idle();
      acc = 0;
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  Q.on(syncQuality);
  syncQuality();

  window.__ph = { cards: cardEls.length, tiles, q: Q, makeGuard, liveTiles };
}
