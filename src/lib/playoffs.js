// Playoff Race engine — upgraded with real "who controls their fate / who needs
// help" scenarios, factoring in this league's points-for tiebreaker.
//
// Config for Hetero Heroes: 14 teams, 7 playoff spots, regular season ends
// week 14 (playoffs start week 15). All configurable.

export function playoffRace(standings, {
  playoffSpots = 7, regSeasonWeeks = 14, currentWeek, remainingSchedule = null,
} = {}) {
  const weeksLeft = Math.max(0, regSeasonWeeks - currentWeek);
  const N = standings.length;

  const t = standings.map(s => ({
    ...s,
    maxWins: s.wins + weeksLeft,   // wins out
    minWins: s.wins,               // loses out
  }));

  const cutoff = t[playoffSpots - 1];    // current last team in
  const firstOut = t[playoffSpots];      // current first team out

  const tiers = { clinched: [], contending: [], bubble: [], eliminated: [] };
  const scenarios = [];

  for (let i = 0; i < t.length; i++) {
    const team = t[i];

    // How many teams could POSSIBLY finish above this team (by max wins, or equal
    // wins with a better points-for tiebreak).
    const couldFinishAbove = t.filter((o, j) => {
      if (j === i) return false;
      if (o.maxWins > team.minWins) return true;
      if (o.maxWins === team.minWins && o.pf > team.pf) return true; // tiebreak
      return false;
    }).length;
    const clinched = couldFinishAbove < playoffSpots && weeksLeft < regSeasonWeeks;

    // How many teams are GUARANTEED to finish above this team even if it wins out.
    const safelyAhead = t.filter((o, j) => {
      if (j === i) return false;
      if (o.minWins > team.maxWins) return true;
      if (o.minWins === team.maxWins && o.pf > team.pf) return true;
      return false;
    }).length;
    const eliminated = safelyAhead >= playoffSpots;

    if (clinched) tiers.clinched.push(team);
    else if (eliminated) tiers.eliminated.push(team);
    else if (team.rank <= playoffSpots) tiers.contending.push(team);
    else tiers.bubble.push(team);

    if (!clinched && !eliminated) {
      scenarios.push(buildScenario(team, t, i, { playoffSpots, weeksLeft }));
    }
  }

  return { weeksLeft, playoffSpots, cutoff, firstOut, tiers, scenarios };
}

// The upgraded scenario: does winning out GUARANTEE a spot (control own fate),
// or does the team need help — and if so, WHO to watch.
function buildScenario(team, all, idx, { playoffSpots, weeksLeft }) {
  const inSeat = team.rank <= playoffSpots;
  const teamName = (o) => o.teamName || `Team ${o.roster_id}`;

  // Teams that could still finish at/above this team if it wins out (real threats to
  // its final position). A threat can exceed our maxWins, or tie it with better PF.
  const threatsIfWinOut = all.filter((o, j) => {
    if (j === idx) return false;
    if (o.maxWins > team.maxWins) return true;
    if (o.maxWins === team.maxWins && o.pf > team.pf) return true;
    return false;
  });
  const controlsOwnFate = threatsIfWinOut.length < playoffSpots;

  // The teams this bubble/contender is actually competing with for the LAST seats:
  // the teams currently sitting at the cutoff line (seeds near playoffSpots), i.e. the
  // ones it must catch (if outside) or hold off (if inside) — NOT clinched teams far
  // ahead. Root-against list = the teams occupying the final seats just above it.
  const cutoffRivals = all
    .filter((o, j) => j !== idx && o.rank <= playoffSpots && o.rank >= playoffSpots - 1)  // last one or two IN
    .concat(all.filter((o, j) => j !== idx && o.rank > playoffSpots && o.rank <= playoffSpots + 1)); // first one or two OUT
  // for an OUTSIDE team: who to catch = teams in the last seats it can still reach
  const mustCatch = all.filter((o, j) => j !== idx && o.rank <= playoffSpots && o.rank > playoffSpots - 3 && team.maxWins >= o.minWins);

  const winsToClinch = Math.max(0, needWinsToClinch(team, all, playoffSpots, weeksLeft));
  const gamesBack = Math.max(0, (all[playoffSpots - 1]?.wins ?? team.wins) - team.wins);

  let text;
  if (controlsOwnFate && inSeat) {
    text = winsToClinch <= 1
      ? `Controls its own fate — one win likely clinches.`
      : `Controls its own fate — ${winsToClinch} of the last ${weeksLeft} wins and it's in.`;
  } else if (inSeat) {
    // holds a seat but can be caught — name the nearest team chasing from just outside
    const chasers = all.filter((o, j) => j !== idx && o.rank > playoffSpots && o.rank <= playoffSpots + 2).slice(0, 2).map(teamName);
    text = chasers.length
      ? `In a seat but not safe — must hold off ${chasers.join(' and ')}. Keep winning.`
      : `In a seat but not safe — a slip opens the door. Keep winning.`;
  } else {
    // outside looking in — name the specific teams holding the last seats it must catch
    const targets = (mustCatch.length ? mustCatch : cutoffRivals.filter(o => o.rank <= playoffSpots))
      .sort((a, b) => b.rank - a.rank).slice(0, 2).map(teamName);
    const targetStr = targets.length ? targets.join(' or ') : 'the teams at the cut';
    text = gamesBack <= 0
      ? `Tied at the cut line — must win out and win the points-for tiebreaker over ${targetStr}.`
      : `${gamesBack} back of the last seat with ${weeksLeft} to play — must win out AND needs ${targetStr} to stumble.`;
  }

  // one concise tiebreaker note only when it's actually decisive (tied on wins with a rival)
  const tiedRivals = all.filter((o, j) => j !== idx && o.wins === team.wins && Math.abs(o.rank - team.rank) <= 2);
  if (tiedRivals.length) {
    const behindOnPf = tiedRivals.some(o => o.pf > team.pf);
    text += behindOnPf ? ` Trails on points-for — must outscore to win the tie.` : ` Holds the points-for tiebreaker.`;
  }

  return {
    roster_id: team.roster_id, rank: team.rank, wins: team.wins, losses: team.losses,
    controlsOwnFate, inSeat, winsToClinch, gamesBack,
    watch: (mustCatch.length ? mustCatch : cutoffRivals).map(o => o.roster_id),
    text,
  };
}

// Rough "wins needed to be safe": smallest number of additional wins such that
// fewer than `spots` teams can finish strictly above.
function needWinsToClinch(team, all, spots, weeksLeft) {
  for (let w = 0; w <= weeksLeft; w++) {
    const myWins = team.wins + w;
    const canBeatMe = all.filter(o => {
      if (o.roster_id === team.roster_id) return false;
      if (o.maxWins > myWins) return true;
      if (o.maxWins === myWins && o.pf > team.pf) return true;
      return false;
    }).length;
    if (canBeatMe < spots) return w;
  }
  return weeksLeft + 1; // can't clinch by winning out alone
}

export function playoffRaceActive(currentWeek, startWeek = 6) {
  return currentWeek >= startWeek;
}
