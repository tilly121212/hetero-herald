// TRADE VALUE RETENTION
//
// FantasyCalc only ever serves CURRENT player values — there is no historical endpoint.
// That means a week's values, once missed, are gone forever. This module banks a snapshot
// of every player's value each week so we can later answer "what was this player worth
// WHEN the trade was made?" — which is the whole basis of Revisionist History.
//
// Two rules make this safe:
//   1. WRITE-ONCE per week. Once week N is recorded we NEVER overwrite it. Re-running
//      `regenerate --week N` months later would otherwise stamp TODAY'S values onto week N
//      and silently corrupt the then-vs-now comparison.
//   2. The file is PRESERVED by `npm run reset` (its name matches the protected pattern in
//      reset.js), because unlike everything else in data-cache it cannot be rebuilt.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const CACHE = './data-cache';
const FILE = `${CACHE}/trade-values.json`;   // name MUST stay matched by reset.js's PRESERVE list

// shape: { snapshots: { "<season>-<week>": { takenAt, values: { [playerId]: value } } } }
export function loadValueStore() {
  if (!existsSync(FILE)) return { snapshots: {} };
  try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return { snapshots: {} }; }
}

function saveValueStore(store) {
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
  writeFileSync(FILE, JSON.stringify(store));
}

const keyFor = (season, week) => `${season}-${week}`;

export function hasSnapshot(season, week) {
  return !!loadValueStore().snapshots[keyFor(season, week)];
}

// Record this week's values. WRITE-ONCE: if the week already exists we keep the original
// and do nothing, so a later regenerate can never corrupt historical values.
// `values` may be either the {sleeperId: value} map that getFantasyCalcValues() returns,
// or a raw FantasyCalc row array — both are accepted.
export function recordSnapshot(season, week, fcValues) {
  if (!season || !week || !fcValues) return { written: false, reason: 'no data' };
  const store = loadValueStore();
  const k = keyFor(season, week);
  if (store.snapshots[k]) return { written: false, reason: 'already recorded (write-once)' };

  const values = {};
  if (Array.isArray(fcValues)) {
    for (const row of fcValues) {
      const pid = row?.player?.sleeperId ?? row?.sleeperId ?? row?.player_id;
      const val = row?.value ?? row?.redraftValue ?? null;
      if (pid != null && val != null) values[String(pid)] = val;
    }
  } else if (typeof fcValues === 'object') {
    // the shape getFantasyCalcValues() actually returns: { [sleeperId]: value }
    for (const [pid, val] of Object.entries(fcValues)) {
      if (val != null) values[String(pid)] = val;
    }
  }
  if (!Object.keys(values).length) return { written: false, reason: 'no usable values' };

  store.snapshots[k] = { takenAt: Date.now(), values };
  saveValueStore(store);
  return { written: true, count: Object.keys(values).length };
}

// Value of a player in a given week, or null if we never captured that week.
export function valueAt(season, week, playerId) {
  const snap = loadValueStore().snapshots[keyFor(season, week)];
  if (!snap) return null;
  const v = snap.values[String(playerId)];
  return v == null ? null : v;
}

// The EARLIEST snapshot we hold at-or-after a given week (a trade made in week 3 may only
// have a week-5 snapshot behind it if we started collecting late — better than nothing, and
// we report which week we actually used so the copy can stay honest).
export function nearestSnapshotWeek(season, week) {
  const store = loadValueStore();
  const weeks = Object.keys(store.snapshots)
    .filter(k => k.startsWith(`${season}-`))
    .map(k => Number(k.split('-')[1]))
    .filter(n => !isNaN(n))
    .sort((a, b) => a - b);
  if (!weeks.length) return null;
  // prefer the snapshot taken in the trade's own week; else the closest one AFTER it
  const exact = weeks.find(w => w === week);
  if (exact != null) return exact;
  const after = weeks.find(w => w > week);
  return after ?? null;
}

// How many weeks we've banked (for logging / "is Revisionist ready yet").
export function snapshotCount(season = null) {
  const snaps = loadValueStore().snapshots;
  const keys = Object.keys(snaps);
  return season ? keys.filter(k => k.startsWith(`${season}-`)).length : keys.length;
}
