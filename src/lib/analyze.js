// Analytics engine. Turns raw Sleeper-shaped data into the structured "facts"
// the writer roasts. Every burn the paper makes must trace back to a number here.

// TEMPORAL SCOPING (critical): an issue for week W may only see weeks 1..W.
// Every generator run passes data through this first so future weeks can NEVER
// leak into an issue. When live this is automatic (future data doesn't exist),
// but for backfilling/regenerating past issues it's the hard guarantee.
export function scopeToWeek(weeklyDataByWeek, currentWeek) {
  const scoped = {};
  for (const [wk, data] of Object.entries(weeklyDataByWeek)) {
    if (Number(wk) <= currentWeek) scoped[wk] = data;
  }
  return scoped;
}

// --- Build per-week results from a matchups array ---
export function parseWeek(matchups) {
  const byMatchup = {};
  for (const m of matchups) {
    (byMatchup[m.matchup_id] ??= []).push(m);
  }
  const games = [];
  for (const pair of Object.values(byMatchup)) {
    if (pair.length !== 2) continue;
    const [a, b] = pair.sort((x, y) => y.points - x.points); // a = winner
    games.push({
      winner: a.roster_id, loser: b.roster_id,
      winnerPts: a.points, loserPts: b.points,
      margin: +(a.points - b.points).toFixed(2),
      winnerBench: a.custom?.bench_points ?? 0,
      loserBench:  b.custom?.bench_points ?? 0,
      winnerOptimal: a.custom?.optimal_points ?? a.points,
      loserOptimal:  b.custom?.optimal_points ?? b.points,
      // raw lineup data for bench-crime analysis (starters vs bench by position)
      lineups: {
        [a.roster_id]: { starters: a.starters || [], players: a.players || [], points: a.players_points || {} },
        [b.roster_id]: { starters: b.starters || [], players: b.players || [], points: b.players_points || {} },
      },
    });
  }
  return games;
}

// --- Season standings + rank trajectory from prior weekly scores ---
// priorScores: { week: [[roster_id, points], ...] } — pairs decided by schedule.
// For the mock we approximate W/L by ranking within the week isn't right, so we
// use actual head-to-head from matchups when available; here we derive a simple
// points-based proxy record for prior weeks plus exact record for played matchups.
export function buildStandings(rosterIds, weeklyGames) {
  const table = Object.fromEntries(rosterIds.map(id => [id, {
    roster_id: id, wins: 0, losses: 0, pf: 0, pa: 0,
    scores: [], results: [], // 'W'/'L' in order
  }]));
  for (const week of weeklyGames) {
    for (const g of week) {
      const w = table[g.winner], l = table[g.loser];
      w.wins++; l.losses++;
      w.pf += g.winnerPts; w.pa += g.loserPts;
      l.pf += g.loserPts;  l.pa += g.winnerPts;
      w.scores.push(g.winnerPts); l.scores.push(g.loserPts);
      w.results.push('W'); l.results.push('L');
    }
  }
  const arr = Object.values(table).map(t => ({
    ...t,
    pf: +t.pf.toFixed(1), pa: +t.pa.toFixed(1),
    avg: t.scores.length ? +(t.pf / t.scores.length).toFixed(1) : 0,
    streak: currentStreak(t.results),
  }));
  arr.sort((a, b) => b.wins - a.wins || b.pf - a.pf);
  return arr.map((t, i) => ({ ...t, rank: i + 1 }));
}

function currentStreak(results) {
  if (!results.length) return { type: null, len: 0 };
  const last = results[results.length - 1];
  let len = 0;
  for (let i = results.length - 1; i >= 0 && results[i] === last; i--) len++;
  return { type: last, len };
}

