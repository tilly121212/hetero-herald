// COMMAND: npm run regenerate -- --week 8
//          npm run regenerate -- --review
//          npm run regenerate -- --week 8 --provider anthropic   (swap LLM for this run)
//
// Force-rebuilds ONE already-published issue from live data. Unlike `generate`
// (which decides what's due and refuses to double-post), this deliberately
// overwrites a specific issue — for fixing a glitch, re-rolling the writing, or
// regenerating after switching LLM providers. It re-pulls fresh data, re-writes,
// and overwrites the existing file. It does NOT touch the published ledger's
// ordering or other weeks.

import { syncPlayers, syncLeague, detectState } from '../lib/sync.js';
import { buildIdentity } from '../lib/identity.js';
import * as A from '../lib/analyze.js';
import { renderIssue } from '../render/render.js';
import { writeIssue } from '../lib/publish.js';
import { pickImages } from '../lib/images.js';
import { upsertWeek } from '../lib/season-db.js';
import { getTransactions, getWinners } from '../lib/sleeper.js';
import { loadFrontOffice } from '../lib/frontoffice.js';

// Build staleness (days since last trade, 90+ flagged) + trader tiers from this
// season's transactions. Reaches into prior years if history.json exists.

const LEAGUE_ID = process.env.LEAGUE_ID || '1323107533136596992';

function args(){
  const a = process.argv.slice(2);
  const o = { week: null, review: false, provider: process.env.LLM_PROVIDER || 'anthropic' };
  for (let i=0;i<a.length;i++){
    if (a[i]==='--week') o.week = +a[++i];
    else if (a[i]==='--review') o.review = true;
    else if (a[i]==='--provider') o.provider = a[++i];
  }
  return o;
}

async function run(){
  const o = args();
  if (o.week == null && !o.review){
    console.log('Specify what to regenerate:');
    console.log('  npm run regenerate -- --week 8');
    console.log('  npm run regenerate -- --review');
    console.log('  npm run regenerate -- --week 8 --provider openai');
    process.exit(1);
  }

  // let a per-run provider override the env, so you can A/B LLMs on the same week
  process.env.LLM_PROVIDER = o.provider;

  console.log(`Regenerating ${o.review ? 'the season review' : `Week ${o.week}`} using provider "${o.provider}"...`);
  console.log('  (force overwrite — bypasses the double-post guard)\n');

  console.log('[1/4] Syncing players + league state...');
  const playerMap = await syncPlayers();
  const state = await detectState(LEAGUE_ID);
  const week = o.review ? state.regWeeks : o.week;

  console.log('[2/4] Pulling week data + running engines...');
  const { users, rosters, matchups } = await syncLeague(LEAGUE_ID, week);
  const identity = buildIdentity(users, rosters, { name: state.leagueName, season: state.season });
  const games = A.parseWeek(matchups);
  // upsert this week into the season database (replace if already present — no dupes)
  upsertWeek(LEAGUE_ID, state.season, week, games);
  const rosterIds = rosters.map(r => r.roster_id);
  // load photos; output lands in docs/, so paths climb one level to /images
  const imgsRaw = pickImages({ season: state.season, week, count: 3, dir: './images' });
  const images = imgsRaw.map(p => (p.startsWith('./') ? '../' + p.slice(2) : '../' + p));
  // trade-desk data (staleness + tiers) from multi-year history if present
  // Trade Desk + Trade Winds intel AND this week's write-once trade-value snapshot.
  // Shared with generate.js (the scheduled run) so both produce an identical paper.
  const fo = await loadFrontOffice(LEAGUE_ID, rosters, identity, week, playerMap, state.season)
    .catch(e => { console.log('   (front-office data unavailable:', e.message + ')'); return {}; });
  const { staleness, traderTiers, gradeThisTrade, revisionist, rosterDepth, rosterProfiles } = fo;
  // playoff bracket — only exists once the postseason has started (week > regWeeks).
  let bracket = null;
  if (week > state.regWeeks) {
    try { const b = await getWinners(LEAGUE_ID); if (Array.isArray(b) && b.length) bracket = b; } catch {}
  }
  const facts = { season: state.season, week, leagueId: LEAGUE_ID, leagueName: state.leagueName,
    identity, games, images, rosterIds, regWeeks: state.regWeeks, staleness, traderTiers, gradeThisTrade, revisionist, rosterDepth, rosterProfiles, playerMap, bracket, playoffStart: state.playoffStart };

  const action = o.review
    ? { type: 'YEAR_REVIEW', season: state.season }
    : { type: 'WEEKLY', season: state.season, week };

  console.log(`[3/4] Re-writing articles via ${o.provider}...`);
  const html = await renderIssue(action, facts);

  console.log('[4/4] Overwriting the existing issue file...');
  const path = writeIssue(action, html);   // same filename -> overwrites in place
  console.log('      Wrote', path);
  console.log('\n✓ Regenerated. The published archive keeps its order; only this issue changed.');
}

run().catch(e => { console.error(e); process.exit(1); });
