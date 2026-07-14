// Identity layer. The ONE source of truth for "who is this team and what are
// they called right now." Two facts drive everything:
//   1) Managers are stable across seasons via owner_id (keeper league).
//   2) Display names are NOT stable — team names change mid-season, and the
//      LEAGUE name changes every season. So names are always resolved for a
//      SPECIFIC point in time, never hardcoded.

// Build an identity resolver for a given season's data.
// users: Sleeper /league/{id}/users   rosters: /league/{id}/rosters
export function buildIdentity(users, rosters, leagueMeta) {
  // owner_id -> current display team name (as of this data pull)
  const ownerToName = {};
  const ownerToHandle = {};
  for (const u of users) {
    ownerToName[u.user_id] = u.metadata?.team_name || u.display_name || 'Unnamed Team';
    ownerToHandle[u.user_id] = u.display_name || u.user_id;
  }
  // roster_id -> owner_id (this season's mapping; roster_ids are reused across seasons)
  const rosterToOwner = {};
  for (const r of rosters) rosterToOwner[r.roster_id] = r.owner_id;

  return {
    leagueName: leagueMeta?.name || 'The League',   // modular: from THIS season's data
    season: leagueMeta?.season || '',
    rosterToOwner,
    ownerOf: (roster_id) => rosterToOwner[roster_id],
    // name of a roster AS OF this data snapshot
    nameOf: (roster_id) => ownerToName[rosterToOwner[roster_id]] || `Team ${roster_id}`,
    nameOfOwner: (owner_id) => ownerToName[owner_id] || `Owner ${owner_id}`,
    handleOf: (roster_id) => ownerToHandle[rosterToOwner[roster_id]] || '',
  };
}

// Per-WEEK name resolution. A team's name shown in a Week-W issue is whatever it
// was called that week. If you snapshot users each week, pass the snapshot for W;
// otherwise it falls back to the latest known name. History (rivalries, trades)
// is keyed to owner_id, so a rename never breaks the record — only the label changes.
export function nameAsOfWeek(identityByWeek, week, roster_id, fallbackIdentity) {
  const id = identityByWeek?.[week] || fallbackIdentity;
  return id.nameOf(roster_id);
}

// When showing historical events (e.g. "beat them in 2024"), we may want BOTH
// the name then and the name now, since a team can be unrecognizable a year later.
// e.g. "Vengeful Men (now 'Merry Men')". This keeps long-time readers oriented.
export function nameThenAndNow(ownerId, thenIdentity, nowIdentity) {
  const then = thenIdentity.nameOfOwner(ownerId);
  const now = nowIdentity.nameOfOwner(ownerId);
  return then === now ? then : `${now} (formerly “${then}”)`;
}
