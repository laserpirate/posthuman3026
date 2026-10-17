// posthuman build
//   node build.mjs scenes --lib <All_Kodamas>    extract cards, prep scene copies into .cache/
//   node capture.mjs                              stills into .cache/stills/
//   PH_PASSWORD=... node build.mjs pack --lib <All_Kodamas>   encrypt everything into ../docs/
// The library folder is read only. Nothing from it is written outside .cache/ except as ciphertext.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, '.cache');
const DOCS = path.resolve(HERE, '..', 'docs');
const SRC = path.join(HERE, 'src');
const NM = path.join(HERE, 'node_modules');

const KEEP_GROUPS = ['delta', 'spec'];
// only these scenes are published; everything else in the index stays out of the build
const KEEP_KIDS = [
  'pk17', 'pk18', 'pk19', 'pk20', 'pk21', 'pk24',
  'pk08', 'pk10', 'pk12', 'pk13', 'pk15', 'pk25',
];
const CARD_COUNT = KEEP_KIDS.length;
const ITERATIONS = 600000;
const ROBOTS = 'noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai';

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : fallback;
}
const LIB = path.resolve(arg('lib', path.join(HERE, '..', '..', 'All_Kodamas')));

const unescape = s => s
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .trim();

// display copy carries no em dashes; the index already uses a middle dot as separator
const noEm = s => s.replace(/\s*—\s*/g, ' · ');

function extractCards() {
  const src = fs.readFileSync(path.join(LIB, 'KODAMAS_INDEX_v02.html'), 'utf8');
  const groups = [];
  const cards = [];
  const secRe = /<section id="([^"]+)"><h2>(.*?)(?:<span class="count">(\d+)<\/span>)?<\/h2>(.*?)<\/section>/gs;
  for (const [, id, h2, declared, body] of src.matchAll(secRe)) {
    if (!KEEP_GROUPS.includes(id)) continue;
    const found = [...body.matchAll(/<article class="card"([^>]*)>(.*?)<\/article>/gs)];
    if (declared && Number(declared) !== found.length) throw new Error(`group ${id}: declared ${declared}, found ${found.length}`);
    const group = { id, title: noEm(unescape(h2)), count: 0 };
    groups.push(group);
    for (const [, attrs, c] of found) {
      const pick = re => { const m = c.match(re); return m ? noEm(unescape(m[1])) : ''; };
      if (!KEEP_KIDS.includes(pick(/<span class="kid">(.*?)<\/span>/s))) continue;
      group.count++;
      const series = unescape((attrs.match(/data-series="([^"]*)"/) || [, ''])[1]);
      const file = (c.match(/data-src="([^"]+)"/) || c.match(/href="([^"]+\.html)"/))[1];
      cards.push({
        group: id, series, file,
        kid: pick(/<span class="kid">(.*?)<\/span>/s),
        title: pick(/<h3>(.*?)<\/h3>/s),
        desc: pick(/<p class="desc">(.*?)<\/p>/s),
        sci: pick(/<div class="sci">(.*?)<\/div>/s),
        tide: pick(/<div class="tide">(.*?)<\/div>/s),
      });
    }
  }
  return { groups, cards };
}

function prepScene(file) {
  let html = fs.readFileSync(path.join(LIB, file), 'utf8');
  const manifestTag = /<script\s+src="phylla-kodama-manifest\.js"\s*><\/script>/;
  if (manifestTag.test(html)) {
    const manifest = fs.readFileSync(path.join(LIB, 'phylla-kodama-manifest.js'), 'utf8');
    if (/<\/script/i.test(manifest)) throw new Error('manifest contains </script');
    html = html.replace(manifestTag, () => '<script>\n' + manifest + '\n</script>');
  }
  if (/<script[^>]*src="(?!https?:)/.test(html)) throw new Error(`${file}: unresolved relative script`);
  const meta = `<meta name="robots" content="${ROBOTS}">`;
  if (!/<head[^>]*>/i.test(html)) throw new Error(`${file}: no <head>`);
  return html.replace(/<head[^>]*>/i, m => m + meta);
}

function stageScenes() {
  const { groups, cards } = extractCards();
  if (cards.length !== CARD_COUNT) throw new Error(`expected ${CARD_COUNT} cards, got ${cards.length}`);
  if (groups.some(g => !g.count)) throw new Error('empty group');
  fs.rmSync(path.join(CACHE, 'scenes'), { recursive: true, force: true });
  fs.mkdirSync(path.join(CACHE, 'scenes'), { recursive: true });
  for (const c of cards) fs.writeFileSync(path.join(CACHE, 'scenes', c.kid + '.html'), prepScene(c.file));
  fs.writeFileSync(path.join(CACHE, 'cards.json'), JSON.stringify({ groups, cards }, null, 1));
  console.log(`scenes: ${groups.length} groups, ${cards.length} scenes -> ${path.relative(HERE, CACHE)}`);
}

// ---- crypto -------------------------------------------------------------------------------

function makeSealer(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
  const needles = [password, ...password.split(/[^A-Za-z0-9]+/)].map(s => s.toLowerCase()).filter(s => s.length >= 4);
  const seal = buf => {
    // reroll the IV until the base64 text cannot be mistaken for the password by a grep
    for (;;) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([c.update(buf), c.final(), c.getAuthTag()]);
      const b64 = Buffer.concat([iv, ct]).toString('base64');
      const low = b64.toLowerCase();
      if (!needles.some(n => low.includes(n))) return b64;
    }
  };
  return { salt: salt.toString('base64'), seal };
}

