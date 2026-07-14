// COMMAND: npm run sync-season
//          npm run sync-season -- --through 8   (only weeks 1..8)
//
// Backfills the CURRENT season's played weeks into the season database. Run this
// once when starting mid-season, or to rebuild after a bug. Normal weekly operation
// does NOT need this — `generate` appends each week as it runs. This is the
// catch-up / recovery command.

import { getLeague, getMatchups, getUsers, getRosters } from '../lib/sleeper.js';
import { parseWeek, buildStandings } from '../lib/analyze.js';
import { upsertWeek, loadSeason, saveRankings, weeksThrough } from '../lib/season-db.js';

const LEAGUE_ID = process.env.LEAGUE_ID || '1323107533136596992';

// Performance-weighted power-rank order for a set of standings (matches render.js).
function rankOrder(standings) {
  return [...standings].map(s => {
    const g = s.wins + s.losses;
    const winPct = g ? s.wins / g : 0;
    return { roster_id: s.roster_id, score: (s.avg || 0) * 0.7 + winPct * 100 * 0.3 };
  }).sort((a, b) => b.score - a.score).map(r => r.roster_id);
}

function args() {
  const a = process.argv.slice(2); const o = { through: null };
  for (let i = 0; i < a.length; i++) if (a[i] === '--through') o.through = +a[++i];
  return o;
}

async function run() {
  const o = args();
  const league = await getLeague(LEAGUE_ID);
  const season = league.season;
  const playoffStart = league.settings?.playoff_week_start ?? 15;
  const regWeeks = playoffStart - 1;
  const lastScored = league.settings?.last_scored_leg ?? 0;
  // Sync EVERY scored week, including the playoffs (15-17) — not just the regular season.
  // The season DB is what standings, this-season rivalry meetings and locked playoff seeds
  // read from, so capping this at regWeeks meant a playoff-week paper was computing off
  // incomplete data — and a playoff meeting between two rivals never counted as a
  // this-season meeting, which is exactly the game a rivalry most wants to talk about.
  // (It also made the bootstrap re-run this every single time, since weeks 15-17 could
  // never appear no matter how often it backfilled.)
  const through = o.through ?? (lastScored || regWeeks);

  console.log(`Syncing ${season} season (${league.name}) — weeks 1..${through}...`);

  let added = 0;
  for (let wk = 1; wk <= through; wk++) {
    try {
      const matchups = await getMatchups(LEAGUE_ID, wk);
      const games = parseWeek(matchups);
      if (games.length) { upsertWeek(LEAGUE_ID, season, wk, games); added++; console.log(`  ✓ week ${wk} (${games.length} games)`); }
      else console.log(`  – week ${wk}: no games`);
    } catch (e) { console.log(`  ✗ week ${wk}: ${e.message}`); }
  }

  // Compute + save each week's power-ranking order (cumulative through that week),
  // so movement arrows work immediately after a backfill.
  try {
    const rosters = await getRosters(LEAGUE_ID);
    const rosterIds = rosters.map(r => r.roster_id);
    for (let wk = 1; wk <= through; wk++) {
      const weeks = weeksThrough(LEAGUE_ID, wk);
      if (!weeks.length) continue;
      const standings = buildStandings(rosterIds, weeks);
      saveRankings(LEAGUE_ID, wk, rankOrder(standings));
    }
    console.log('  ✓ saved weekly power rankings (movement arrows enabled)');
  } catch (e) { console.log(`  ✗ ranking save: ${e.message}`); }

  const db = loadSeason(LEAGUE_ID);
  console.log(`\nDone. Database now holds ${Object.keys(db.weeks).length} weeks for ${season}.`);
}

run().catch(e => { console.error(e); process.exit(1); });
