// Tracks what's already been published so the cron never double-posts and knows
// when to fire the year-review. State lives in docs/published.json (committed back
// by the Action). Also the index page listing every issue as clickable links.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const DOCS = './docs';                    // GitHub Pages serves from /docs
const LEDGER = `${DOCS}/published.json`;

// Write an issue's HTML to the docs folder with a stable, shareable filename.
// Same filename for the same week/season, so regenerate overwrites in place.
export function writeIssue(action, html) {
  if (!existsSync(DOCS)) mkdirSync(DOCS, { recursive: true });
  const file = action.type === 'YEAR_REVIEW'
    ? `${action.season}-review.html`
    : `${action.season}-week-${action.week}.html`;
  const path = `${DOCS}/${file}`;
  writeFileSync(path, html);
  return path;
}

export function loadPublished() {
  if (!existsSync(LEDGER)) return { weeks: new Set(), yearReview: new Set(), list: [] };
  const raw = JSON.parse(readFileSync(LEDGER));
  return { weeks: new Set(raw.weeks), yearReview: new Set(raw.yearReview), list: raw.list ?? [] };
}

export function markPublished(action) {
  const p = loadPublished();
  if (action.type === 'WEEKLY') {
    p.weeks.add(`${action.season}-w${action.week}`);
    p.list.push({ kind: 'weekly', season: action.season, week: action.week,
                  file: `${action.season}-week-${action.week}.html`, at: Date.now() });
  } else if (action.type === 'YEAR_REVIEW') {
    p.yearReview.add(action.season);
    p.list.push({ kind: 'review', season: action.season,
                  file: `${action.season}-review.html`, at: Date.now() });
  }
  if (!existsSync(DOCS)) mkdirSync(DOCS, { recursive: true });
  writeFileSync(LEDGER, JSON.stringify({
    weeks: [...p.weeks], yearReview: [...p.yearReview], list: p.list }, null, 2));
  rebuildIndex(p.list);
}

// The clickable landing page: every issue, newest first, grouped by season.
function rebuildIndex(list) {
  const bySeason = {};
  for (const it of list) (bySeason[it.season] ??= []).push(it);
  const seasons = Object.keys(bySeason).sort().reverse();
  const links = seasons.map(s => {
    const items = bySeason[s].sort((a, b) => (b.week ?? 99) - (a.week ?? 99));
    const lis = items.map(it => {
      const label = it.kind === 'review' ? `${s} · Season in Review` : `${s} · Week ${it.week}`;
      return `<li><a href="./${it.file}">${label}</a></li>`;
    }).join('\n');
    return `<section><h2>${s}</h2><ul>${lis}</ul></section>`;
  }).join('\n');

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>The Hetero Herald — Archive</title>
<style>body{font-family:Georgia,serif;background:#f4efe4;color:#1a1713;max-width:640px;margin:40px auto;padding:0 20px}
h1{font-family:'Playfair Display',serif;border-bottom:3px double #1a1713;padding-bottom:10px}
h2{font-family:monospace;font-size:14px;letter-spacing:.1em;text-transform:uppercase;color:#7c2118;margin-top:28px}
ul{list-style:none;padding:0}li{padding:6px 0;border-bottom:1px solid #e7dfce}
a{color:#1a1713;text-decoration:none}a:hover{color:#7c2118}</style></head>
<body><h1>The Hetero Herald</h1><p><em>The Newspaper of Record. Every issue, every season.</em></p>
${links}</body></html>`;
  writeFileSync(`${DOCS}/index.html`, html);
}