const token = () => crypto.randomBytes(6).toString('hex');

function writePayload(name, buf, seal) {
  fs.writeFileSync(path.join(DOCS, 'p', name + '.js'), `PH(${JSON.stringify(name)},"${seal(buf)}");\n`);
}

// ---- hydra --------------------------------------------------------------------------------

function hydraSketches() {
  const raw = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'hydra-sketches.json'), 'utf8'));
  return raw.sketches.map(s => {
    const head = s.code.split('\n').map(l => l.trim()).filter(Boolean).filter(l => l.startsWith('//')).slice(0, 3)
      .map(l => l.replace(/^\/\/\s*/, ''));
    const [title, by, link] = head;
    return {
      id: s.id,
      title,
      artist: by.replace(/^(by|por)\s+/i, ''),
      link: link ? (/^https?:/.test(link) ? link : 'https://' + link) : '',
      url: 'https://hydra.ojack.xyz/?sketch_id=' + s.id,
      code: s.code,
    };
  });
}

// ---- pack ---------------------------------------------------------------------------------

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

const FONTS = [
  ['chakra-petch', 'chakra-petch-latin-500-normal.woff2'],
  ['chakra-petch', 'chakra-petch-latin-600-normal.woff2'],
  ['chakra-petch', 'chakra-petch-latin-ext-500-normal.woff2'],
  ['chakra-petch', 'chakra-petch-vietnamese-500-normal.woff2'],
  ['chakra-petch', 'chakra-petch-thai-500-normal.woff2'],
  ['schibsted-grotesk', 'schibsted-grotesk-latin-400-normal.woff2'],
  ['schibsted-grotesk', 'schibsted-grotesk-latin-ext-400-normal.woff2'],
  ['martian-mono', 'martian-mono-latin-400-normal.woff2'],
];

function stagePack() {
  const password = arg('password', process.env.PH_PASSWORD);
  if (!password) throw new Error('set PH_PASSWORD or pass --password');
  const { groups, cards } = JSON.parse(fs.readFileSync(path.join(CACHE, 'cards.json'), 'utf8'));
  const { salt, seal } = makeSealer(password);

  fs.rmSync(DOCS, { recursive: true, force: true });
  fs.mkdirSync(path.join(DOCS, 'p'), { recursive: true });

  const outCards = cards.map(c => {
    const scene = token(), still = token();
    writePayload(scene, fs.readFileSync(path.join(CACHE, 'scenes', c.kid + '.html')), seal);
    const stillFile = path.join(CACHE, 'stills', c.kid + '.jpg');
    if (!fs.existsSync(stillFile)) throw new Error(`missing still for ${c.kid}; run capture.mjs`);
    writePayload(still, fs.readFileSync(stillFile), seal);
    const { file, ...pub } = c;
    return { ...pub, scene, still };
  });

  const app = {
    css: fs.readFileSync(path.join(SRC, 'app.css'), 'utf8'),
    html: fs.readFileSync(path.join(SRC, 'app.html'), 'utf8'),
    js: fs.readFileSync(path.join(SRC, 'app.js'), 'utf8'),
    groups, cards: outCards, hydras: hydraSketches(),
  };
  if (JSON.stringify(app).includes('—')) throw new Error('em dash in app copy');
  if (outCards.some(c => !KEEP_KIDS.includes(c.kid))) throw new Error('kID outside allowlist in app data');
  const appName = token();
  writePayload(appName, Buffer.from(JSON.stringify(app)), seal);

  const gate = fs.readFileSync(path.join(SRC, 'gate.html'), 'utf8')
    .replaceAll('{{ROBOTS}}', ROBOTS)
    .replace('{{CONFIG}}', JSON.stringify({ salt, iter: ITERATIONS, app: appName }));
  fs.writeFileSync(path.join(DOCS, 'index.html'), gate);

  for (const [pkg, f] of FONTS) copy(path.join(NM, '@fontsource', pkg, 'files', f), path.join(DOCS, 'fonts', f));
  fs.writeFileSync(path.join(DOCS, 'fonts', 'OFL.txt'),
    FONTS.map(([p]) => p).filter((p, i, a) => a.indexOf(p) === i)
      .map(p => `==== ${p} ====\n` + fs.readFileSync(path.join(NM, '@fontsource', p, 'LICENSE'), 'utf8')).join('\n'));
  copy(path.join(NM, 'hydra-synth', 'dist', 'hydra-synth.js'), path.join(DOCS, 'vendor', 'hydra-synth', 'hydra-synth.js'));
  copy(path.join(NM, 'hydra-synth', 'LICENSE'), path.join(DOCS, 'vendor', 'hydra-synth', 'LICENSE'));
  for (const f of ['robots.txt', 'ai.txt', '_headers', '.nojekyll']) copy(path.join(SRC, 'static', f), path.join(DOCS, f));

  console.log(`pack: app + ${outCards.length} scenes + ${outCards.length} stills, ${app.hydras.length} hydras -> docs/`);
}

const stage = process.argv[2];
if (stage === 'scenes') stageScenes();
else if (stage === 'pack') stagePack();
else { console.error('usage: node build.mjs scenes|pack [--lib DIR] [--password PW]'); process.exit(1); }
