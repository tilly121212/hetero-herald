// Obituary engine. A weekly section that runs ONLY when a team becomes
// mathematically eliminated from playoff contention. Delivers a mock-solemn
// eulogy. Ties into the Playoff Race engine's `eliminated` tier.
//
// To avoid re-eulogizing the same team every week, the generator passes the set
// of already-eulogized owner_ids (persisted in history.json). We eulogize each
// team exactly once, the week they're first eliminated.

export function newlyEliminated(playoffRaceResult, alreadyEulogized = new Set()) {
  return playoffRaceResult.tiers.eliminated
    .filter(t => !alreadyEulogized.has(t.roster_id));
}

// Facts the writer needs to eulogize a team with real detail.
export function obituaryFacts(team, standings, week, identity) {
  const worst = standings.reduce((a, b) => (b.pf < a.pf ? b : a));
  return {
    roster_id: team.roster_id,
    name: identity.nameOf(team.roster_id),
    record: `${team.wins}-${team.losses}`,
    pf: team.pf,
    eliminatedWeek: week,
    leaguesLowestScoring: worst.roster_id === team.roster_id,
    streak: team.streak, // e.g. {type:'L', len:6}
  };
}

// Prompt fragment for the eulogy (mock-solemn, funeral voice).
export function obituaryPrompt(facts, persona) {
  return `Write a SHORT mock obituary (60-90 words) for a fantasy team just
eliminated from playoff contention, in the voice of ${persona.name}. Funeral-solemn
but comedic. Football-only: mourn the record, the losing streak, the wasted roster —
never anything personal or about the literal team name. Use the team name verbatim.
FACTS: ${JSON.stringify(facts)}`;
}
