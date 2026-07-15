// Broadsheet template — emits the EXACT structure of the approved herald-wk1 demo.
// This is a faithful copy of that demo's markup with content swapped for slots.
// Layout divs, grid-column splits, cols-3 rows, columns-inside-columns: all preserved
// verbatim so output is pixel-identical to the boilerplate you approved.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(__dir, 'styles.css'), 'utf8');

const esc = (s='') => String(s).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));

// image or halftone fallback (exact demo markup)
const plate = (img, caption) => {
  const cap = caption ? `<figcaption>${esc(caption)}</figcaption>` : '';
  return img
    ? `<figure class="plate"><img src="${img}" alt="${esc(caption)}" loading="lazy">${cap}</figure>`
    : `<figure class="plate plate-halftone"><div class="halftone-fill"></div>${cap}</figure>`;
};

const quoteBlock = (q) => q
  ? `<div class="quote">${esc(q.quote)}<span class="attr">— ${esc(q.attribution)}</span></div>` : '';

// s = section content object. Each returns the INNER html for its slot.
// The writer (LLM) fills: bodyHtml, quotes, pull, dek. Engine fills: boxes/tables.

export function broadsheetTemplate({
  leagueName, season, week, isReview, s = {}, identity,
  images = [], tagline = 'Malloy', volume = 'I', issueNo,
  formLink = '',
}) {
  // Volume = season - 2025, so 2026 = Vol. 1, 2027 = Vol. 2, etc. (the paper's first
  // year is 2026). No. = the week. Fall back to the passed volume if season is odd.
  const seasonYear = parseInt(season, 10);
  const volNum = Number.isFinite(seasonYear) ? Math.max(1, seasonYear - 2025) : volume;

  // images: no captions — photos stand on their own.
  const ledeImg    = plate(images[0], '');
  const deskImg    = plate(images[1], '');
  const backImg    = plate(images[2], '');
  const featureImg = ''; // unused slot (kept as empty so rivalry falls back cleanly)
  const midImg     = ''; // unused slot

  const L = s.lead || {};
  const race = s.playoffRace; // present only mid-season
  const bracket = s.playoffBracket; // present only in the postseason

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Hetero Herald — ${isReview ? `${season} Season in Review` : `Week ${week}, ${season}`}</title>
<style>${CSS}</style>
</head><body>
<div class="sheet">

  <div class="flag-top">
    <span>Vol. ${volNum} · No. ${issueNo||week}</span>
    <span>“All The Points That Fit, We Print”</span>
    <span>Dynasty Edition</span>
  </div>
  <div class="masthead">
    <div class="sub">The Newspaper of Record for the League of</div>
    <h1>The Hetero Herald</h1>
    <div class="sub">${esc(leagueName)} · Established 2023 · Fourteen Franchises, One Truth</div>
  </div>
  <div class="flag-bottom">
    <span>${isReview ? `${season} Season in Review` : `Week ${week} · ${season} Season`}</span>
    <span class="price"></span>
    <span>Filed by V. Malloy</span>
  </div>

  <!-- LEDE -->
  <div class="lede-grid">
    <div class="lede-main">
      <div class="kicker">${esc(L.kicker||'')}</div>
      <h1 class="hed">${esc(L.hed||'')}</h1>
      <div class="dek">${esc(L.dek||'')}</div>
      <div class="byline">By Vince Malloy · Beat Writer, The Hetero Herald</div>
      <div class="body columns">${L.bodyHtml||''}</div>
      ${L.pull ? `<div class="pull">${esc(L.pull)}</div>` : ''}
    </div>
    <div class="lede-side">
      ${ledeImg}
      ${quoteBlock((L.quotes||[])[0])}
      ${L.sideBoxHtml||''}
    </div>
  </div>

  ${bracket ? `
  <!-- PLAYOFF BRACKET (postseason) -->
  <div style="border-top:3px double var(--rule);margin-top:26px;padding-top:20px">
    <h3 class="section">The Playoff Bracket <span>${esc(bracket.tag||'Postseason')}</span></h3>
    ${bracket.html||''}
  </div>` : ''}

  ${race ? `
  <!-- PLAYOFF RACE (regular season) -->
  <div style="border-top:3px double var(--rule);margin-top:26px;padding-top:20px">
    <h3 class="section">The Playoff Race <span>${esc(race.tag||`Clinch & Elimination · Wk ${week}`)}</span></h3>
    ${race.tiersHtml||''}
    ${race.determined ? '' : `<h3 class="section" style="font-size:16px;border-bottom-width:1px">What Needs to Happen <span>Scenarios</span></h3>
    <div style="columns:2;column-gap:28px">${race.scenariosHtml||''}</div>`}
  </div>` : ''}

  ${s.controversy ? `
  <!-- CONTROVERSY (submitted take or invented drama; always runs) -->
  <div style="border-top:3px double var(--rule);margin-top:26px;padding-top:20px">
    <h3 class="section">Controversy Corner <span>${esc(s.controversy.tag || (s.controversy.mode === 'submitted' ? 'Letters to the Editor' : 'Manufactured Outrage'))}</span></h3>
    <div class="cols-3" style="border-top:none;margin-top:0;padding-top:0">
      <div style="grid-column:1 / 3">
        <div class="body columns">${s.controversy.bodyHtml||''}</div>
        ${s.controversy.pull ? `<div class="cpull">${esc(s.controversy.pull)}</div>` : ''}
      </div>
      <div>
        ${s.controversy.mode === 'submitted'
          ? `<div class="box"><div class="box-h">Reader Submission</div><p style="font-style:italic">“${esc(s.controversy.submittedTake||'')}”</p><p style="font-size:11px;color:#5b5142;text-transform:uppercase;font-family:'Special Elite',monospace">— ${esc(s.controversy.submitter||'Anonymous')}</p></div>`
          : `<div class="box"><div class="box-h">Editor's Note</div><p style="font-style:italic;font-size:13px">No letters this week — so the Herald made its own trouble. Yours could be here next issue.</p></div>`}
        <div class="submit-cta">
          <div class="submit-cta-h">Got Drama? Air It Out.</div>
          <p>Send the Herald your hottest take, pettiest grievance, or wildest accusation. One gets featured every week.</p>
          <a class="submit-btn" href="${esc(formLink || '#')}" target="_blank" rel="noopener">${formLink ? 'Submit Your Take →' : 'League Submission Form →'}</a>
          ${formLink ? '' : `<p class="submit-note">Commissioner: set the form link to activate this button.</p>`}
        </div>
        ${deskImg}
      </div>
    </div>
  </div>` : ''}

  <!-- RIVALRY DESK -->
  ${s.rivalry ? `
  <div style="border-top:2px solid var(--rule);margin-top:26px;padding-top:20px">
    <h3 class="section">Rivalry Desk <span>${esc(s.rivalry.tag||'Multi-Year · The Long Memory')}</span></h3>
    <div class="cols-3" style="border-top:none;margin-top:0;padding-top:0">
      <div style="grid-column:1 / 3">
        <div class="body">${s.rivalry.bodyHtml||''}</div>
      </div>
      <div>${s.rivalry.boxHtml||featureImg}</div>
    </div>
  </div>` : ''}

  <!-- ROW: Upset + Bench Crime + Luck (weekly only — these mean nothing in the finale, and
       rendering the row unconditionally left three empty headings on the season review) -->
  ${(s.upset || s.benchReport || s.luck) ? `
  <div class="cols-3">
    <div>
      <h3 class="section">Upset of the Week <span>${esc(s.upset?.tag||'Cinderella')}</span></h3>
      <div class="body">${s.upset?.bodyHtml||''}</div>
    </div>
    <div>
      <h3 class="section">Bench Crime Report <span>${esc(s.benchReport?.tag||'Blotter')}</span></h3>
      ${s.benchReport?.boxHtml||''}
    </div>
    <div>
      <h3 class="section">The Luck Ledger <span>${esc(s.luck?.tag||'Fortune')}</span></h3>
      ${s.luck?.boxHtml||''}
      ${quoteBlock((s.luck?.quotes||[])[0])}
    </div>
  </div>` : ''}

  <!-- GAME OF THE YEAR (finale only) -->
  ${s.gameOfYear ? `
  <div style="border-top:2px solid var(--rule);margin-top:26px;padding-top:20px">
    <h3 class="section">Game of the Year <span>${esc(s.gameOfYear.tag||'The One We’ll Remember')}</span></h3>
    <div class="cols-2">
      <div class="body">${s.gameOfYear.bodyHtml||''}</div>
      <div>${s.gameOfYear.boxHtml||''}</div>
    </div>
  </div>` : ''}

  <!-- SHITTIEST MANAGER OF THE YEAR (finale only) -->
  ${s.shittiestManager ? `
  <div style="border-top:2px solid var(--rule);margin-top:26px;padding-top:20px">
    <h3 class="section">Shittiest Manager of the Year <span>${esc(s.shittiestManager.tag||'The Dishonour Roll')}</span></h3>
    <div class="body columns">${s.shittiestManager.bodyHtml||''}</div>
  </div>` : ''}

  <!-- SEASON SUPERLATIVES + FINAL STANDINGS (finale) — or Power Rankings + Standings (weekly) -->
  ${s.superlatives ? `
  <div class="cols-3" style="border-top:2px solid var(--rule);margin-top:26px;padding-top:20px">
    <div style="grid-column:1 / 3;">
      <h3 class="section">${esc(s.superlatives.hed||'The Season in Numbers')} <span>${esc(s.superlatives.tag||'The Record Book')}</span></h3>
      <div class="box" style="margin-top:8px">${s.superlatives.rowsHtml||''}</div>
    </div>
    <div>
      <h3 class="section">${esc(s.standings?.hed||'Final Standings')} <span>Standings</span></h3>
      ${s.standings?.tableHtml||''}
    </div>
  </div>` : `
  <div class="cols-3">
    <div style="grid-column:1 / 3;">
      <h3 class="section">Malloy's Power Rankings <span>${esc(s.powerRankings?.tag||`Week ${week} · Op-Ed`)}</span></h3>
      <div class="body">${s.powerRankings?.bodyHtml||''}</div>
    </div>
    <div>
      <h3 class="section">${esc(s.standings?.hed||`After Week ${week}`)} <span>Standings</span></h3>
      ${s.standings?.tableHtml||''}
    </div>
  </div>`}

  <!-- TRADE WINDS (rumor mill) -->
  ${s.tradeWinds ? `
  <div style="border-top:2px solid var(--rule);margin-top:26px;padding-top:20px">
    <h3 class="section">Trade Winds <span>${esc(s.tradeWinds.tag||'Rumor Mill · Unconfirmed, Unbothered')}</span></h3>
    <div class="cols-3" style="border-top:none;margin-top:0;padding-top:0">
      <div style="grid-column:1 / 3">
        <div class="body columns">${s.tradeWinds.bodyHtml||''}</div>
      </div>
      <div>
        ${s.tradeWinds.boxHtml||''}
        ${quoteBlock((s.tradeWinds.quotes||[])[0])}
      </div>
    </div>
  </div>` : ''}

  <!-- THE TRADE DESK -->
  ${s.tradeDesk ? `
  <div style="border-top:2px solid var(--rule);margin-top:26px;padding-top:20px">
    <h3 class="section">The Trade Desk <span>${esc(s.tradeDesk.tag||'Front Office · Values via FantasyCalc')}</span></h3>
    <div class="cols-3" style="border-top:none;margin-top:0;padding-top:0">
      <div>${s.tradeDesk.tradesHtml||''}</div>
      <div>${s.tradeDesk.stalenessHtml||''}</div>
      <div>${s.tradeDesk.tiersHtml||''}</div>
    </div>
    ${s.tradeDesk.footnote ? `<p style="font-size:12px;font-style:italic;color:#5b5142;text-align:center;margin-top:4px">${esc(s.tradeDesk.footnote)}</p>` : ''}
    ${s.tradeDesk.agingHtml ? `
    <div class="aging-trade">
      <div class="box-h">Revisionist History <span style="color:var(--stamp)">How That Trade Aged</span></div>
      ${s.tradeDesk.agingHtml}
    </div>` : ''}
    ${s.gradeTrade ? `
    <div class="grade-trade">
      <div class="box-h">${esc(s.gradeTrade.hed)}</div>
      <div class="gt-sides">
        ${(s.gradeTrade.sides||[]).map(side => `
        <div class="gt-side">
          <div class="gt-team">${esc(side.name)}${side.grade ? `<span class="gt-grade">${esc(side.grade)}</span>` : ''}</div>
          <div class="gt-got">${(side.received||[]).map(p => esc(p)).join('<br>')}</div>
          ${side.value != null ? `<div class="gt-val">value ~${esc(String(side.value))}</div>` : ''}
        </div>`).join('<div class="gt-swap">\u21C4</div>')}
      </div>
      <div class="gt-verdict">${s.gradeTrade.verdictHtml}</div>
    </div>` : ''}
  </div>` : ''}

  ${midImg && s.midImageAfterTradeDesk ? `<div style="margin-top:20px">${midImg}</div>` : ''}

  <!-- OBITUARY (on elimination) -->
  ${s.obituary ? `
  <div class="obit" style="margin-top:26px">
    <div class="cross">✝</div>
    <h4>${esc(s.obituary.hed||'In Memoriam')}</h4>
    ${s.obituary.paragraphs && s.obituary.paragraphs.length
      ? s.obituary.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')
      : `<p>${esc(s.obituary.text||'')}</p>`}
  </div>` : ''}

  <!-- WEEK SCOREBOARD (all results, full-width) -->
  ${s.scoreboard ? `<div style="border-top:2px solid var(--rule);margin-top:26px;padding-top:20px">
    <h3 class="section">${esc(s.scoreboard.hed || 'Scoreboard')} <span>${esc(s.scoreboard.tag || 'Every Result')}</span></h3>
    <div class="scoreboard">${s.scoreboard.rowsHtml || ''}</div>
  </div>` : ''}

  <!-- BACK PAGE FEATURE PHOTO -->
  <div style="border-top:2px solid var(--rule);margin-top:26px;padding-top:20px">
    <div class="cols-3" style="border-top:none;margin-top:0;padding-top:0">
      <div>${backImg}</div>
      <div style="grid-column:2 / 4;display:flex;align-items:center">
        <p style="font-family:'Playfair Display',serif;font-style:italic;font-size:18px;color:#5b5142;margin:0">${esc(s.backPageCaption || 'That\u2019s the week. The scores are final, the excuses are eternal, and Malloy will be here next Tuesday whether you like it or not.')}</p>
      </div>
    </div>
  </div>

  <div class="foot">
    <span>The Hetero Herald · Est. 2023</span>
    <span>${esc(tagline)}</span>
    <span>${isReview ? 'The Final Issue · See You Next Season' : `Next Issue: Week ${week+1}`}</span>
  </div>

</div>
</body></html>`;
}
