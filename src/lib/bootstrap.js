// SELF-SEEDING BOOTSTRAP
//
// The scheduled run used to assume its data-cache was already populated. It wasn't — on a
// fresh checkout (or the first run after a new season's LEAGUE_ID is set) there is no
// history.json and no season DB, so the paper would come out with empty rivalry records,
// no power-ranking movement, and thin standings.
//
// This checks, before generating, whether the cache actually matches the league we're
// pointed at, and rebuilds it if not. Which means the ONLY thing you touch at season
// rollover is the LEAGUE_ID variable — the pipeline heals itself from there.

import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const HISTORY = './data-cache/history.json';

function runScript(file, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], {
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

// Is history.json present AND built for the league we're currently pointed at?
function historyMatchesLeague(leagueId) {
  if (!existsSync(HISTORY)) return false;
  try {
    const h = JSON.parse(readFileSync(HISTORY, 'utf8'));
    if (!h?.games?.length) return false;
    // Older files won't carry builtForLeague — treat them as usable rather than forcing a
    // needless multi-season refetch, but a MISMATCH means the season rolled over.
    if (h.builtForLeague && String(h.builtForLeague) !== String(leagueId)) return false;
    return true;
  } catch { return false; }
}

// Does the season DB hold every week that's already been scored?
function seasonDbIsCurrent(leagueId, lastScored) {
  const file = `./data-cache/season-${leagueId}.json`;
  if (!existsSync(file)) return false;
  try {
    const db = JSON.parse(readFileSync(file, 'utf8'));
    const have = Object.keys(db?.weeks || {}).map(Number);
    for (let w = 1; w <= lastScored; w++) if (!have.includes(w)) return false;
    return true;
  } catch { return false; }
}

/**
 * Make sure the cache is usable before we generate. Rebuilds only what's actually missing.
 * Safe to call every run: when the data is already good this is just two file reads.
 */
export async function ensureSeeded(leagueId, lastScored = 0) {
  const env = { LEAGUE_ID: String(leagueId) };

  if (!historyMatchesLeague(leagueId)) {
    console.log('      history.json missing or built for a different league — rebuilding...');
    const ok = await runScript('src/commands/build-history.js', env);
    console.log(ok ? '      \u2713 history rebuilt' : '      \u2717 history rebuild failed (continuing)');
  }

  if (lastScored >= 1 && !seasonDbIsCurrent(leagueId, lastScored)) {
    console.log(`      season DB missing played weeks (through ${lastScored}) — backfilling...`);
    const ok = await runScript('src/commands/sync-season.js', env);
    console.log(ok ? '      \u2713 season backfilled' : '      \u2717 season backfill failed (continuing)');
  }
}
