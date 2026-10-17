# posthuman3026

Password gated demo site for the GSD Halloween party, theme Post Human. Phylla biome creative work.

Live: https://laserpirate.github.io/posthuman3026/

- **01 Phylla Kodamas**: 12 kodama scenes (three.js r128, allowlisted by kID in `build/build.mjs`) in two groups
  with still plates, search, group chips, one live preview at a time and full screen. All Phylla Kodamas are original works by Marko Manriquez; no reproduction.
- **02 Hydras**: six live sketches from the Hydra gallery by their credited artists (CC BY-NC-SA 4.0), run with hydra-synth by Olivia Jack (AGPL-3.0).

&copy; 2026 Marko Manriquez. All rights reserved. See `LICENSE`.

## Layout

```
docs/    deployable site (GitHub Pages: main /docs). Ciphertext except the gate, fonts and vendor files.
build/   build.mjs, capture.mjs, e2e.mjs, leakcheck.mjs, src/ (gate + app templates), data/ (Hydra sketches)
```

Kodama text and scenes are not stored in this repo. The build reads them from the kodama library folder
(`All_Kodamas`, read only) and writes them into `docs/` only as ciphertext.

## Build

Requires Node 22. The password is never committed: pass it as `PH_PASSWORD` (or `--password`).

```sh
cd build
npm install
npx playwright install chromium            # must match the installed playwright version
node build.mjs scenes --lib ../../All_Kodamas   # extract cards, inline the manifest, inject meta robots -> .cache/
node capture.mjs                            # still plate per scene -> .cache/stills/
PH_PASSWORD=... node build.mjs pack --lib ../../All_Kodamas   # encrypt -> ../docs/
PH_PASSWORD=... node leakcheck.mjs          # no kodama text, Hydra code or password in plaintext in docs/
PH_PASSWORD=... node e2e.mjs                # headless end to end
```

`--lib` defaults to `../../All_Kodamas` relative to `build/`.

## How the gate works

- Everything behind the gate (app markup, CSS, JS, card data, still plates, every scene) is encrypted with
  AES-256-GCM. The key comes from PBKDF2-SHA256, 600,000 iterations, random salt per build.
- The browser derives the key with WebCrypto. A wrong password fails GCM authentication.
- Payloads are `<script>` files (`docs/p/*.js`) rather than fetched, so the site also works from `file://`.
- Scenes decrypt to `blob:` URLs loaded into iframes. three.js loads from cdnjs, so scenes need a network connection.
- The derived key is kept in `sessionStorage` for the tab.

## Honest limits

The password is short. Anyone who downloads `docs/` can brute force it offline; 600k PBKDF2 iterations slow
that down but do not stop it. This gate keeps out crawlers, AI scrapers and casual visitors. It does not stop a
determined attacker, and anyone who has the password can save what the browser decrypts.

## No crawl

`robots.txt` (all agents plus named search, AI training and archive bots), `ai.txt`, meta robots
`noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai` on the gate and injected into every
scene, `_headers` with `X-Robots-Tag` for Netlify / Cloudflare Pages, `.nojekyll`, no sitemap.
GitHub Pages ignores `_headers`; there the meta tags and robots files do the work.

## Credits

- Hydra sketches: Celeste Betancur, Ritchse, Nesso, Marianne Teixido, ΔNDR0M3DΔ. CC BY-NC-SA 4.0.
  Source: `hydra-synth/hydra` `src/stores/examples.json`, copied verbatim into `build/data/hydra-sketches.json`.
- hydra-synth by Olivia Jack, AGPL-3.0. Vendored unmodified with its license in `docs/vendor/hydra-synth/`.
- three.js r128, MIT, loaded from cdnjs.
- Chakra Petch, Schibsted Grotesk, Martian Mono: SIL OFL 1.1 (`docs/fonts/OFL.txt`).
