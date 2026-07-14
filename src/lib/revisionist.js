// REVISIONIST HISTORY — "How That Trade Aged"
//
// Looks BACK at old trades and asks: what did each side get, what was it worth THEN, and
// what is it worth NOW? The interesting ones are the trades whose value has diverged
// dramatically since — a star who cratered, a throw-in who exploded.
//
// Two things keep it honest:
//   * "Value then" comes from the banked weekly snapshot for the trade's own week. If we
//     never captured that week (we started collecting later), the trade simply isn't
//     eligible — we do NOT substitute today's values and pretend.
//   * GRADED ONCE, EVER. A trade that has been covered is recorded permanently and never
//     resurfaces, so it can't be re-told week after week.
//
// Dynasty framing is left to the writer: a value gap is NOT automatically a blunder (a
// contender paying a premium for win-now, or a rebuilder selling a vet, are both strategies),
// and trades sometimes just don't pan out with nobody at fault.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { valueAt, hasSnapshot } from './trade-values.js';

const CACHE = './data-cache';
const GRADED_FILE = `${CACHE}/revisionist-graded.json`;

// --- "graded once ever" memory (keyed by Sleeper transaction id) ---
function loadGraded() {
  if (!existsSync(GRADED_FILE)) return { graded: {} };
  try { return JSON.parse(readFileSync(GRADED_FILE, 'utf8')); } catch { return { graded: {} }; }
}
function saveGraded(store) {
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
  writeFileSync(GRADED_FILE, JSON.stringify(store));
}
export function alreadyGraded(tradeId) {
  return !!loadGraded().graded[String(tradeId)];
}
export function markGraded(tradeId, meta = {}) {
  const store = loadGraded();
  store.graded[String(tradeId)] = { at: Date.now(), ...meta };
  saveGraded(store);
}

// current value lookup from the live FantasyCalc payload.
// Accepts either the {sleeperId: value} map getFantasyCalcValues() returns, or a raw row array.
function currentValueMap(fcValues) {
  const m = {};
  if (!fcValues) return m;
  if (Array.isArray(fcValues)) {
    for (const row of fcValues) {
      const pid = row?.player?.sleeperId ?? row?.sleeperId ?? row?.player_id;
      const val = row?.value ?? row?.redraftValue ?? null;
      if (pid != null && val != null) m[String(pid)] = val;
    }
  } else if (typeof fcValues === 'object') {
    for (const [pid, val] of Object.entries(fcValues)) {
      if (val != null) m[String(pid)] = val;
    }
  }
  return m;
}

// What each side RECEIVED in a trade (Sleeper puts acquisitions in `adds`: {playerId: rosterId})
function sidesOf(trade, rosterToOwner) {
  const bySide = {};   // rosterId -> [playerIds received]
  for (const [pid, rid] of Object.entries(trade.adds || {})) {
    (bySide[rid] ??= []).push(pid);
  }
  return bySide;
}

/**
 * Pick the single most interesting OLD trade and build the then-vs-now comparison.
 * Returns null when nothing qualifies (no eligible trade / no snapshot / all already graded),
 * in which case the section simply doesn't appear — it's modular, like Grade the Trade.
 */
export function buildRevisionist({
  trades, season, currentWeek, fcValues, playerName, ownerName,
  minWeeksAgo = 3,        // must have had time to actually age
  minDivergence = 800,    // combined value swing worth writing about
} = {}) {
  // fcValues may be an object map or an array — treat "has any entries" as the real check
  const hasValues = fcValues && (Array.isArray(fcValues) ? fcValues.length : Object.keys(fcValues).length);
  if (!trades?.length || !season || !currentWeek || !hasValues) return null;
  const nowMap = currentValueMap(fcValues);

  const candidates = [];
  for (const t of trades) {
    const tradeWeek = t.week;
    if (!tradeWeek || (currentWeek - tradeWeek) < minWeeksAgo) continue;   // too fresh to have aged
    if (alreadyGraded(t.transaction_id)) continue;                          // graded once, ever
    if (!hasSnapshot(season, tradeWeek)) continue;                          // we never banked that week — skip honestly

    const bySide = sidesOf(t);
    const rosterIds = Object.keys(bySide);
    if (rosterIds.length !== 2) continue;    // keep it to clean two-team trades

    const sides = [];
    let ok = true;
    for (const rid of rosterIds) {
      const pids = bySide[rid];
      let then = 0, now = 0;
      for (const pid of pids) {
        const vThen = valueAt(season, tradeWeek, pid);
        const vNow = nowMap[String(pid)] ?? 0;      // dropped/retired players are worth ~0 now
        if (vThen == null) { ok = false; break; }   // no "then" value -> can't tell the story
        then += vThen; now += vNow;
      }
      if (!ok) break;
      sides.push({
        roster_id: Number(rid),
        received: pids.map(p => playerName(p)),
        valueThen: Math.round(then),
        valueNow: Math.round(now),
        delta: Math.round(now - then),
      });
    }
    if (!ok || sides.length !== 2) continue;

    // how much did the picture MOVE? (the whole point — we want divergence, not fairness)
    const divergence = Math.abs(sides[0].delta) + Math.abs(sides[1].delta);
    if (divergence < minDivergence) continue;

    // did the verdict actually FLIP? (who looked better then vs. who looks better now)
    const thenLeader = sides[0].valueThen >= sides[1].valueThen ? 0 : 1;
    const nowLeader  = sides[0].valueNow  >= sides[1].valueNow  ? 0 : 1;

    candidates.push({
      transaction_id: t.transaction_id,
      week: tradeWeek,
      weeksAgo: currentWeek - tradeWeek,
      sides,
      divergence,
      flipped: thenLeader !== nowLeader,
      thenLeader, nowLeader,
    });
  }

  if (!candidates.length) return null;

  // most interesting = a trade whose verdict FLIPPED, else the biggest divergence
  candidates.sort((a, b) => (Number(b.flipped) - Number(a.flipped)) || (b.divergence - a.divergence));
  return candidates[0];
}

// A short, plain-English reason for a side's swing (shown on the card, demo-style).
export function deltaReason(side) {
  const d = side.delta;
  if (d <= -2000) return 'cratered';
  if (d <= -800) return 'slid';
  if (d < 800 && d > -800) return 'held firm';
  if (d < 2000) return 'climbed';
  return 'exploded';
}
