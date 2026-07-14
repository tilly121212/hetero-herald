// COMMAND: npm run generate   (this is what GitHub Actions runs on a schedule)
// The automatic pipeline. Every run: sync -> detect state -> decide -> write.
// Handles weekly issues, year-end review, and offseason dormancy automatically.

import { syncPlayers, detectState, decideAction, syncLeague } from '../lib/sync.js';
import { buildIdentity } from '../lib/identity.js';
import * as A from '../lib/analyze.js';
import { renderIssue } from '../render/render.js';
import { writeIssue, loadPublished, markPublished } from '../lib/publish.js';
import { pickImages } from '../lib/images.js';
import { upsertWeek } from '../lib/season-db.js';
import { getWinners } from '../lib/sleeper.js';
import { loadFrontOffice } from '../lib/frontoffice.js';

const LEAGUE_ID = process.env.LEAGUE_ID || '1323107533136596992';

async function run() {
  console.log('[1/5] Syncing players + league state (always first, keeps league current)...');
  const playerMap = await syncPlayers();        // auto-refresh every run
  const state = await detectState(LEAGUE_ID);
  console.log(`      Season ${state.season} · phase ${state.phase} · last scored week ${state.lastScored}`);

  console.log('[2/5] Deciding action...');
  const published = loadPublished();
  const action = decideAction(state, published);
  console.log('      ->', action.type, action.week ? `week ${action.week}` : (action.reason || action.season || ''));

  if (action.type === 'SLEEP') {
    console.log('      Nothing to publish. Paper stays dormant. Done.');
    return;
  }

  console.log('[3/5] Pulling week data + running engines...');
  const week = action.type === 'WEEKLY' ? action.week : state.regWeeks;
  const { players, users, rosters, matchups } = await syncLeague(LEAGUE_ID, week);
  const identity = buildIdentity(users, rosters, { name: state.leagueName, season: state.season });

  // append this just-completed week to the season database (upsert = no dupes)
  const games = A.parseWeek(matchups);
  upsertWeek(LEAGUE_ID, state.season, week, games);
  const rosterIds = rosters.map(r => r.roster_id);
  const imgsRaw = pickImages({ season: state.season, week, count: 3, dir: './images' });
  const images = imgsRaw.map(p => (p.startsWith('./') ? '../' + p.slice(2) : '../' + p));
  let bracket = null;
  if (week > state.regWeeks) {
    try { const b = await getWinners(LEAGUE_ID); if (Array.isArray(b) && b.length) bracket = b; } catch {}
  }

  // Trade Desk + Trade Winds intel (trader tiers, staleness, Grade the Trade, Revisionist
  // History, roster depth/age profiles) AND this week's write-once trade-value snapshot.
  // Shared with regenerate.js so the scheduled paper and a hand-run paper are identical.
  const fo = await loadFrontOffice(LEAGUE_ID, rosters, identity, week, playerMap, state.season)
    .catch(e => { console.log('      (front-office data unavailable:', e.message + ')'); return {}; });

  const facts = { season: state.season, week, leagueId: LEAGUE_ID, leagueName: state.leagueName,
                  identity, games, players, images, rosterIds, regWeeks: state.regWeeks, playerMap, bracket,
                  playoffStart: state.playoffStart,
                  staleness: fo.staleness, traderTiers: fo.traderTiers, gradeThisTrade: fo.gradeThisTrade,
                  revisionist: fo.revisionist, rosterDepth: fo.rosterDepth, rosterProfiles: fo.rosterProfiles };

  console.log('[4/5] Writing articles via LLM provider:', process.env.LLM_PROVIDER || 'anthropic');
  const html = await renderIssue(action, facts);   // calls writer.js under the hood

  console.log('[5/5] Publishing...');
  const path = writeIssue(action, html);           // writes docs/week-N.html (GitHub Pages dir)
  markPublished(action);
  console.log('      Wrote', path, '— done.');
}

run().catch(e => { console.error(e); process.exit(1); });
