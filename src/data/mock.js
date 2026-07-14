// Mock league mirroring Sleeper's exact response shapes so the engine can be
// validated today (sandbox can't reach the live API). Swap for real pulls at deploy.
// 10 teams, 3 seasons of history to exercise multi-year rivalry + revenge logic.

export const users = [
  { user_id: 'u1', display_name: 'Mike',   metadata: { team_name: 'Gronk Obama' } },
  { user_id: 'u2', display_name: 'Sarah',  metadata: { team_name: 'Purple Reign' } },
  { user_id: 'u3', display_name: 'Dave',   metadata: { team_name: 'The Replacements' } },
  { user_id: 'u4', display_name: 'Priya',  metadata: { team_name: 'Cardiac Kings' } },
  { user_id: 'u5', display_name: 'Tom',    metadata: { team_name: 'Bye Week Blues' } },
  { user_id: 'u6', display_name: 'Jess',   metadata: { team_name: 'Feeling Mahomely' } },
  { user_id: 'u7', display_name: 'Carlos', metadata: { team_name: 'Kupp Noodles' } },
  { user_id: 'u8', display_name: 'Ben',    metadata: { team_name: 'The Sackless Wonders' } },
  { user_id: 'u9', display_name: 'Aisha',  metadata: { team_name: 'End Zone Dynasty' } },
  { user_id: 'u10',display_name: 'Ryan',   metadata: { team_name: 'Waiver Wire Warriors' } },
];

// roster_id -> owner. Stable across seasons for continuity.
export const rosters = users.map((u, i) => ({
  roster_id: i + 1,
  owner_id: u.user_id,
  metadata: { record: '' },
}));

const owner = (rid) => users[rid - 1].metadata.team_name;

// Helper to build a week of matchups. pairs: [[rosterA, scoreA, benchA],[rosterB, scoreB, benchB]]
function week(matchups) {
  const out = [];
  matchups.forEach((m, i) => {
    const mid = i + 1;
    m.forEach(([roster_id, points, benchPts, optimal]) => {
      out.push({
        matchup_id: mid,
        roster_id,
        points,
        // players_points omitted for brevity; bench + optimal drive "bench crime" calc
        custom: { bench_points: benchPts, optimal_points: optimal ?? points },
      });
    });
  });
  return out;
}

// --- CURRENT SEASON (2025), through week 6; week 6 is "this week" ---
export const currentSeasonMatchups = {
  6: week([
    [[1, 142.6, 18.2, 148.0], [4, 138.9, 40.1, 171.3]], // Gronk Obama edges Cardiac Kings; Priya left 40 on bench
    [[2, 91.4, 12.0, 96.2],  [8, 88.7, 9.5, 90.1]],      // ugly bottom-tier slugfest
    [[3, 155.2, 8.0, 158.0], [5, 101.3, 22.4, 120.0]],   // Replacements blow out Bye Week Blues
    [[6, 129.8, 15.0, 133.0],[9, 132.1, 6.0, 134.0]],    // Dynasty squeaks by Mahomely
    [[7, 118.0, 30.5, 140.0],[10, 76.4, 5.0, 79.0]],     // Kupp Noodles crush Waiver Warriors
  ]),
};

// Prior weeks this season (scores only) to compute records, streaks, rank trajectory.
export const currentSeasonPriorScores = {
  1: [[1,120],[2,98],[3,140],[4,110],[5,88],[6,125],[7,132],[8,79],[9,145],[10,91]],
  2: [[1,133],[2,101],[3,128],[4,119],[5,95],[6,141],[7,88],[8,92],[9,150],[10,84]],
  3: [[1,118],[2,110],[3,151],[4,102],[5,121],[6,99],[7,140],[8,85],[9,138],[10,120]],
  4: [[1,129],[2,88],[3,133],[4,141],[5,90],[6,150],[7,96],[8,110],[9,142],[10,78]],
  5: [[1,145],[2,120],[3,149],[4,88],[5,105],[6,130],[7,155],[8,91],[9,133],[10,101]],
};

// --- PRIOR SEASONS: compact head-to-head + finishes for rivalry/revenge/history ---
// Each entry: winner roster_id, loser roster_id, week, scores, playoff flag.
export const historicalGames = [
  // 2024 season
  { season: '2024', week: 14, win: 4, lose: 1, ws: 131, ls: 128, playoff: true },  // Cardiac Kings beat Gronk Obama in semis
  { season: '2024', week: 15, win: 9, lose: 4, ws: 140, ls: 137, playoff: true },  // Dynasty wins 2024 title over Cardiac Kings
  { season: '2024', week: 3,  win: 1, lose: 4, ws: 122, ls: 119 },
  { season: '2024', week: 10, win: 4, lose: 1, ws: 145, ls: 101 },
  { season: '2024', week: 7,  win: 3, lose: 5, ws: 160, ls: 90 },
  // 2023 season (founding)
  { season: '2023', week: 15, win: 1, lose: 6, ws: 128, ls: 120, playoff: true }, // Gronk Obama wins inaugural title
  { season: '2023', week: 5,  win: 1, lose: 4, ws: 130, ls: 127 },
  { season: '2023', week: 11, win: 4, lose: 1, ws: 118, ls: 116 },
];

// Championship ledger for "bitter ex-champ" callbacks and obituaries.
export const titles = [
  { season: '2023', champion: 1 }, // Mike / Gronk Obama — the founding title (Malloy's proxy if we want)
  { season: '2024', champion: 9 }, // Aisha / End Zone Dynasty — reigning champ
];

export const leagueMeta = {
  name: 'The League of Extraordinary Gentlemen',
  season: '2025',
  currentWeek: 6,
  totalTeams: 10,
};
