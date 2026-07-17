// COMMAND: npm run generate   (this is what GitHub Actions runs on a schedule)
// The automatic pipeline. Every run: sync -> detect state -> decide -> write.
// Handles weekly issues, year-end review, and offseason dormancy automatically.

import { syncPlayers, detectState, decideAction, syncLeague } from '../lib/sync.js';
import { buildIdentity } from '../lib/identity.js';
import * as A from '../lib/analyze.js';
import { renderIssue } from '../render/render.js';
import { writeIssue, loadPublished, markPublished, syncImagesToDocs } from '../lib/publish.js';
import { pickImages } from '../lib/images.js';
import { upsertWeek } from '../lib/season-db.js';
import { getWinners } from '../lib/sleeper.js';
import { loadFrontOffice } from '../lib/frontoffice.js';
import { ensureSeeded } from '../lib/bootstrap.js';
import { existsSync, readFileSync } from 'node:fs';

const LEAGUE_ID = process.env.LEAGUE_ID || '1323107533136596992';

async function run() {
  console.log('[1/5] Syncing players + league state (always first, keeps league current)...');
  const playerMap = await syncPlayers();        // auto-refresh every run
  const state = await detectState(LEAGUE_ID);
  console.log(`      Season ${state.season} · phase ${state.phase} · last scored week ${state.lastScored}`);

  console.log('[2/5] Deciding action...');
  const published = loadPublished();
  // Optional manual override, set from the "Run workflow" button on GitHub (or an env var
  // locally): publish THIS specific week instead of letting the catch-up logic choose.
  // Blank/absent = normal behaviour (oldest unpublished week).
  const forced = process.env.PUBLISH_WEEK && String(process.env.PUBLISH_WEEK).trim();
  let action;
  if (forced && !isNaN(Number(forced))) {
    const w = Number(forced);
    const champWeek = state.playoffStart + 2;
    action = (w >= champWeek)
      ? { type: 'YEAR_REVIEW', season: state.season, week: champWeek }
      : { type: 'WEEKLY', season: state.season, week: w };
    console.log(`      (manual override: PUBLISH_WEEK=${w})`);
  } else {
    action = decideAction(state, published);
  }
  console.log('      ->', action.type, action.week ? `week ${action.week}` : (action.reason || action.season || ''));

  if (action.type === 'SLEEP') {
    // OFF-SEASON MAINTENANCE. The paper doesn't publish between the finale and next season,
    // but the league keeps moving — trades happen, managers leave and get replaced. We keep
    // the data current every Tuesday so the first issue of next year knows everything:
    //   1) refresh league history (self-heals after a rollover),
    //   2) detect manager departures/arrivals into the ledger,
    //   3) bank FantasyCalc value snapshots for any week Sleeper is filing trades under, so an
    //      off-season trade can later be valued honestly (FantasyCalc has no historical API —
    //      a value not banked now is gone forever). Trades themselves live permanently on
    //      Sleeper and are always re-fetched; the irreplaceable thing is the value snapshot.
    // Writes NO paper.
    console.log('      Off-season. No paper — running data maintenance only.');
    try {
      await ensureSeeded(LEAGUE_ID, state.lastScored);
      const { users, rosters } = await syncLeague(LEAGUE_ID);
      // manager changes
      try {
        const { detectDepartures } = await import('../lib/manager-changes.js');
        const history = existsSync('./data-cache/history.json')
          ? JSON.parse(readFileSync('./data-cache/history.json', 'utf8')) : null;
        const logged = detectDepartures(LEAGUE_ID, rosters, users, state.season, history);
        if (logged.length) logged.forEach(d => console.log(`      \u2713 logged manager change on roster ${d.roster_id}: ${d.oldName} \u2192 ${d.newName}`));
        else console.log('      \u00b7 no manager changes since last check');
      } catch (e) { console.log('      (manager-change detection skipped:', e.message + ')'); }
      // value snapshots for off-season trade weeks
      try {
        const { getFantasyCalcValues } = await import('../lib/tradedesk.js');
        const { getTransactions } = await import('../lib/sleeper.js');
        const { recordSnapshot } = await import('../lib/trade-values.js');
        const fc = await getFantasyCalcValues().catch(() => null);
        const hasV = fc && (Array.isArray(fc) ? fc.length : Object.keys(fc).length);
        if (hasV) {
          // find every week bucket that currently shows a trade, and bank a snapshot keyed to
          // it (write-once). This guarantees each off-season trade's week has a matching value
          // snapshot regardless of how Sleeper buckets off-season transactions.
          let banked = 0;
          for (let wk = 1; wk <= 18; wk++) {
            let txns = null;
            try { txns = await getTransactions(LEAGUE_ID, wk); } catch {}
            if (!txns?.some(t => t.type === 'trade' && t.status === 'complete')) continue;
            try { const res = recordSnapshot(state.season, wk, fc); if (res.written) { banked++; console.log(`      \u2713 banked value snapshot for week ${wk} (${res.count} players)`); } } catch {}
          }
          if (!banked) console.log('      \u00b7 no new off-season trade weeks to snapshot');
        } else {
          console.log('      (FantasyCalc values unavailable — no snapshot banked this run)');
        }
      } catch (e) { console.log('      (value-snapshot step skipped:', e.message + ')'); }
    } catch (e) { console.log('      (maintenance run hit an error:', e.message + ')'); }
    console.log('      Maintenance done. Paper stays dormant.');
    return;
  }

  // Make sure the cache actually matches this league before we write a paper. On a fresh
  // checkout — or the first run after LEAGUE_ID is pointed at a new season — this rebuilds
  // history.json and backfills the season DB automatically, so rivalry records, movement
  // arrows and standings aren't silently empty. No-op when the data is already good.
  await ensureSeeded(LEAGUE_ID, state.lastScored);

  console.log('[3/5] Pulling week data + running engines...');
  // decideAction now supplies the week for BOTH kinds of issue — including the year review,
  // which is anchored to the CHAMPIONSHIP week (17), not the last regular-season week. It
  // used to fall back to state.regWeeks (14), so the "review" was really a week-14 paper
  // that hadn't even seen the playoffs.
  const week = action.week ?? state.regWeeks;
  const { players, users, rosters, matchups } = await syncLeague(LEAGUE_ID, week);
  const identity = buildIdentity(users, rosters, { name: state.leagueName, season: state.season });

  // Catch mid-season manager changes too (roster changing hands during the year), so the
  // current issue's Controversy Corner can lead with it. Off-season changes are caught by the
  // maintenance path above; this covers the in-season case. Never fatal.
  try {
    const { detectDepartures } = await import('../lib/manager-changes.js');
    const history = existsSync('./data-cache/history.json')
      ? JSON.parse(readFileSync('./data-cache/history.json', 'utf8')) : null;
    const logged = detectDepartures(LEAGUE_ID, rosters, users, state.season, history);
    if (logged.length) logged.forEach(d => console.log(`      \u2713 manager change on roster ${d.roster_id}: ${d.oldName} \u2192 ${d.newName}`));
  } catch (e) { console.log('      (manager-change detection skipped:', e.message + ')'); }

  // append this just-completed week to the season database (upsert = no dupes)
  const games = A.parseWeek(matchups);
  upsertWeek(LEAGUE_ID, state.season, week, games);
  const rosterIds = rosters.map(r => r.roster_id);
  const imgsRaw = pickImages({ season: state.season, week, count: 3, dir: './images' });
  // Pages serves the site root from docs/, so reference images RELATIVE to docs (images/x.jpg),
  // not ../images/x.jpg which would climb above the site root and 404. syncImagesToDocs()
  // mirrors the files into docs/images/.
  syncImagesToDocs('./images');
  const images = imgsRaw.map(p => p.replace(/^\.\//, ''));   // './images/x.jpg' -> 'images/x.jpg'
  let bracket = null;
  if (week > state.regWeeks) {
    try { const b = await getWinners(LEAGUE_ID); if (Array.isArray(b) && b.length) bracket = b; } catch {}
  }

  // Trade Desk + Trade Winds intel (trader tiers, staleness, Grade the Trade, Revisionist
  // History, roster depth/age profiles) AND this week's write-once trade-value snapshot.
  // Shared with regenerate.js so the scheduled paper and a hand-run paper are identical.
  const fo = await loadFrontOffice(LEAGUE_ID, rosters, identity, week, playerMap, state.season, state.lastScored)
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
