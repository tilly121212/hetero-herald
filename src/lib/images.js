// Vintage image rotation. You drop up to ~20 black-and-white football photos into
// ./images/ (your own sourcing — for a privately-shared HTML file, not a public site).
// Each issue picks images at random. The pick is SEEDED by season+week so a given
// issue always shows the same images if regenerated (stable), but different issues
// differ. If the folder is empty, a CSS-halftone placeholder renders instead so the
// layout never breaks.

import { readdirSync } from 'node:fs';

const IMG_EXT = /\.(jpe?g|png|gif|webp)$/i;

// Simple seeded RNG (mulberry32) so picks are stable per issue.
function seeded(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function listImages(dir = './images') {
  try { return readdirSync(dir).filter(f => IMG_EXT.test(f)); }
  catch { return []; }
}

// Pick `count` distinct images for a given issue, seeded by season+week.
export function pickImages({ season, week, count = 3, dir = './images' } = {}) {
  const all = listImages(dir);
  if (all.length === 0) return []; // caller renders CSS-halftone fallback
  const rng = seeded(`${season}-w${week}`);
  const pool = [...all];
  const picks = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rng() * pool.length);
    picks.push(`${dir}/${pool.splice(idx, 1)[0]}`);
  }
  return picks;
}

// CSS-halftone fallback markup: an engraving-style vintage plate that needs no
// image file. Used when ./images is empty, or to fill remaining photo slots.
export function halftonePlaceholder(caption = '') {
  return `<figure class="plate plate-halftone">
    <div class="halftone-fill"></div>
    <figcaption>${caption}</figcaption>
  </figure>`;
}

// Wrap a real image with the newsprint "photo plate" treatment (grayscale + frame).
export function photoPlate(src, caption = '') {
  return `<figure class="plate">
    <img src="${src}" alt="${caption || 'vintage football'}" loading="lazy">
    <figcaption>${caption}</figcaption>
  </figure>`;
}
