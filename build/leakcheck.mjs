// Fails if any kodama text, scene file name, Hydra code line or the password appears in plaintext in docs/.
//   PH_PASSWORD=... node leakcheck.mjs      (vendor/ is excepted)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(HERE, '..', 'docs');
const { cards, groups } = JSON.parse(fs.readFileSync(path.join(HERE, '.cache', 'cards.json'), 'utf8'));
const { sketches } = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'hydra-sketches.json'), 'utf8'));

const needles = new Set();
const add = s => { s = (s || '').trim(); if (s.length >= 6) needles.add(s.toLowerCase()); };
for (const c of cards) { add(c.title); add(c.desc); add(c.sci); add(c.tide); add(c.file.replace(/\.html$/, '')); }
for (const g of groups) add(g.title);
for (const s of sketches) for (const line of s.code.split('\n')) if (line.trim().length >= 12) add(line);
add('modulateKaleid'); add('Celeste Betancur'); add('Marianne Teixido');
const pw = process.env.PH_PASSWORD;
if (pw) needles.add(pw.toLowerCase()); else console.warn('PH_PASSWORD not set: password not checked');

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (path.relative(DOCS, p) !== 'vendor') walk(p); }
    else files.push(p);
  }
})(DOCS);

let hits = 0;
for (const f of files) {
  if (/\.woff2$/.test(f)) continue;
  const text = fs.readFileSync(f, 'utf8').toLowerCase();
  for (const n of needles) if (text.includes(n)) { hits++; console.log('LEAK', path.relative(DOCS, f), JSON.stringify(n.slice(0, 60))); }
}
console.log(`leakcheck: ${files.length} files, ${needles.size} needles, ${hits} hits`);
process.exit(hits ? 1 : 0);
