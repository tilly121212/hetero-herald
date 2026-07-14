// Sleeper API client. Public API, no auth. Base: https://api.sleeper.app/v1
// NOTE: runs on YOUR machine where Sleeper is reachable. In this sandbox the
// host is blocked, so mock.js mirrors these exact shapes for local testing.

const BASE = 'https://api.sleeper.app/v1';

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`Sleeper ${path} -> ${res.status}`);
  return res.json();
}

export const getLeague    = (id)       => get(`/league/${id}`);
export const getUsers     = (id)       => get(`/league/${id}/users`);
export const getRosters   = (id)       => get(`/league/${id}/rosters`);
export const getMatchups  = (id, week) => get(`/league/${id}/matchups/${week}`);
export const getTransactions = (id, week) => get(`/league/${id}/transactions/${week}`);
export const getWinners   = (id)       => get(`/league/${id}/winners_bracket`);
export const getState     = ()         => get(`/state/nfl`);

// Walk previous_league_id backward to assemble every season the league existed.
// This is the multi-year thread that powers all-time rivalry + revenge tracking.
export async function getLeagueHistory(currentId) {
  const chain = [];
  let id = currentId;
  while (id) {
    const league = await getLeague(id);
    chain.push(league);
    id = league.previous_league_id; // null when we hit the founding season
  }
  return chain; // [thisSeason, lastSeason, ..., foundingSeason]
}
