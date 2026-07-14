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
import { buildRevisionist, alreadySnapGraded } from './revisionist.js';
import { valueAt, hasSnapshot } from './trade-values.js';

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

    // GRADE THE TRADE — a report card on a trade, judged on the values FROM THE WEEK IT WAS
    // MADE (not today's). That's the honest question for a fresh trade — "was this fair at the
    // time?" — and it keeps this cleanly separate from Revisionist History, whose whole job is
    // then-vs-now.
    //
    // It also works through a BACKLOG: several trades in one week are graded ONE PER WEEK
    // (this week's, then last week's leftovers), and a persistent memory means a trade is
    // never graded twice — which is exactly what was happening, with week 2 re-grading the
    // trade week 1 had already covered.
    try {
      const playerName = (pid) => playerMap[String(pid)]?.name || `Player ${pid}`;
      const rosterName = (rid) => identity.nameOf(rid);
      // Newest first, and look back far enough that a BACKLOG actually drains. With a strict
      // "this week or last week" window, three trades in one week would strand the third
      // forever: by the time the queue reached it, its week had fallen out of range. We
      // consider any trade from this season that hasn't been graded yet, newest first, so
      // recent deals are always covered first and older ones still get their turn.
      const candidates = trades
        .filter(t => t.week != null && t.week <= week)
        .filter(t => !alreadySnapGraded(t.transaction_id))
        .sort((a, b) => (b.week - a.week) || (b.when - a.when));

      for (const t of candidates) {
        // Value the trade with the snapshot from ITS OWN week. If we never captured that week
        // (we started collecting later), fall back to the live values rather than skip the
        // grade entirely — a fresh trade is still worth a report card, and unlike Revisionist
        // nothing here is claiming to be a historical comparison.
        const useSnapshot = hasSnapshot(season, t.week);
        const valuesFor = useSnapshot
          ? new Proxy({}, { get: (_, pid) => valueAt(season, t.week, String(pid)) ?? 0 })
          : fcValues;
        const graded = gradeWeeklyTrades([t], t.week, valuesFor, playerName, rosterName);
        const pick = graded[0];
        if (pick && pick.sides?.length === 2) {
          gradeThisTrade = { ...pick, gradedWeek: t.week, valuedFrom: useSnapshot ? `week ${t.week}` : 'current' };
          break;                                   // ONE per week
        }
      }
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
