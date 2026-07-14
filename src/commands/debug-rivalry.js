// COMMAND: node src/commands/debug-rivalry.js "Chase" "Merry"
// Traces EXACTLY what the rivalry engine counts for two teams, showing each meeting and
// its SOURCE (history.json vs live season DB), so double-counts are obvious.

import { existsSync, readFileSync } from 'node:fs';
import { buildIdentity } from '../lib/identity.js';
import { loadSeason } from '../lib/season-db.js';
import { getUsers, getRosters } from '../lib/sleeper.js';

const LEAGUE_ID = process.env.LEAGUE_ID || '1188998801032708096';
const [, , A = 'Chase', B = 'Merry'] = process.argv;

function loadHistory() {
  try { if (existsSync('./data-cache/history.json')) return JSON.parse(readFileSync('./data-cache/history.json')); } catch {}
  return null;
}

async function run() {
  console.log(`\n=== RIVALRY DEBUG: /${A}/ vs /${B}/  (league ${LEAGUE_ID}) ===\n`);

  const users = await getUsers(LEAGUE_ID);
  const rosters = await getRosters(LEAGUE_ID);
  const identity = buildIdentity(users, rosters, { name: 'debug', season: 'x' });
  const nameOfOwner = (oid) => identity.nameOfOwner ? identity.nameOfOwner(oid) : oid;

  // find the two owners by matching current team names
  const match = (s) => new RegExp(A, 'i').test(s) || new RegExp(B, 'i').test(s);
  const owners = [];
  for (const r of rosters) {
    const nm = identity.nameOfOwner(r.owner_id) || '';
    if (match(nm)) owners.push({ owner: r.owner_id, roster: r.roster_id, name: nm });
  }
  console.log('Matched teams:');
  owners.forEach(o => console.log(`  roster ${o.roster} / owner ${o.owner} = ${o.name}`));
  if (owners.length < 2) { console.log('\n(need two matching teams — check the name filters)'); return; }
  const oa = owners[0].owner, ob = owners[1].owner;

  // 1) HISTORY.JSON games between them
  const hist = loadHistory();
  const histGames = hist?.games || [];
  const histMatch = histGames.filter(g =>
    (g.win === oa && g.lose === ob) || (g.win === ob && g.lose === oa));
  console.log(`\n--- history.json (${histGames.length} total games; seasons: ${[...new Set(histGames.map(g => g.season))].sort().join(', ')}) ---`);
  console.log(`history.json meetings between them: ${histMatch.length}`);
  histMatch.forEach(g => console.log(`   [HIST] ${g.season} W${g.week}: ${nameOfOwner(g.win)} ${g.ws} def. ${nameOfOwner(g.lose)} ${g.ls}`));

  // 2) LIVE SEASON DB games between them
  const season = loadSeason(LEAGUE_ID);
  const dbWeeks = season?.weeks || {};
  const ownerOf = (rid) => identity.ownerOf(rid);
  let dbMatch = [];
  for (const wk of Object.keys(dbWeeks)) {
    for (const gm of dbWeeks[wk]) {
      const wo = ownerOf(gm.winner), lo = ownerOf(gm.loser);
      if ((wo === oa && lo === ob) || (wo === ob && lo === oa)) {
        dbMatch.push({ wk, wo, lo, ws: gm.winnerPts, ls: gm.loserPts });
      }
    }
  }
  console.log(`\n--- live season DB (season ${season?.season}; weeks present: ${Object.keys(dbWeeks).sort((a,b)=>a-b).join(', ')}) ---`);
  console.log(`live DB meetings between them: ${dbMatch.length}`);
  dbMatch.forEach(g => console.log(`   [DB] ${season?.season} W${g.wk}: ${nameOfOwner(g.wo)} ${g.ws} def. ${nameOfOwner(g.lo)} ${g.ls}`));

  // 3) OVERLAP CHECK — does history.json contain the SAME season as the live DB?
  const histSeasons = new Set(histMatch.map(g => String(g.season)));
  const dbSeason = String(season?.season);
  const overlap = histSeasons.has(dbSeason);
  console.log(`\n--- DIAGNOSIS ---`);
  console.log(`history.json meetings (ALL seasons) : ${histMatch.length}`);
  console.log(`live DB meetings (current season)   : ${dbMatch.length}`);
  console.log(`current season (${dbSeason}) present in history.json? ${overlap ? 'YES' : 'no'}`);
  // The v1.1.8 fix: history is filtered to EXCLUDE the current season, so the paper counts
  // history(prior seasons only) + live DB(current). Show what that corrected total is.
  const histPriorOnly = histMatch.filter(g => String(g.season) !== dbSeason);
  console.log(`\nBEFORE fix (double-counted): ${histMatch.length + dbMatch.length}`);
  console.log(`AFTER fix (history prior-seasons-only + live current): ${histPriorOnly.length + dbMatch.length}`);
  console.log(`  -> prior-season meetings: ${histPriorOnly.length}`);
  histPriorOnly.forEach(g => console.log(`       ${g.season} W${g.week}: ${nameOfOwner(g.win)} def. ${nameOfOwner(g.lose)}`));
  console.log(`  -> current-season meetings: ${dbMatch.length}`);
  console.log('');
}

run().catch(e => { console.error(e); process.exit(1); });
