// Two of the originally-requested sections that were missing from the demo:
//   1) RIVALRIES — multi-year head-to-head, "rivalry of the week" selection
//   2) TRADE RUMORS — detect a real positional need, phrase it as sourced gossip

import { rivalry } from './analyze.js';

// ---- RIVALRY OF THE WEEK ----
// Given this week's games and the full historical game log, surface the matchup
// with the richest history: most meetings, tightest all-time margin, or a streak.
export function rivalryOfWeek(thisWeekGames, historicalGames, thisSeasonGames, ownerName) {
  let best = null;
  for (const g of thisWeekGames) {
    const r = rivalry(g.winner, g.loser, historicalGames, thisSeasonGames);
    if (r.meetings < 2) continue; // need history to be a rivalry
    // score: meetings matter most, then how even it is, then playoff history
    const evenness = 1 - Math.abs(r.aWins - r.bWins) / Math.max(1, r.meetings);
    const score = r.meetings * 2 + evenness * 3 + (r.lastPlayoff ? 4 : 0);
    if (!best || score > best.score) best = { game: g, r, score };
  }
  if (!best) return null;
  const { game, r } = best;
  return {
    a: game.winner, b: game.loser,
    aName: ownerName(game.winner), bName: ownerName(game.loser),
    allTime: `${r.aWins}-${r.bWins}`,
    meetings: r.meetings,
    closest: r.closest, biggest: r.biggest, lastPlayoff: r.lastPlayoff,
    thisWeek: { winnerPts: game.winnerPts, loserPts: game.loserPts },
  };
}

// Full rivalry table for a standalone "Rivalries" section: every pair that has
// met 3+ times, with all-time record and current streak in the matchup.
export function allRivalries(rosterIds, historicalGames, thisSeasonGames, ownerName, minMeetings = 3) {
  const out = [];
  for (let i = 0; i < rosterIds.length; i++) {
    for (let j = i + 1; j < rosterIds.length; j++) {
      const a = rosterIds[i], b = rosterIds[j];
      const r = rivalry(a, b, historicalGames, thisSeasonGames);
      if (r.meetings >= minMeetings) {
        out.push({ a, b, aName: ownerName(a), bName: ownerName(b),
                   meetings: r.meetings, record: `${r.aWins}-${r.bWins}`,
                   closest: r.closest, biggest: r.biggest });
      }
    }
  }
  return out.sort((x, y) => y.meetings - x.meetings);
}

// ---- TRADE RUMORS (positional need -> tabloid gossip) ----
// Real detection: for each team, compute starting-lineup strength by position
// using FantasyCalc values. A position is a "need" if the team's best option
// there is well below league median for that slot.
//
// rostersWithPlayers: [{ roster_id, players:[playerId], starters:[playerId] }]
// values: { playerId -> value }, playerPos: { playerId -> 'QB'|'RB'|... }
export function detectTradeNeeds(rostersWithPlayers, values, playerPos, ownerName) {
  const positions = ['QB', 'RB', 'WR', 'TE'];
  // Build, per team, their best value at each position.
  const teamBest = rostersWithPlayers.map(r => {
    const best = {};
    for (const pos of positions) best[pos] = 0;
    for (const pid of (r.players ?? [])) {
      const pos = playerPos[pid];
      const val = values[String(pid)] ?? 0;
      if (positions.includes(pos)) best[pos] = Math.max(best[pos], val);
    }
    return { roster_id: r.roster_id, name: ownerName(r.roster_id), best };
  });
  // League median best-at-position.
  const median = {};
  for (const pos of positions) {
    const arr = teamBest.map(t => t.best[pos]).sort((a, b) => a - b);
    median[pos] = arr[Math.floor(arr.length / 2)] || 0;
  }
  // A need = your best at a position is < 60% of league median there.
  const rumors = [];
  for (const t of teamBest) {
    for (const pos of positions) {
      if (median[pos] > 0 && t.best[pos] < 0.6 * median[pos]) {
        rumors.push({
          roster_id: t.roster_id, name: t.name, position: pos,
          severity: +(1 - t.best[pos] / median[pos]).toFixed(2), // how big the hole is
        });
      }
    }
  }
  // Strongest needs first — those are the juiciest rumors.
  return rumors.sort((a, b) => b.severity - a.severity);
}
