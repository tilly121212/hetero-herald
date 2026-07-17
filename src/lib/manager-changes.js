// MANAGER CHANGES — departure/arrival detection + ledger.
//
// A "departure" is a roster that changed hands: the owner_id on roster N differs from the
// owner_id we last saw on roster N. We detect it by comparing the LIVE league against a
// rolling owner snapshot we persist every run. This is precise: it catches every hand-change,
// including a roster that changes twice (off-season, then again mid-season).
//
// The VERY FIRST run has no snapshot yet, so it seeds its baseline from history.json's most
// recent PRIOR season — which is how the off-season swap (last-year's owner -> this-year's
// fill-in) is caught even though we never ran during the switch. After that, the rolling
// snapshot is the baseline.
//
// Two persisted files (both preserved across a rollover reset):
//   data-cache/owners-<leagueId>.json   the rolling { roster_id: owner_id } snapshot + names
//   data-cache/manager-changes.json     the append-only departure ledger (with announced flag)
//
// The ledger drives the Week-1 (or immediate mid-season) Controversy Corner takeover. Each
// distinct hand-change is announced EXACTLY ONCE (deduped by roster_id+oldOwner+newOwner).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const CACHE = './data-cache';
const ownersFile = (leagueId) => `${CACHE}/owners-${leagueId}.json`;
const LEDGER = `${CACHE}/manager-changes.json`;

function ensureCache() { if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true }); }

// ---- rolling owner snapshot -----------------------------------------------------------
export function loadOwnerSnapshot(leagueId) {
  const f = ownersFile(leagueId);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}

function saveOwnerSnapshot(leagueId, season, rosterToOwner, ownerNames) {
  ensureCache();
  writeFileSync(ownersFile(leagueId),
    JSON.stringify({ leagueId: String(leagueId), season, savedAt: Date.now(), rosterToOwner, ownerNames }, null, 2));
}

// ---- departure ledger -----------------------------------------------------------------
function loadLedger() {
  if (!existsSync(LEDGER)) return { changes: [] };
  try { return JSON.parse(readFileSync(LEDGER, 'utf8')); } catch { return { changes: [] }; }
}
function saveLedger(db) { ensureCache(); writeFileSync(LEDGER, JSON.stringify(db, null, 2)); }

const changeKey = (rid, oldO, newO) => `${rid}|${oldO ?? ''}|${newO ?? ''}`;

// Un-announced departures for a season (what Controversy Corner should lead with).
export function pendingDepartures(season) {
  return loadLedger().changes.filter(c => !c.announced && String(c.season) === String(season));
}

// Flip a set of ledger entries to announced (so they never resurface).
export function markDeparturesAnnounced(entries) {
  if (!entries?.length) return;
  const db = loadLedger();
  const keys = new Set(entries.map(e => changeKey(e.roster_id, e.oldOwnerId, e.newOwnerId)));
  for (const c of db.changes) {
    if (keys.has(changeKey(c.roster_id, c.oldOwnerId, c.newOwnerId))) c.announced = true;
  }
  saveLedger(db);
}

/**
 * Detect roster hand-changes and append any new ones to the ledger, then update the snapshot.
 *
 * currentRosters : Sleeper /league/{id}/rosters   (each has roster_id, owner_id)
 * currentUsers   : Sleeper /league/{id}/users     (each has user_id, display_name, metadata.team_name)
 * season         : the current season (string/number)
 * history        : parsed history.json (for first-run baseline seeding); may be null
 *
 * Returns the array of NEWLY-logged departures (may be empty).
 */
export function detectDepartures(leagueId, currentRosters, currentUsers, season, history = null) {
  const currentRosterToOwner = {};
  for (const r of currentRosters) currentRosterToOwner[r.roster_id] = r.owner_id ?? null;

  // name lookup for the CURRENT league
  const currentOwnerName = {};
  for (const u of currentUsers) {
    currentOwnerName[u.user_id] = u.metadata?.team_name || u.display_name || `Owner ${u.user_id}`;
  }

  // Baseline: the rolling snapshot if we have one, else seed from history.json's prior season.
  let baseRosterToOwner = null, baseNames = {};
  const snap = loadOwnerSnapshot(leagueId);
  if (snap?.rosterToOwner) {
    baseRosterToOwner = snap.rosterToOwner;
    baseNames = snap.ownerNames || {};
  } else if (history?.seasons?.length) {
    // most-recent PRIOR season = the newest season in the chain that isn't the current one.
    const prior = history.seasons.find(s => String(s.season) !== String(season)) || history.seasons[1] || null;
    if (prior?.rosterToOwner) {
      baseRosterToOwner = prior.rosterToOwner;
      baseNames = history.ownerNames || {};
    }
  }

  const newlyLogged = [];
  if (baseRosterToOwner) {
    const db = loadLedger();
    const seen = new Set(db.changes.map(c => changeKey(c.roster_id, c.oldOwnerId, c.newOwnerId)));
    for (const [rid, newOwner] of Object.entries(currentRosterToOwner)) {
      const oldOwner = baseRosterToOwner[rid];
      // a hand-change: both sides known, and the owner actually differs
      if (oldOwner == null || newOwner == null) continue;
      if (String(oldOwner) === String(newOwner)) continue;
      const key = changeKey(rid, oldOwner, newOwner);
      if (seen.has(key)) continue;
      const entry = {
        roster_id: Number(rid),
        oldOwnerId: oldOwner,
        newOwnerId: newOwner,
        oldName: baseNames[oldOwner] || `Owner ${oldOwner}`,
        newName: currentOwnerName[newOwner] || `Owner ${newOwner}`,
        season: String(season),
        detectedAt: Date.now(),
        announced: false,
      };
      db.changes.push(entry);
      seen.add(key);
      newlyLogged.push(entry);
    }
    if (newlyLogged.length) saveLedger(db);
  }

  // Advance the rolling baseline to the current live state.
  saveOwnerSnapshot(leagueId, season, currentRosterToOwner, currentOwnerName);

  return newlyLogged;
}
