// COMMAND: npm run build-history
// One-time (or occasional re-sync) build of the multi-year database that powers
// rivalries, all-time trader tiers, and champion history. Chains backward through
// every previous_league_id and stores a compact history.json.

import { getLeagueHistory, getUsers, getRosters, getMatchups, getWinners } from '../lib/sleeper.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const LEAGUE_ID = process.env.LEAGUE_ID || '1323107533136596992'; // 2026 Hetero Heroes
const OUT = './data-cache';

async function run() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  console.log('Chaining league history from', LEAGUE_ID, '...');

  const chain = await getLeagueHistory(LEAGUE_ID); // [current, ...older]
  console.log(`Found ${chain.length} seasons:`, chain.map(l => `${l.season} (${l.name})`).join(' → '));

  const history = { builtAt: Date.now(), seasons: [], games: [], champions: [], ownerNames: {} };

  for (const league of chain) {
    const lid = league.league_id;
    const done = league.status === 'complete';
    const [users, rosters] = await Promise.all([getUsers(lid), getRosters(lid)]);

    // durable owner names (latest wins as we go newest->oldest, so current name sticks)
    for (const u of users) {
      if (!history.ownerNames[u.user_id])
        history.ownerNames[u.user_id] = u.metadata?.team_name || u.display_name;
    }
    const rosterToOwner = Object.fromEntries(rosters.map(r => [r.roster_id, r.owner_id]));

    history.seasons.push({ league_id: lid, season: league.season, name: league.name,
                            status: league.status, rosterToOwner });

    if (league.metadata?.latest_league_winner_roster_id) {
      history.champions.push({ season: league.season,
        owner_id: rosterToOwner[league.metadata.latest_league_winner_roster_id] });
    }

    // pull completed weeks' matchups to build the all-time head-to-head game log
    if (done) {
      const playoffStart = league.settings?.playoff_week_start ?? 15;
      const regWeeks = playoffStart - 1;
      // regular season
      for (let wk = 1; wk <= regWeeks; wk++) {
        try {
          const m = await getMatchups(lid, wk);
          const byId = {};
          for (const row of m) (byId[row.matchup_id] ??= []).push(row);
          for (const pair of Object.values(byId)) {
            if (pair.length !== 2) continue;
            const [a, b] = pair.sort((x, y) => y.points - x.points);
            history.games.push({
              season: league.season, week: wk,
              win: rosterToOwner[a.roster_id], lose: rosterToOwner[b.roster_id],
              ws: a.points, ls: b.points,
              playoff: false,
            });
          }
        } catch { /* week may not exist */ }
      }
      // PLAYOFFS — pull only the WINNERS-bracket games (ignore consolation/losers).
      // The winners_bracket gives round + roster IDs + winner; map each bracket game to its
      // week (round r plays in week playoffStart + r - 1) to fetch scores.
      try {
        const wb = await getWinners(lid);
        if (Array.isArray(wb) && wb.length) {
          // a WINNERS-bracket game is one NOT fed by a loser and NOT a placement game below 1st
          const isWinners = (g) =>
            !(g.t1_from && g.t1_from.l != null) && !(g.t2_from && g.t2_from.l != null) &&
            (g.p == null || g.p === 1);
          const scoreCache = {};
          for (const g of wb) {
            if (!isWinners(g)) continue;
            if (g.t1 == null || g.t2 == null || g.w == null) continue;
            const wk = playoffStart + (g.r - 1);
            if (!scoreCache[wk]) {
              try {
                const mm = await getMatchups(lid, wk);
                const map = {}; mm.forEach(row => { map[row.roster_id] = row.points; });
                scoreCache[wk] = map;
              } catch { scoreCache[wk] = {}; }
            }
            const sc = scoreCache[wk];
            const wPts = sc[g.w] ?? 0, lPts = sc[g.l] ?? 0;
            history.games.push({
              season: league.season, week: wk,
              win: rosterToOwner[g.w], lose: rosterToOwner[g.l],
              ws: wPts, ls: lPts,
              playoff: true,
            });
          }
        }
      } catch { /* no bracket / not a completed postseason */ }
    }
  }

  writeFileSync(`${OUT}/history.json`, JSON.stringify(history, null, 2));
  console.log(`\nWrote history.json — ${history.games.length} games, ${history.champions.length} champions, ${Object.keys(history.ownerNames).length} owners across ${history.seasons.length} seasons.`);
}

run().catch(e => { console.error(e); process.exit(1); });