// --- Multi-year rivalry record between two rosters ---
export function rivalry(a, b, historicalGames, thisSeasonGames) {
  const all = [...historicalGames];
  // include this season's completed games
  for (const g of thisSeasonGames) {
    all.push({ season: 'current', week: g.week, win: g.winner, lose: g.loser,
               ws: g.winnerPts, ls: g.loserPts, playoff: g.playoff || false });
  }
  const meetings = all.filter(g =>
    (g.win === a && g.lose === b) || (g.win === b && g.lose === a));

  let aWins = 0, bWins = 0, closest = null, biggest = null, lastPlayoff = null;
  let aPF = 0, bPF = 0;                 // all-time points scored by each side in this matchup
  let aPlayoffWins = 0, bPlayoffWins = 0;
  let marginSum = 0;
  for (const g of meetings) {
    const aScored = g.win === a ? g.ws : g.ls;
    const bScored = g.win === b ? g.ws : g.ls;
    aPF += aScored; bPF += bScored;
    if (g.win === a) aWins++; else bWins++;
    if (g.playoff) { if (g.win === a) aPlayoffWins++; else bPlayoffWins++; }
    const margin = Math.abs(g.ws - g.ls);
    marginSum += margin;
    if (!closest || margin < closest.margin) closest = { ...g, margin };
    if (!biggest || margin > biggest.margin) biggest = { ...g, margin };
    if (g.playoff) lastPlayoff = g;
  }

  // chronological order for streak + last-5 (season then week; 'current' sorts last)
  const seasonKey = (s) => (s === 'current' ? 9999 : Number(s) || 0);
  const chrono = [...meetings].sort((x, y) => (seasonKey(x.season) - seasonKey(y.season)) || ((x.week || 0) - (y.week || 0)));
  // current streak: who has won the most recent consecutive meetings
  let streakOwner = null, streak = 0;
  for (let i = chrono.length - 1; i >= 0; i--) {
    const w = chrono[i].win;
    if (streakOwner == null) { streakOwner = w; streak = 1; }
    else if (w === streakOwner) streak++;
    else break;
  }
  const last5 = chrono.slice(-5).map(g => ({ season: g.season, week: g.week, win: g.win, lose: g.lose, ws: g.ws, ls: g.ls, playoff: !!g.playoff }));

  const n = meetings.length || 1;
  return {
    meetings: meetings.length, aWins, bWins, closest, biggest, lastPlayoff,
    aPF: +aPF.toFixed(2), bPF: +bPF.toFixed(2),
    pointDiff: +(aPF - bPF).toFixed(2),         // + means A has outscored B all-time
    avgMargin: +(marginSum / n).toFixed(2),
    aPlayoffWins, bPlayoffWins, playoffMeetings: aPlayoffWins + bPlayoffWins,
    streakOwner, streak,
    last5,
  };
}

// --- Compressed roster profiles for Trade Winds' strategic-misalignment rumors.
// For EVERY team, surface only the extremes that matter: the oldest few assets and the
// youngest few (flagged starter/bench), plus their record. The ENGINE makes no judgment
// about what counts as "aging" or "misaligned" — it just supplies facts. The LLM decides
// who's a rebuilder clutching declining vets, or a contender letting youth rot on the bench.
export function rosterAgeProfiles(rosters, playerMap, standings, nameOf, { topN = 4 } = {}) {
  const standBy = {};
  (standings || []).forEach(s => { standBy[s.roster_id] = s; });
  const out = [];
  for (const r of rosters) {
    const starters = new Set((r.starters || []).map(String));
    const players = (r.players || [])
      .map(pid => {
        const p = playerMap[String(pid)];
        if (!p || !p.pos || p.age == null) return null;
        if (!['QB', 'RB', 'WR', 'TE'].includes(p.pos)) return null;   // skip K/DEF
        return { name: p.name, pos: p.pos, age: p.age, starter: starters.has(String(pid)) };
      })
      .filter(Boolean);
    if (!players.length) continue;
    const byAgeDesc = [...players].sort((a, b) => b.age - a.age);
    const byAgeAsc  = [...players].sort((a, b) => a.age - b.age);
    const st = standBy[r.roster_id] || {};
    out.push({
      roster_id: r.roster_id,
      name: nameOf(r.roster_id),
      record: (st.wins != null) ? `${st.wins}-${st.losses}` : null,
      rank: st.rank ?? null,
      oldest: byAgeDesc.slice(0, topN).map(p => `${p.name} (${p.pos}, ${p.age}${p.starter ? '' : ', bench'})`),
      youngest: byAgeAsc.slice(0, topN).map(p => `${p.name} (${p.pos}, ${p.age}${p.starter ? '' : ', bench'})`),
      // young talent NOT starting — the "clogging the bench" signal
      benchedYouth: byAgeAsc.filter(p => !p.starter).slice(0, topN)
        .map(p => `${p.name} (${p.pos}, ${p.age})`),
    });
  }
  return out;
}

