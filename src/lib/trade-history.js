// Trade history database — the "aging trades" engine.
// To judge whether a trade "looked good then, looks bad now," we must compare the
// value of each side AT TRADE TIME vs. TODAY. FantasyCalc only returns CURRENT
// values, so we snapshot values when a trade happens and persist them. Each week
// we re-price the same players at today's values and compute the drift.
//
// Storage: a JSON ledger at data-cache/trade-history.json. The generator appends
// new trades (with a value snapshot) as it sees them, and never deletes — this is
// the permanent record that makes revisionist history possible.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const DB = './data-cache/trade-history.json';

function load() {
  if (!existsSync(DB)) return { trades: [] };
  try { return JSON.parse(readFileSync(DB)); } catch { return { trades: [] }; }
}
function save(db) {
  if (!existsSync('./data-cache')) mkdirSync('./data-cache', { recursive: true });
  writeFileSync(DB, JSON.stringify(db, null, 2));
}

// Record a newly-seen trade WITH a value snapshot at trade time.
// trade: from Sleeper transactions. valuesNow: { sleeperPlayerId -> value } (today).
// identity: to resolve owner names. Returns the stored record (or existing if seen).
export function recordTrade(trade, valuesNow, identity, playerName) {
  const db = load();
  if (db.trades.find(t => t.txnId === trade.transaction_id)) return null; // already logged

  // adds maps playerId -> roster_id that RECEIVES the player
  const perSide = {};
  for (const [pid, rid] of Object.entries(trade.adds || {})) {
    (perSide[rid] ??= { roster_id: Number(rid), got: [], valueAtTrade: 0 });
    perSide[rid].got.push({ pid, name: playerName(pid), valueAtTrade: valuesNow[String(pid)] ?? 0 });
    perSide[rid].valueAtTrade += valuesNow[String(pid)] ?? 0;
  }
  const sides = Object.values(perSide).map(s => ({
    ...s, owner_id: identity.ownerOf(s.roster_id), name: identity.nameOf(s.roster_id),
  }));

  const record = {
    txnId: trade.transaction_id,
    when: trade.created,
    week: trade.week,
    season: identity.season,
    sides,
  };
  db.trades.push(record);
  save(db);
  return record;
}

// Re-price every logged trade at TODAY's values and compute the drift per side.
// valuesNow: current FantasyCalc values. Returns trades annotated with then/now.
export function revalueTrades(valuesNow, { minAgeDays = 21 } = {}) {
  const db = load();
  const now = Date.now();
  const out = [];

  for (const t of db.trades) {
    const ageDays = (now - t.when) / 864e5;
    if (ageDays < minAgeDays) continue; // too fresh to have "aged" yet

    const sides = t.sides.map(s => {
      const valueNow = s.got.reduce((sum, p) => sum + (valuesNow[String(p.pid)] ?? 0), 0);
      const players = s.got.map(p => ({
        ...p, valueNow: valuesNow[String(p.pid)] ?? 0,
        drift: (valuesNow[String(p.pid)] ?? 0) - p.valueAtTrade,
      }));
      return { ...s, valueNow, drift: valueNow - s.valueAtTrade, players };
    });

    // who won at the time vs. who's winning now — the story is when this FLIPS
    const byThen = [...sides].sort((a, b) => b.valueAtTrade - a.valueAtTrade);
    const byNow  = [...sides].sort((a, b) => b.valueNow - a.valueNow);
    const flipped = byThen[0]?.roster_id !== byNow[0]?.roster_id;

    out.push({
      ...t, ageDays: Math.round(ageDays), sides,
      winnerThen: byThen[0], winnerNow: byNow[0], flipped,
    });
  }
  return out;
}

// Pick the juiciest "aging trade" to feature: prioritize ones that FLIPPED
// (looked good, now bad), then biggest total drift.
export function agingTradeOfWeek(revalued) {
  if (!revalued.length) return null;
  const scored = revalued.map(t => {
    const swing = Math.abs((t.winnerNow?.valueNow ?? 0) - (t.winnerNow?.valueAtTrade ?? 0))
                + Math.abs((t.winnerThen?.valueNow ?? 0) - (t.winnerThen?.valueAtTrade ?? 0));
    return { ...t, dramaScore: (t.flipped ? 10000 : 0) + swing };
  }).sort((a, b) => b.dramaScore - a.dramaScore);
  return scored[0];
}

// Facts for the writer to narrate the revisionist history.
export function agingTradeFacts(t, identity) {
  if (!t) return null;
  return {
    week: t.week, season: t.season, ageDays: t.ageDays, flipped: t.flipped,
    sides: t.sides.map(s => ({
      team: s.name,
      received: s.players.map(p => p.name),
      valueThen: Math.round(s.valueAtTrade),
      valueNow: Math.round(s.valueNow),
      drift: Math.round(s.drift),
      biggestFaller: [...s.players].sort((a, b) => a.drift - b.drift)[0],
      biggestRiser:  [...s.players].sort((a, b) => b.drift - a.drift)[0],
    })),
    verdictThen: t.winnerThen?.name,
    verdictNow: t.winnerNow?.name,
  };
}
