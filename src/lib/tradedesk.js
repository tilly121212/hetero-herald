// Trade Desk engine.
// - Player VALUES come from FantasyCalc's free public endpoint (real-trade based,
//   matched to league settings). ToS-clean, no scraping.
// - TRADE HISTORY + timestamps come from Sleeper's free read-only transactions API.
// - Malloy supplies the letter-grade snark on top of the objective value delta.

const FC_BASE = 'https://api.fantasycalc.com/values/current';

// Pull current values matched to THIS league's settings.
// isDynasty=true, numQbs=1 (this league starts 1 QB), ppr=0.5, numTeams=14.
// Returns a map: sleeperPlayerId -> value.
export async function getFantasyCalcValues({ isDynasty = true, numQbs = 1, numTeams = 14, ppr = 0.5 } = {}) {
  const url = `${FC_BASE}?isDynasty=${isDynasty}&numQbs=${numQbs}&numTeams=${numTeams}&ppr=${ppr}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FantasyCalc -> ${res.status}`);
  const list = await res.json();
  const bySleeperId = {};
  for (const row of list) {
    const sid = row?.player?.sleeperId;
    if (sid) bySleeperId[String(sid)] = row.value ?? row.redraftValue ?? 0;
  }
  return bySleeperId; // draft picks handled separately if needed
}

// Total roster value per team -> power tiers.
export function teamValues(rosters, values, ownerName) {
  const teams = rosters.map(r => {
    const total = (r.players ?? []).reduce((sum, pid) => sum + (values[String(pid)] ?? 0), 0);
    return { roster_id: r.roster_id, name: ownerName(r.roster_id), value: total };
  });
  teams.sort((a, b) => b.value - a.value);
  return teams.map((t, i) => ({ ...t, valueRank: i + 1 }));
}

// --- Sleeper transactions: gather all trades across the season (and prior via chaining) ---
// transactionsByWeek: { week: [ txn, ... ] } as returned by /league/{id}/transactions/{week}
// Each trade txn has: type:'trade', status:'complete', created (ms), roster_ids:[],
// adds:{playerId:rosterId}, drops:{...}, draft_picks:[...].
export function collectTrades(transactionsByWeek, rosterToOwner = null) {
  const trades = [];
  for (const [week, txns] of Object.entries(transactionsByWeek)) {
    for (const t of txns) {
      if (t.type === 'trade' && t.status === 'complete') {
        // translate roster_ids -> durable owner_ids so trader tiers attribute correctly.
        // (Sleeper trades carry roster_ids; tiers count by owner_id.)
        const owner_ids = rosterToOwner
          ? (t.roster_ids ?? []).map(rid => rosterToOwner[rid]).filter(Boolean)
          : (t.owner_ids ?? []);
        trades.push({ ...t, week: Number(week), when: t.created, owner_ids });
      }
    }
  }
  return trades.sort((a, b) => b.when - a.when); // newest first
}

// MULTI-YEAR trade collection. Owners persist across seasons in a keeper league,
// but roster_ids can be reused. We key trades to a STABLE owner_id via each
// season's roster->owner map, so tiers and staleness span the league's entire history.
// seasons: [{ transactionsByWeek, rosterToOwner }] newest-first or any order.
export function collectTradesAllYears(seasons) {
  const trades = [];
  for (const { transactionsByWeek, rosterToOwner } of seasons) {
    for (const [week, txns] of Object.entries(transactionsByWeek)) {
      for (const t of txns) {
        if (t.type === 'trade' && t.status === 'complete') {
          // translate this season's roster_ids to durable owner_ids
          const owner_ids = (t.roster_ids ?? []).map(rid => rosterToOwner[rid]).filter(Boolean);
          trades.push({ ...t, week: Number(week), when: t.created, owner_ids });
        }
      }
    }
  }
  return trades.sort((a, b) => b.when - a.when);
}

