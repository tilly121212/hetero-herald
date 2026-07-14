// Shared "front office" data loader.
//
// This exists because generate.js (what GitHub Actions runs every Tuesday) and
// regenerate.js (what we run by hand) MUST produce the same paper. They had drifted:
// regenerate loaded all the trade/roster intel while generate didn't, so the live weekly
// paper would silently have shipped with an empty Trade Desk, no Trader Tiers, no Grade
// the Trade, no Revisionist History, and a generic Trade Winds — while local tests looked
// perfect. Both commands now call this one function.

import { getTransactions } from './sleeper.js';
import * as A from './analyze.js';
import { collectTrades, tradeRecency, traderTiers, getFantasyCalcValues, gradeWeeklyTrades } from './tradedesk.js';
import { recordSnapshot } from './trade-values.js';
import { buildRevisionist } from './revisionist.js';

/**
 * Everything the Trade Desk / Trade Winds sections need.
 * Safe by design: any single piece failing leaves that piece null rather than killing the run
 * (the sections are all modular and simply don't render without their data).
 */
export async function loadFrontOffice(leagueId, rosters, identity, week, playerMap = {}, season = null, lastScored = null) {
  const rosterIds = rosters.map(r => r.roster_id);
  const ownerIds = rosters.map(r => r.owner_id).filter(Boolean);
  const ownerName = (oid) => (identity.nameOfOwner ? identity.nameOfOwner(oid) : identity.nameOf(oid));
  const rosterToOwner = Object.fromEntries(rosters.map(r => [r.roster_id, r.owner_id]));

  // --- trades across the season (roster ids -> durable owner ids) ---
  const txnByWeek = {};
  for (let wk = 1; wk <= 18; wk++) {
    try { const t = await getTransactions(leagueId, wk); if (t?.length) txnByWeek[wk] = t; } catch {}
  }
  const trades = collectTrades(txnByWeek, rosterToOwner);

  const staleness = tradeRecency(rosterIds, trades, (rid) => identity.nameOf(rid))
    .map(t => ({ name: t.name, days: t.daysSince, never: t.daysSince == null }))
    .sort((a, b) => (b.days ?? 1e9) - (a.days ?? 1e9));

  const tiers = traderTiers(ownerIds, trades, {}, ownerName)
    .map(t => ({ name: t.name, tier: t.tier, count: t.trades }));

  // --- live values + the weekly snapshot that Revisionist History depends on ---
  let fcValues = null, gradeThisTrade = null, revisionist = null;
  try {
    fcValues = await getFantasyCalcValues();
  } catch { fcValues = null; }

  // getFantasyCalcValues() returns a { sleeperId: value } MAP (not an array), so check entries
  const hasValues = fcValues && (Array.isArray(fcValues) ? fcValues.length : Object.keys(fcValues).length);
  if (hasValues && season && week) {
    // BANK THIS WEEK'S VALUES — but ONLY if this is genuinely the current week.
    //
    // FantasyCalc has no historical endpoint: it always returns TODAY'S values. That's fine
    // in live operation (the paper runs the Tuesday right after a week ends, so today's
    // values ARE that week's values). It is NOT fine when back-filling: publishing week 3
    // months later would stamp today's values onto week 3 and quietly poison the store with
    // fake history — and Revisionist History's whole "value then vs value now" rests on it.
    // The data is unrecoverable once wrong, so we simply refuse to snapshot a past week.
    //
    // "Current" = the week being published is the latest one that's been scored. When we
    // don't know lastScored, we don't guess — we skip, because a missing snapshot is
    // recoverable next week but a corrupt one is forever.
    const isCurrentWeek = lastScored != null && Number(week) >= Number(lastScored);
    if (isCurrentWeek) {
      try {
        const res = recordSnapshot(season, week, fcValues);
        if (res.written) console.log(`      \u2713 banked trade-value snapshot for week ${week} (${res.count} players)`);
      } catch {}
    } else {
      console.log(`      \u00b7 week ${week} is historical (latest scored: ${lastScored}) \u2014 not banking a snapshot (today's values aren't week ${week}'s values)`);
    }

    // GRADE THE TRADE — a FRESH trade (this week or one back), graded on current values.
    try {
      const playerName = (pid) => playerMap[String(pid)]?.name || `Player ${pid}`;
      const rosterName = (rid) => identity.nameOf(rid);
      let graded = [];
      for (const w of [week, week - 1]) {
        const g = gradeWeeklyTrades(trades, w, fcValues, playerName, rosterName).map(x => ({ ...x, gradedWeek: w }));
        graded = graded.concat(g);
        if (graded.length) break;              // prefer the most recent week that had a trade
      }
      graded.sort((a, b) => b.delta - a.delta);   // one per week: the most lopsided
      const pick = graded[0];
      if (pick && pick.sides?.length === 2) gradeThisTrade = pick;
    } catch { gradeThisTrade = null; }

    // REVISIONIST HISTORY — an OLD trade whose value has since diverged. Needs a banked
    // "value then" snapshot from the trade's own week; if we never captured it, we skip
    // rather than pretending today's values were the values back then.
    try {
      revisionist = buildRevisionist({
        trades, season, currentWeek: week, fcValues,
        playerName: (pid) => playerMap[String(pid)]?.name || `Player ${pid}`,
        ownerName,
      });
    } catch { revisionist = null; }
  }

  // --- roster intel for Trade Winds ---
  let rosterDepth = [], rosterProfiles = [];
  try { rosterDepth = A.rosterDepthAnalysis(rosters, playerMap, (rid) => identity.nameOf(rid)); } catch {}
  try { rosterProfiles = A.rosterAgeProfiles(rosters, playerMap, null, (rid) => identity.nameOf(rid)); } catch {}

  return { staleness, traderTiers: tiers, gradeThisTrade, revisionist, rosterDepth, rosterProfiles };
}
