import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = join('src', 'assets', 'art');

/** mulberry32 — a 32-bit PRNG. Chosen over Math.random precisely because it is
 * seedable: the artwork must be reproducible in CI and identical for every
 * developer, or regenerating it would produce an unreviewable diff.
 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Round to 2dp so the committed file does not churn on float noise. */
const n = (v) => Math.round(v * 100) / 100;

/** The aurora. Six orbs, each a radial gradient fading to fully transparent, on
 * a 1600x900 canvas. No <filter> blur: a gradient's own falloff IS the blur, and
 * a filter would force the rasterisation of a 1600x900 surface on first paint
 * for a result the eye cannot distinguish.
 *
 * The hues are the app's existing accent family and nothing else — indigo-blue,
 * cyan, violet. No new colour is introduced, so the palette audit's verdict on
 * the app still describes this layer.
 */
function aurora() {
  const rand = rng(0x5eed);
  const HUES = [
    { c: '#2563eb', a: 0.2 }, // blue-600 — the primary accent
    { c: '#06b6d4', a: 0.16 }, // cyan-500 — the existing dispatch hue
    { c: '#8b5cf6', a: 0.14 }, // violet-500 — the existing QC hue
  ];

  const orbs = [];
  for (let i = 0; i < 6; i++) {
    const hue = HUES[i % HUES.length];
    // Spread across the canvas with a bias to the top, where the wash reads as
    // light from above rather than as a stain in the middle of the page.
    const cx = n(rand() * 1600);
    const cy = n(rand() * 620);
    const r = n(340 + rand() * 360);
    // Later orbs are quieter, so the composition has a foreground.
    const a = n(hue.a * (1 - i / 9));
    orbs.push({ id: `o${i}`, cx, cy, r, c: hue.c, a });
  }

  const defs = orbs
    .map(
      (o) => `    <radialGradient id="${o.id}" cx="50%" cy="50%" r="50%">\n      <stop offset="0%" stop-color="${o.c}" stop-opacity="${o.a}"/>\n      <stop offset="55%" stop-color="${o.c}" stop-opacity="${n(o.a * 0.42)}"/>\n      <stop offset="100%" stop-color="${o.c}" stop-opacity="0"/>\n    </radialGradient>`,
    )
    .join('\n');

  const shapes = orbs
    .map((o) => `    <ellipse cx="${o.cx}" cy="${o.cy}" rx="${o.r}" ry="${n(o.r * 0.72)}" fill="url(#${o.id})"/>`)
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" role="presentation">\n  <defs>\n${defs}\n  </defs>\n${shapes}\n</svg>\n`;
}

/** The grain.
 *
 * feTurbulence, desaturated by feColorMatrix, at a tile size small enough to
 * repeat invisibly. `stitchTiles="stitch"` is load-bearing: without it the tile
 * edges do not meet and the canvas shows a faint grid of seams — which on a
 * dot-grid canvas reads as a second, broken grid.
 *
 * The alpha here is 1 and the *opacity is owned by CSS*, so the theme decides
 * how much grain it wants (dark needs more; the same value on white is a
 * whisper and on near-black is invisible).
 */
function grain() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" role="presentation">\n  <filter id="g" x="0" y="0" width="100%" height="100%">\n    <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="3" stitchTiles="stitch"/>\n    <feColorMatrix type="saturate" values="0"/>\n  </filter>\n  <rect width="160" height="160" filter="url(#g)"/>\n</svg>\n`;
}

/** Auth hero mesh — a soft, layered gradient behind the sign-in tray.
 *
 * This is the one place the app puts a focal image: the surface a visitor lands
 * on. It is generated here as deterministic SVG (seeded PRNG) and version-
 * controlled, so it is reproducible, reviewable as a diff, offline, and theme-
 * aware, rather than committed as a photograph or a generated raster.
 *
 * The hues stay inside the app's existing accent family (indigo / cyan / violet)
 * and stay low enough to read as atmosphere rather than as colour, so the same
 * palette-audit disciplinary boundary the aurora already respects still describes
 * this layer. It is the same rationale the aurora and the ambiance pass share.
 */
function authHero() {
  const rand = rng(0xa1c2);
  const W = 1200;
  const H = 720;
  const stops = [
    { c: '#2563eb', a: 0.22 },
    { c: '#06b6d4', a: 0.16 },
    { c: '#8b5cf6', a: 0.12 },
    { c: '#1d4ed8', a: 0.10 },
  ];

  const orbs = [];
  for (let i = 0; i < 5; i++) {
    const s = stops[i % stops.length];
    const cx = n(rand() * W);
    const cy = n(rand() * 0.72 * H);
    const r = n(360 + rand() * 320);
    const a = n(s.a * (1 - i / 8));
    orbs.push({ id: `h${i}`, cx, cy, r, c: s.c, a });
  }

  const defs = orbs
    .map(
      (o) => `    <radialGradient id="${o.id}" cx="50%" cy="50%" r="50%">\n      <stop offset="0%" stop-color="${o.c}" stop-opacity="${o.a}"/>\n      <stop offset="55%" stop-color="${o.c}" stop-opacity="${n(o.a * 0.38)}"/>\n      <stop offset="100%" stop-color="${o.c}" stop-opacity="0"/>\n    </radialGradient>`,
    )
    .join('\n');

  const shapes = orbs
    .map((o) => `    <ellipse cx="${o.cx}" cy="${o.cy}" rx="${o.r}" ry="${n(o.r * 0.72)}" fill="url(#${o.id})"/>`)
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="presentation">\n  <defs>\n${defs}\n  </defs>\n${shapes}\n</svg>\n`;
}

mkdirSync(OUT_DIR, { recursive: true });

const files = [
  ['aurora.svg', aurora()],
  ['grain.svg', grain()],
  ['auth-hero.svg', authHero()],
];

for (const [name, svg] of files) {
  const path = join(OUT_DIR, name);
  writeFileSync(path, svg, 'utf8');
  console.log(`art: wrote ${path} (${(statSync(path).size / 1024).toFixed(1)} kB)`);
}
console.log(`art: ${files.length} assets, deterministic (seeded), no network used`);
