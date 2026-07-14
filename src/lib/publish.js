// Tracks what's already been published so the cron never double-posts and knows
// when to fire the year-review. State lives in docs/published.json (committed back
// by the Action). Also the index page listing every issue as clickable links.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs';

const DOCS = './docs';                    // GitHub Pages serves from /docs
const LEDGER = `${DOCS}/published.json`;

// GitHub Pages serves the SITE ROOT from /docs, so a page in docs/ cannot reach ../images —
// that climbs above the site root and 404s (which is exactly what happened live). Mirror the
// images into docs/images/ and reference them relatively instead, which works both on Pages
// and when opening the file locally.
export function syncImagesToDocs(srcDir = './images') {
  if (!existsSync(srcDir)) return;
  const dest = `${DOCS}/images`;
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  for (const f of readdirSync(srcDir)) {
    if (!/\.(jpe?g|png|gif|webp)$/i.test(f)) continue;
    try { copyFileSync(`${srcDir}/${f}`, `${dest}/${f}`); } catch {}
  }
}

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

// When did the PREVIOUS issue go out? Controversy Corner uses this as its submission window:
// only takes that arrived since the last paper are eligible. A rolling "last 7 days from now"
// window was being used instead, which meant a single take kept resurfacing in issue after
// issue (and made back-filling several weeks in one sitting show the same take every time).
// Returns null when nothing has been published yet.
export function lastIssueAt() {
  const p = loadPublished();
  if (!p.list.length) return null;
  const times = p.list.map(it => it.at).filter(Boolean);
  return times.length ? Math.max(...times) : null;
}

export function markPublished(action) {
  const p = loadPublished();
  // Idempotent: regenerate re-registers a week it rewrites, so guard against pushing a second
  // entry for the same issue (which would show it twice on the index).
  const already = (file) => p.list.some(it => it.file === file);
  if (action.type === 'WEEKLY') {
    const file = `${action.season}-week-${action.week}.html`;
    p.weeks.add(`${action.season}-w${action.week}`);
    if (!already(file)) {
      p.list.push({ kind: 'weekly', season: action.season, week: action.week, file, at: Date.now() });
    }
  } else if (action.type === 'YEAR_REVIEW') {
    const file = `${action.season}-review.html`;
    p.yearReview.add(action.season);
    if (!already(file)) {
      p.list.push({ kind: 'review', season: action.season, week: action.week ?? 17, file, at: Date.now() });
    }
  }
  if (!existsSync(DOCS)) mkdirSync(DOCS, { recursive: true });
  writeFileSync(LEDGER, JSON.stringify({
    weeks: [...p.weeks], yearReview: [...p.yearReview], list: p.list }, null, 2));
  rebuildIndex(p.list);
}

// The landing page: every issue, grouped by season. Newest season first, newest issue first
// within each season. Styled to match the paper itself rather than looking like a file list.
function rebuildIndex(list) {
  const bySeason = {};
  for (const it of list) (bySeason[it.season] ??= []).push(it);
  // newest SEASON first (2026 above 2025)
  const seasons = Object.keys(bySeason).sort((a, b) => Number(b) - Number(a));

  const sections = seasons.map(s => {
    // newest ISSUE first. The review IS the championship week (17), so sort it by its week
    // like everything else and it naturally lands on top.
    const items = bySeason[s].slice().sort((a, b) => (b.week ?? 0) - (a.week ?? 0));
    const rows = items.map(it => {
      const label = it.kind === 'review'
        ? `Season in Review (Week ${it.week ?? 17})`
        : `Week ${it.week}`;
      return `      <li><a href="./${it.file}"><span class="issue">${s} \u00b7 ${label}</span><span class="rule"></span></a></li>`;
    }).join('\n');
    return `    <section>
      <h2>${s}</h2>
      <ul>
${rows}
      </ul>
    </section>`;
  }).join('\n');

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>The Hetero Herald &mdash; Archive</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Old+Standard+TT:ital,wght@0,400;0,700;1,400&family=Special+Elite&display=swap" rel="stylesheet">
<style>
  :root{ --paper:#f4efe4; --ink:#1a1713; --oxblood:#7c2118; --stamp:#9a8f7a; --rule:#2a251e; --faint:#e7dfce; }
  *{box-sizing:border-box}
  body{background:var(--paper);color:var(--ink);margin:0;padding:48px 20px 80px;
       font-family:'Old Standard TT',Georgia,serif;
       background-image:radial-gradient(circle at 20% 30%, rgba(0,0,0,.015) 1px, transparent 1px);
       background-size:4px 4px;}
  .wrap{max-width:720px;margin:0 auto}
  header{text-align:center;border-bottom:3px double var(--rule);padding-bottom:18px;margin-bottom:6px}
  h1{font-family:'Playfair Display',serif;font-weight:900;font-size:clamp(38px,8vw,64px);
     letter-spacing:-.01em;margin:0;line-height:1}
  .tagline{font-family:'Old Standard TT',serif;font-style:italic;color:#5b5142;margin:10px 0 0;font-size:15px}
  .flag{display:flex;justify-content:space-between;font-family:'Special Elite',monospace;
        font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--stamp);
        border-bottom:1px solid var(--rule);padding:8px 0;margin-bottom:34px}
  section{margin-bottom:34px}
  h2{font-family:'Special Elite',monospace;font-size:12px;letter-spacing:.18em;text-transform:uppercase;
     color:var(--oxblood);margin:0 0 4px;padding-bottom:6px;border-bottom:1px solid var(--rule)}
  ul{list-style:none;padding:0;margin:0}
  /* Explicit colours on BOTH the anchor and the text span. Relying on inheritance alone left
     the links rendering in default browser blue against the newsprint. */
  li a, li a:link, li a:visited{display:flex;align-items:center;gap:12px;text-decoration:none;
       color:#1a1713;padding:10px 2px;border-bottom:1px solid var(--faint);transition:color .12s}
  li a:hover, li a:hover .issue{color:#7c2118}
  li a:hover .issue{text-decoration:underline;text-underline-offset:3px}
  .issue{font-family:'Playfair Display',serif;font-weight:700;font-size:19px;white-space:nowrap;color:#1a1713}
  .rule{flex:1}
  footer{margin-top:56px;border-top:3px double var(--rule);padding-top:12px;text-align:center;
         font-family:'Special Elite',monospace;font-size:10.5px;letter-spacing:.12em;
         text-transform:uppercase;color:var(--stamp)}
  .empty{font-style:italic;color:var(--stamp);padding:12px 0}
</style></head>
<body>
  <div class="wrap">
    <header>
      <h1>The Hetero Herald</h1>
      <p class="tagline">The Newspaper of Record. Every issue, every season.</p>
    </header>
    <div class="flag"><span>The Archive</span><span>Filed by V. Malloy</span></div>
${sections || '    <p class="empty">No issues yet. The presses are warm.</p>'}
    <footer>The Hetero Herald &middot; Est. 2023</footer>
  </div>
</body></html>`;
  writeFileSync(`${DOCS}/index.html`, html);
}
