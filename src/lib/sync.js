// Sync layer. EVERY pipeline run starts here so the league is always up to date
// before a single word is written. Handles the yearly league-ID rollover and the
// season state machine (offseason / in-season / championship) automatically.

import { getLeague, getUsers, getRosters, getMatchups, getState, getLeagueHistory } from './sleeper.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const CACHE = './data-cache';
const PLAYERS_FILE = `${CACHE}/players.json`;
const PLAYERS_URL = 'https://api.sleeper.app/v1/players/nfl'; // ~5MB, refresh sparingly

// Player ID -> name/position map. Auto-refreshed if missing or older than 7 days.
// Called at the START of every run so "6813" always resolves to a real name.
export async function syncPlayers({ maxAgeDays = 7 } = {}) {
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
  let stale = true;
  if (existsSync(PLAYERS_FILE)) {
    const ageMs = Date.now() - JSON.parse(readFileSync(PLAYERS_FILE)).fetchedAt;
    stale = ageMs > maxAgeDays * 864e5;
  }
  if (stale) {
    const res = await fetch(PLAYERS_URL);
    const raw = await res.json();
    const slim = {};
    for (const [id, p] of Object.entries(raw)) {
      slim[id] = { name: p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
                   pos: p.position, team: p.team, age: p.age ?? null };
    }
    writeFileSync(PLAYERS_FILE, JSON.stringify({ fetchedAt: Date.now(), players: slim }));
    return slim;
  }
  return JSON.parse(readFileSync(PLAYERS_FILE)).players;
}

// Determine what the paper should DO right now, from live Sleeper state.
// Returns { phase, season, currentWeek, lastScoredWeek, leagueId, ... }
export async function detectState(leagueId) {
  const [nfl, league] = await Promise.all([getState(), getLeague(leagueId)]);
  const currentWeek = nfl.week;                      // NFL week
  const status = league.status;                      // pre_draft|drafting|in_season|complete
  const playoffStart = league.settings?.playoff_week_start ?? 15;
  const regWeeks = playoffStart - 1;
  const lastScored = league.settings?.last_scored_leg ?? 0;

  let phase;
  if (status === 'pre_draft' || status === 'drafting') phase = 'PREGAME';
  else if (status === 'complete') phase = 'SEASON_DONE';
  else if (currentWeek <= 1) phase = 'OFFSEASON_WAKING'; // dormant until wk1 concludes
  else phase = 'IN_SEASON';

  // championship concluded? (last playoff week scored)
  const champWeek = playoffStart + 2; // typical 3-round bracket end; adjust per league
  const championshipDone = status === 'complete' ||
    (league.metadata?.latest_league_winner_roster_id != null);

  return {
    leagueId, season: league.season, status, phase,
    currentWeek, lastScored, regWeeks, playoffStart, championshipDone,
    leagueName: league.name, previousLeagueId: league.previous_league_id,
    winnerRosterId: league.metadata?.latest_league_winner_roster_id ?? null,
  };
}

// Decide the single action for this run.
//
// Rules:
//  * CATCH UP, NEVER SKIP. We publish the OLDEST completed week that hasn't gone out yet —
//    not just the newest. If a Tuesday is missed (Actions outage, API blip), the next run
//    picks the gap up instead of silently moving on. One issue per run, so re-running the
//    workflow repeatedly will walk through a backlog in order.
//  * WEEK 17 IS THE FINALE. The last playoff week (playoffStart + 2) is published as the
//    Season in Review — the championship game AND the year's retrospective in one issue.
//    It is the final publication of the season; nothing goes out after it.
//  * START GUARD. FIRST_PUBLISH (YYYY-MM-DD) can hold the paper until the date the first
//    real week is complete, so nothing goes out mid-week-1 or in the preseason.
export function decideAction(state, alreadyPublished, { today = new Date() } = {}) {
  // alreadyPublished: { weeks:Set, yearReview:Set(seasons) }

  // --- start-date guard -----------------------------------------------------------------
  // e.g. FIRST_PUBLISH=2026-09-15 (the Tuesday after Week 1 finishes). Before that, sleep.
  const firstPublish = process.env.FIRST_PUBLISH;
  if (firstPublish) {
    const gate = new Date(`${firstPublish}T00:00:00Z`);
    if (!isNaN(gate) && today < gate) {
      return { type: 'SLEEP', reason: `holding until first publish date (${firstPublish})` };
    }
  }

  if (state.phase === 'PREGAME') return { type: 'SLEEP', reason: 'season not started' };

  const champWeek = state.playoffStart + 2;   // the championship week = the finale

  // --- catch up: oldest unpublished COMPLETED week wins ----------------------------------
  // Weeks below the championship week publish as normal issues.
  const lastScored = state.lastScored ?? 0;
  const lastNormal = Math.min(lastScored, champWeek - 1);
  for (let w = 1; w <= lastNormal; w++) {
    if (!alreadyPublished.weeks.has(`${state.season}-w${w}`)) {
      return { type: 'WEEKLY', season: state.season, week: w };
    }
  }

  // --- the finale: week 17, championship + season review --------------------------------
  // Only once every earlier week is out, and only once that week has actually been scored.
  const champDone = state.championshipDone || lastScored >= champWeek;
  if (champDone && !alreadyPublished.yearReview.has(state.season)) {
    return { type: 'YEAR_REVIEW', season: state.season, week: champWeek };
  }

  return { type: 'SLEEP', reason: 'nothing new to publish' };
}

// Full sync: players + this week's data, ready for the engines.
export async function syncLeague(leagueId, week) {
  const players = await syncPlayers();
  const [users, rosters, matchups] = await Promise.all([
    getUsers(leagueId), getRosters(leagueId),
    week ? getMatchups(leagueId, week) : Promise.resolve([]),
  ]);
  return { players, users, rosters, matchups };
}