// --- Roster depth analysis: find each team's positional strengths/weaknesses so Trade
// Winds can ground its rumors in real needs. Returns per-team position counts + flags.
// rosters: Sleeper roster objects (have .roster_id, .players[]). playerMap: {id:{pos}}.
export function rosterDepthAnalysis(rosters, playerMap, nameOf) {
  // healthy dynasty depth targets per position (rough; enough to not be "thin")
  const TARGET = { QB: 2, RB: 4, WR: 5, TE: 2 };
  const out = [];
  for (const r of rosters) {
    const counts = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
    for (const pid of (r.players || [])) {
      const pos = playerMap[String(pid)]?.pos;
      if (pos && counts[pos] != null) counts[pos]++;
    }
    const thin = [], stacked = [];
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      if (counts[pos] < TARGET[pos]) thin.push({ pos, have: counts[pos], need: TARGET[pos] });
      if (counts[pos] >= TARGET[pos] + 2) stacked.push({ pos, have: counts[pos] });
    }
    out.push({
      roster_id: r.roster_id, name: nameOf(r.roster_id), counts,
      thin, stacked,
      // a team with a hole at one spot AND a surplus at another is a natural trade candidate
      tradeCandidate: thin.length > 0 && stacked.length > 0,
    });
  }
  return out;
}

// Returns up to `limit` of the most painful start/sit blunders across the league.
// playerMap: { [playerId]: { name, pos, team } }; nameOf(rosterId) -> team name.
export function benchCrimeReport(games, playerMap = {}, nameOf = (r) => `Team ${r}`, { limit = 3, minGap = 6 } = {}) {
  const crimes = [];
  for (const g of games) {
    const lineups = g.lineups || {};
    for (const rid of Object.keys(lineups)) {
      const { starters = [], players = [], points = {} } = lineups[rid] || {};
      const starterSet = new Set(starters.map(String));
      const bench = players.map(String).filter(p => !starterSet.has(p) && p && p !== '0');
      // group starters by position with their points
      const posOf = (pid) => playerMap[pid]?.pos || '?';
      const nameP = (pid) => playerMap[pid]?.name || `Player ${pid}`;
      // for each benched player, find the LOWEST-scoring starter at the same position
      for (const bp of bench) {
        const bPos = posOf(bp), bPts = +(points[bp] ?? 0);
        if (bPts <= 0) continue;
        let worstStarter = null;
        for (const sp of starters.map(String)) {
          if (posOf(sp) !== bPos) continue;
          const sPts = +(points[sp] ?? 0);
          if (!worstStarter || sPts < worstStarter.pts) worstStarter = { id: sp, pts: sPts };
        }
        if (worstStarter && bPts - worstStarter.pts >= minGap) {
          crimes.push({
            team: nameOf(+rid), pos: bPos,
            benched: nameP(bp), benchedPts: +bPts.toFixed(1),
            started: nameP(worstStarter.id), startedPts: +worstStarter.pts.toFixed(1),
            gap: +(bPts - worstStarter.pts).toFixed(1),
          });
        }
      }
    }
  }
  // one crime per team (their worst), then the biggest gaps league-wide, capped
  const perTeam = {};
  for (const c of crimes) if (!perTeam[c.team] || c.gap > perTeam[c.team].gap) perTeam[c.team] = c;
  return Object.values(perTeam).sort((a, b) => b.gap - a.gap).slice(0, limit);
}

