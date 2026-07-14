// Season database. The accumulating record of the CURRENT season's games, one
// entry per week. `generate` appends each week; `regenerate` upserts; `sync-season`
// backfills all played weeks. Standings / playoff race / power-ranking movement all
// read from here, so they reflect real cumulative records — not one week's scores.
//
// Shape: data-cache/season-<leagueId>.json
//   { leagueId, season, weeks: { "1": [game,...], "2": [...] }, rankings: { "7": [...] } }
// A "game" is the parseWeek shape: {winner,loser,winnerPts,loserPts,margin,...}

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const DIR = './data-cache';
const file = (leagueId) => `${DIR}/season-${leagueId}.json`;

export function loadSeason(leagueId) {
  const f = file(leagueId);
  if (!existsSync(f)) return { leagueId, season: null, weeks: {}, rankings: {} };
  try { return JSON.parse(readFileSync(f)); }
  catch { return { leagueId, season: null, weeks: {}, rankings: {} }; }
}

export function saveSeason(db) {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  writeFileSync(file(db.leagueId), JSON.stringify(db, null, 2));
}

// Upsert one week's games (add if new, REPLACE if the week already exists — no dupes).
export function upsertWeek(leagueId, season, week, games) {
  const db = loadSeason(leagueId);
  db.season = season;
  db.weeks[String(week)] = games;
  saveSeason(db);
  return db;
}

// All weeks up to and INCLUDING `throughWeek`, as an array-of-weeks for buildStandings.
// (Temporal scoping: a Week-8 issue only sees weeks 1..8, never the future.)
export function weeksThrough(leagueId, throughWeek) {
  const db = loadSeason(leagueId);
  const out = [];
  for (let w = 1; w <= throughWeek; w++) {
    if (db.weeks[String(w)]) out.push(db.weeks[String(w)]);
  }
  return out;
}

// Save a week's power-ranking order (array of roster_ids, best->worst) so next week
// can compute real movement.
export function saveRankings(leagueId, week, orderedRosterIds) {
  const db = loadSeason(leagueId);
  db.rankings = db.rankings || {};
  db.rankings[String(week)] = orderedRosterIds;
  saveSeason(db);
}

// Previous week's ranking order (for movement arrows). Returns array or null.
export function prevRankings(leagueId, week) {
  const db = loadSeason(leagueId);
  for (let w = week - 1; w >= 1; w--) {
    if (db.rankings?.[String(w)]) return db.rankings[String(w)];
  }
  return null;
}

// --- Trade Winds rumor memory: remember which teams/topics we've gossiped about, so we
// don't repeat the same rumor and can escalate a persistent hole. Keyed by week. ---
export function saveRumors(leagueId, week, rumorSubjects) {
  const db = loadSeason(leagueId);
  db.rumors = db.rumors || {};
  db.rumors[String(week)] = rumorSubjects; // array of { roster_id, pos, topic }
  saveSeason(db);
}

// All rumor subjects from PRIOR weeks (for repeat-avoidance + escalation).
export function priorRumors(leagueId, week) {
  const db = loadSeason(leagueId);
  const out = [];
  if (db.rumors) {
    for (const w of Object.keys(db.rumors)) {
      if (Number(w) < week) for (const s of db.rumors[w]) out.push({ ...s, week: Number(w) });
    }
  }
  return out;
}