// Last trade date per team + staleness flag (>90 days = roast bait).
export function tradeRecency(rosterIds, trades, ownerName, now = Date.now()) {
  const THREE_MONTHS = 90 * 24 * 60 * 60 * 1000;
  const lastByRoster = {};
  for (const t of trades) {
    for (const rid of (t.roster_ids ?? [])) {
      if (!(rid in lastByRoster) || t.when > lastByRoster[rid]) lastByRoster[rid] = t.when;
    }
  }
  return rosterIds.map(rid => {
    const last = lastByRoster[rid] ?? null;
    const daysSince = last ? Math.floor((now - last) / (24 * 60 * 60 * 1000)) : null;
    return {
      roster_id: rid, name: ownerName(rid),
      lastTradeMs: last,
      lastTradeDate: last ? new Date(last).toISOString().slice(0, 10) : 'never',
      daysSince,
      stale: last ? (now - last) > THREE_MONTHS : true, // never-traded counts as stale
    };
  });
}

// Trader tier list: blends VOLUME (activity) with QUALITY (did you win your swaps).
// Operates on durable owner_ids so it spans EVERY season the league has existed.
// Pass trades from collectTradesAllYears (they carry owner_ids).
export function traderTiers(ownerIds, trades, tradeQualityByOwner, ownerNameById) {
  const count = Object.fromEntries(ownerIds.map(o => [o, 0]));
  for (const t of trades) for (const oid of (t.owner_ids ?? [])) count[oid] = (count[oid] ?? 0) + 1;

  const raw = ownerIds.map(oid => ({
    owner_id: oid, name: ownerNameById(oid),
    trades: count[oid] ?? 0,
    netValue: tradeQualityByOwner[oid] ?? 0, // + means fleeced others, - means got fleeced
  }));

  const maxTrades = Math.max(1, ...raw.map(r => r.trades));
  const vals = raw.map(r => r.netValue);
  const minV = Math.min(0, ...vals), maxV = Math.max(0, ...vals);
  const spanV = (maxV - minV) || 1;

  const scored = raw.map(r => {
    const volScore = r.trades / maxTrades;
    const qualScore = (r.netValue - minV) / spanV;
    const score = r.trades === 0 ? -1 : (0.55 * volScore + 0.45 * qualScore);
    return { ...r, score };
  }).sort((a, b) => b.score - a.score);

  const n = scored.length;
  const tierFor = (i) => {
    const q = i / n;
    if (q < 0.15) return 'S'; if (q < 0.4) return 'A';
    if (q < 0.65) return 'B'; if (q < 0.85) return 'C'; return 'F';
  };
  return scored.map((t, i) => ({ ...t, tier: t.trades === 0 ? 'F' : tierFor(i) }));
}

// Grade THIS week's trades by FantasyCalc value delta. Malloy adds the prose.
export function gradeWeeklyTrades(trades, week, values, playerName, ownerName) {
  const sideValue = (playerIds) => playerIds.reduce((s, pid) => s + (values[String(pid)] ?? 0), 0);
  return trades.filter(t => t.week === week).map(t => {
    // adds maps playerId -> roster_id that RECEIVES the player.
    const perRoster = {};
    for (const [pid, rid] of Object.entries(t.adds ?? {})) {
      (perRoster[rid] ??= { got: [], value: 0 });
      perRoster[rid].got.push(pid);
      perRoster[rid].value += values[String(pid)] ?? 0;
    }
    const sides = Object.entries(perRoster).map(([rid, d]) => ({
      roster_id: Number(rid), name: ownerName(Number(rid)),
      received: d.got.map(pid => playerName(pid)), value: Math.round(d.value),
    }));
    sides.sort((a, b) => b.value - a.value);
    const delta = sides.length === 2 ? sides[0].value - sides[1].value : 0;
    // RAW value-delta label only — NOT a final verdict. A big delta can be a sound
    // dynasty move (contender buys win-now, rebuilder sells for picks/youth). The
    // writer must weigh intent before calling anything a "heist". This is a signal,
    // not a sentence.
    const fairnessRaw = delta < 200 ? 'even' : delta < 800 ? 'edge' : delta < 1800 ? 'lopsided' : 'very lopsided';
    return { txnId: t.transaction_id, when: t.when, sides, delta, fairnessRaw,
             note: 'value-delta only; interpret with dynasty intent (contender vs rebuilder)' };
  });
}