export function benchCrimes(games, ownerName) {
  const crimes = [];
  for (const g of games) {
    crimes.push({ roster_id: g.winner, left: +(g.winnerOptimal - g.winnerPts).toFixed(1),
                  won: true, name: ownerName(g.winner) });
    crimes.push({ roster_id: g.loser, left: +(g.loserOptimal - g.loserPts).toFixed(1),
                  won: false, name: ownerName(g.loser),
                  // costly if what they left would've flipped the result
                  costly: (g.loserPts + (g.loserOptimal - g.loserPts)) > g.winnerPts });
  }
  return crimes.sort((x, y) => y.left - x.left);
}

// --- Luck ledger: lucky wins (won w/ bottom-tier score) & unlucky losses ---
export function luckLedger(games) {
  const scores = [];
  for (const g of games) { scores.push(g.winnerPts); scores.push(g.loserPts); }
  scores.sort((a, b) => a - b);
  const pct = (v) => scores.filter(s => s <= v).length / scores.length;
  const lucky = [], unlucky = [];
  for (const g of games) {
    if (pct(g.winnerPts) <= 0.4) lucky.push({ roster_id: g.winner, pts: g.winnerPts });
    if (pct(g.loserPts)  >= 0.7) unlucky.push({ roster_id: g.loser, pts: g.loserPts });
  }
  return { lucky, unlucky };
}

// --- SELECTION ALGORITHMS: what makes each "of the week" pick feel earned ---

// Game of the Week: rivalry history + combined quality + closeness + stakes.
export function gameOfWeek(games, standings, rivalryFn) {
  const rankOf = Object.fromEntries(standings.map(s => [s.roster_id, s.rank]));
  const N = standings.length;
  let best = null;
  for (const g of games) {
    const riv = rivalryFn(g.winner, g.loser);
    const rivalryWeight = riv.meetings >= 3 ? 3 : riv.meetings; // deep history matters
    const quality = (N - rankOf[g.winner]) + (N - rankOf[g.loser]); // both good = high
    const closeness = Math.max(0, 20 - g.margin);                   // nailbiter bonus
    const stakes = riv.lastPlayoff ? 5 : 0;                         // playoff rematch
    const score = rivalryWeight * 3 + quality + closeness + stakes;
    if (!best || score > best.score) best = { ...g, score, riv };
  }
  return best;
}

// Upset of the Week: rank gap (worse team beats better) + rivalry reversal.
export function upsetOfWeek(games, standings, rivalryFn) {
  const rankOf = Object.fromEntries(standings.map(s => [s.roster_id, s.rank]));
  let best = null;
  for (const g of games) {
    const gap = rankOf[g.winner] - rankOf[g.loser]; // positive = lower-ranked won
    if (gap <= 0) continue;
    const riv = rivalryFn(g.winner, g.loser);
    // reversal bonus: winner historically loses this matchup
    const reversal = (riv.aWins ?? 0) < (riv.bWins ?? 0) ? 3 : 0;
    const score = gap * 2 + reversal;
    if (!best || score > best.score) best = { ...g, score, gap, riv };
  }
  return best;
}

// Trade winds: detect a positional need (proxy: bottom scorers / roster gaps).
// Real version inspects starters vs. bench by position from players_points.
export function tradeRumors(standings, ownerName) {
  // Proxy heuristic for mock: bottom-3 in points + on a losing streak = "shopping".
  return standings
    .filter(s => s.rank > standings.length - 3 && s.streak.type === 'L' && s.streak.len >= 2)
    .map(s => ({ roster_id: s.roster_id, name: ownerName(s.roster_id),
                 reason: `${s.streak.len}-game skid, ${s.pf} PF (bottom of the league)` }));
}
