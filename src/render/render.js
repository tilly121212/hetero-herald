// Render layer (v1.1.0). Reads the season database for REAL cumulative records, so
// standings / playoff race / power-ranking movement reflect the actual season — not
// one week's scores. Reconnects the controversy, staleness, and trader-tier engines.
// LLM writes fresh prose + quotes each week; structure matches the approved demos.

import { PERSONA, buildSectionPrompt, callLLM, writeQuote } from '../lib/writer.js';
import { broadsheetTemplate } from './template.js';
import { playoffRace, playoffRaceActive } from '../lib/playoffs.js';
import { buildStandings, benchCrimeReport } from '../lib/analyze.js';
import { weeksThrough, saveRankings, prevRankings, saveRumors, priorRumors } from '../lib/season-db.js';
import { deltaReason, markGraded, markSnapGraded } from '../lib/revisionist.js';
import { planControversy, controversyPrompt } from '../lib/controversy.js';
import { rivalry as rivalryStats } from '../lib/analyze.js';
import { newlyEliminated, obituaryFacts, obituaryPrompt } from '../lib/obituary.js';
import { readFileSync, existsSync } from 'node:fs';

// Load past-seasons history (games use OWNER ids). Null if build-history hasn't run.
function loadHistory() {
  try { if (existsSync('./data-cache/history.json')) return JSON.parse(readFileSync('./data-cache/history.json')); } catch {}
  return null;
}

const esc = (s = '') => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
// Clean up floating-point display artifacts (e.g. 13.02000000000001 -> 13.02). Trims
// trailing zeros too (13.00 -> 13, 13.50 -> 13.5). Non-numbers pass through unchanged.
const num = (v) => {
  if (v == null || v === '' || isNaN(Number(v))) return v;
  return String(+Number(v).toFixed(2));
};

// Clip a power-ranking blurb to a uniform max length so the two columns stay balanced.
// Prefers cutting at the first sentence end; otherwise hard-caps at maxWords and adds an
// ellipsis. Keeps every team's comment roughly the same size.
function clipBlurb(b, maxWords = 13) {
  if (!b) return b;
  const words = b.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return b;
  // try to end cleanly at the first sentence boundary within the limit
  const firstSentence = b.match(/^.*?[.!?](\s|$)/);
  if (firstSentence && firstSentence[0].split(/\s+/).filter(Boolean).length <= maxWords) {
    return firstSentence[0].trim();
  }
  return words.slice(0, maxWords).join(' ').replace(/[,;:\-\u2014]+$/, '') + '\u2026';
}

// Robustly extract HED/DEK/PULL/BODY (or any labeled fields) from an LLM response, even when
// the model runs the labels together on one line without clean line breaks. Works by using
// the labels themselves as delimiters: each field's text runs until the NEXT known label.
// Returns an object keyed by lowercased label. Missing labels are absent from the result.
function parseLabeledFields(raw, labels = ['HED', 'DEK', 'PULL', 'BODY']) {
  const out = {};
  // Build an alternation of the labels for the "stop at next label" lookahead.
  const stop = labels.map(l => `${l}\\s*:`).join('|');
  for (const label of labels) {
    // match "LABEL:" then capture everything up to the next label or end of string
    const rx = new RegExp(`${label}\\s*:\\s*([\\s\\S]*?)(?=\\s*(?:${stop})|$)`, 'i');
    const m = raw.match(rx);
    if (m && m[1] != null && m[1].trim()) out[label.toLowerCase()] = m[1].trim();
  }
  return out;
}
const provider = () => process.env.LLM_PROVIDER || 'anthropic';

// Emoji ranges — strip these from LLM-written PROSE (team/player names come from
// data, not prose, so any emoji in generated text is Gemini's own embellishment).
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\uFE0F\u{1F1E6}-\u{1F1FF}]/gu;

// Turn raw LLM text into clean newspaper HTML paragraphs:
//  - strip markdown bold/italic (**x**, *x*, __x__, _x_) -> plain (or <strong>)
//  - remove a self-written ALL-CAPS headline line if the model added one
//  - strip emoji from prose
//  - wrap into <p>, drop-cap the FIRST paragraph (big red letter, like the demo)
function cleanProse(raw, { dropCap = true, week = null } = {}) {
  if (!raw) return '';
  let t = String(raw);
  if (week != null) t = t.replace(/\{WEEK\}/g, week);
  else t = t.replace(/\{WEEK\}/g, '');
  // if the model returned HTML paragraphs already, unwrap to text first
  const hadTags = /<p[ >]/i.test(t);
  if (hadTags) t = t.replace(/<\/?p[^>]*>/gi, '\n\n');
  // markdown -> keep bold as <strong>, drop italic asterisks
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
       .replace(/__(.+?)__/g, '<strong>$1</strong>')
       .replace(/(?<!\*)\*(?!\*)([^*]+?)\*(?!\*)/g, '$1')
       .replace(/(?<!_)_(?!_)([^_]+?)_(?!_)/g, '$1');
  t = t.replace(EMOJI, '');
  // de-shout: soften ALL-CAPS emphasis words (4+ letters) to normal case. Keep known
  // acronyms/short caps (NFL, RB, TE, QB, PPR, MVP, GM) and team-name tokens intact.
  const KEEP = new Set(['NFL','RB','WR','TE','QB','PPR','MVP','GM','LGBTQ','MFJ','FMV','IR','TD','PF','PA']);
  t = t.replace(/\b[A-Z][A-Z]{3,}\b/g, (w) => KEEP.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase());
  // split to paragraphs
  let paras = t.split(/\n\n+/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // drop a leading self-written headline (short, all-caps-ish, or ends with a colon header)
  if (paras.length > 1) {
    const first = paras[0].replace(/<[^>]+>/g, '');
    const isHeadline = first.length < 90 && (first === first.toUpperCase() || /^[A-Z][^.!?]*[:!?]$/.test(first) || /VINCE MALLOY/i.test(first));
    if (isHeadline) paras.shift();
  }
  return paras.map((p, i) => `<p${dropCap && i === 0 ? ' class="drop"' : ''}>${p}</p>`).join('\n');
}

// ---- compute this week's games + REAL season standings from the database ----
function computeContext(facts) {
  const id = facts.identity;
  const name = (rid) => id.nameOf(rid);
  const rosterIds = facts.rosterIds || [];

  const thisWeek = (facts.games || []).map(g => ({
    ...g, winnerName: name(g.winner), loserName: name(g.loser),
  }));

  // real cumulative standings from all weeks 1..currentWeek (from season DB)
  const allWeeks = facts.leagueId ? weeksThrough(facts.leagueId, facts.week) : [thisWeek];
  const weeksForStandings = allWeeks.length ? allWeeks : [thisWeek];
  let standings = [];
  try {
    standings = buildStandings(rosterIds.length ? rosterIds : inferRosterIds(weeksForStandings), weeksForStandings)
      .map(s => ({ ...s, teamName: name(s.roster_id), name: name(s.roster_id) }));
  } catch { standings = []; }

  // this-week superlatives
  const scoredThisWeek = [];
  for (const g of thisWeek) {
    scoredThisWeek.push({ rid: g.winner, name: g.winnerName, pts: g.winnerPts, won: true });
    scoredThisWeek.push({ rid: g.loser, name: g.loserName, pts: g.loserPts, won: false });
  }
  scoredThisWeek.sort((a, b) => b.pts - a.pts);

  // prior-week standings (going INTO this week) so articles can reference where a team
  // STOOD before the result, and describe movement accurately ("the now-#2 seed").
  let prevStandings = [];
  try {
    if (facts.leagueId && facts.week > 1) {
      const priorWeeks = weeksThrough(facts.leagueId, facts.week - 1);
      if (priorWeeks.length) {
        prevStandings = buildStandings(rosterIds.length ? rosterIds : inferRosterIds(priorWeeks), priorWeeks)
          .map(s => ({ ...s, teamName: name(s.roster_id), name: name(s.roster_id) }));
      }
    }
  } catch { prevStandings = []; }
  const prevRankOf = Object.fromEntries(prevStandings.map(s => [s.roster_id, s.rank]));

  return {
    name, thisWeek, standings, prevStandings, prevRankOf,
    scoredThisWeek,
    top: scoredThisWeek[0], bottom: scoredThisWeek[scoredThisWeek.length - 1],
    closest: [...thisWeek].sort((a, b) => a.margin - b.margin)[0],
  };
}

function inferRosterIds(weeks) {
  const s = new Set();
  for (const wk of weeks) for (const g of wk) { s.add(g.winner); s.add(g.loser); }
  return [...s];
}

// Choose the LEAD game (Game of the Week). Stakes first: games between teams high in
// the standings, near the playoff cutoff, or with seeding/elimination implications
// score highest — and stakes ramp up later in the season. If nothing has real stakes
// (early season / nothing on the line), fall back to SPICE: shootouts, nail-biters,
// blowouts. Returns { game, why } where `why` explains the stakes for the writer.
function pickLeadGame(ctx, facts) {
  const games = ctx.thisWeek;
  if (!games.length) return null;
  const wk = facts.week;
  const regWeeks = facts.regWeeks || 14;
  const weeksLeft = Math.max(0, regWeeks - wk);
  const spots = 7;
  const rankOf = {}, recOf = {}, seedPressure = {};
  for (const s of ctx.standings) {
    rankOf[s.roster_id] = s.rank;
    recOf[s.roster_id] = `${s.wins}-${s.losses}`;
    // pressure = how close this team is to the playoff cutoff line (rank 7/8 border)
    seedPressure[s.roster_id] = 1 / (1 + Math.abs(s.rank - spots) * 0.5);
  }
  // season progress 0..1 — stakes matter more as the season goes on
  const progress = Math.min(1, wk / regWeeks);

  let best = null;
  for (const g of games) {
    const wr = rankOf[g.winner], lr = rankOf[g.loser];
    const bothRanked = wr != null && lr != null;

    // STAKES: reward games between highly-ranked teams, near the cutoff, with a
    // contender involved. Scaled by how far into the season we are.
    let stakes = 0;
    if (bothRanked) {
      const topThreat = (14 - wr) + (14 - lr);              // both high in standings
      const cutoffProx = (seedPressure[g.winner] + seedPressure[g.loser]) * 6; // near bubble
      const contenderInvolved = (wr <= spots || lr <= spots) ? 4 : 0;
      const seedClash = (wr <= 4 && lr <= 4) ? 6 : 0;        // two real contenders
      stakes = (topThreat * 0.25 + cutoffProx + contenderInvolved + seedClash) * (0.4 + 0.6 * progress);
      // a contender getting upset / collapsing is a big story
      if (lr <= spots && wr > lr + 3) stakes += 5;
    }

    // SPICE (fallback / tiebreaker): shootout + closeness + blowout drama
    const combined = g.winnerPts + g.loserPts;
    const shootout = Math.max(0, combined - 200) * 0.05;     // both scored a lot
    const nailBiter = Math.max(0, 15 - g.margin) * 0.3;      // tight finish
    const blowout = Math.max(0, g.margin - 40) * 0.1;        // demolition
    const spice = shootout + nailBiter + blowout + combined * 0.01;

    const score = stakes * 2 + spice; // stakes weighted above spice
    const g2 = { ...g, winnerRank: wr, loserRank: lr, winnerRec: recOf[g.winner], loserRec: recOf[g.loser], stakes, spice };
    if (!best || score > best.score) best = { game: g2, score, stakes, spice };
  }
  return best;
}

// ---- UPSET: the biggest RECORD/RANK gap where the worse team won ----
// Upset detection cascade:
//  1) POWER rankings — a lower-power team beat a higher-power team (truest upset)
//  2) RECORD — a worse-record team beat a better-record team
//  3) LAST WEEK — a team that was riding high last week got toppled
//  4) NEAR-MISS — no real upset, so highlight the favorite who ALMOST lost (closest call)
// Returns { game, kind, winnerRank, loserRank } or a near-miss object. Respects `exclude`.
function findUpset(ctx, facts, exclude = new Set()) {
  const games = ctx.thisWeek.filter(g => !exclude.has(g));
  if (!games.length) return null;

  // power-rank order (best->worst) -> position map
  const powerOrder = powerRankOrder(ctx).map(r => r.roster_id);
  const powerPos = Object.fromEntries(powerOrder.map((rid, i) => [rid, i + 1]));
  const rankOf = Object.fromEntries(ctx.standings.map(s => [s.roster_id, s.rank]));
  const prev = facts.leagueId ? prevRankings(facts.leagueId, facts.week) : null;
  const prevPos = prev ? Object.fromEntries(prev.map((rid, i) => [rid, i + 1])) : null;

  const byGap = (posMap) => {
    let best = null, bestGap = 0;
    for (const g of games) {
      const wp = posMap[g.winner], lp = posMap[g.loser];
      if (wp == null || lp == null) continue;
      const gap = wp - lp; // winner ranked worse (higher number) than loser = upset
      if (gap > bestGap) { bestGap = gap; best = { ...g, winnerRank: wp, loserRank: lp, _srcGame: g }; }
    }
    return bestGap >= 2 ? best : null; // needs a meaningful gap to count
  };

  // 1) power rankings
  let u = byGap(powerPos); if (u) return { ...u, kind: 'power' };
  // 2) record/standings
  u = byGap(rankOf); if (u) return { ...u, kind: 'record' };
  // 3) last week's standings
  if (prevPos) { u = byGap(prevPos); if (u) return { ...u, kind: 'lastweek' }; }

  // 4) near-miss: the highest-ranked (by power) team that came CLOSEST to losing
  let nm = null;
  for (const g of games) {
    const favPos = Math.min(powerPos[g.winner] ?? 99, powerPos[g.loser] ?? 99);
    // favorite is whoever's better in power; did they barely survive?
    const favWon = (powerPos[g.winner] ?? 99) <= (powerPos[g.loser] ?? 99);
    if (!favWon) continue; // if the favorite lost, that's a real upset (handled above)
    const closeness = g.margin; // smaller = closer call
    if (!nm || closeness < nm.margin) nm = { ...g, winnerRank: powerPos[g.winner], loserRank: powerPos[g.loser], _srcGame: g, margin: g.margin };
  }
  return nm ? { ...nm, kind: 'nearmiss' } : null;
}

// ---- prose helper with fallback ----
async function proseOr(section, df, facts, fallback, c) {
  try { const t = await prose(section, df, facts); c.ok++; console.log(`      \u2713 ${section}`); return t; }
  catch (e) { c.failed++; console.log(`      \u2717 ${section}: ${e.message}`); return fallback; }
}
async function prose(section, df, facts) {
  const prompt = buildSectionPrompt(section, df, { name: facts.leagueName, week: facts.week }).replace(/\{WEEK\}/g, facts.week);
  const text = await callLLM(prompt, { provider: provider() });
  return cleanProse(text, { week: facts.week });
}

// ---- structure helpers ----
function standingsTable(standings) {
  if (!standings.length) return '<p style="font-style:italic;color:#5b5142">Standings build as the season is synced.</p>';
  const last = standings.length - 1;
  const rows = standings.map((s, i) => {
    const cls = i < 7 ? 'champ' : (i === last ? 'cellar' : '');
    return `<tr class="${cls}"><td>${esc(s.teamName)}</td><td>${s.wins}-${s.losses}</td><td>${s.pf}</td></tr>`;
  }).join('');
  return `<table><caption>Season standings · by record, then points-for</caption><thead><tr><th>Team</th><th>Rec</th><th>PF</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// power rankings: weighted toward PERFORMANCE (avg points) over record, with real
// week-over-week movement arrows (green up / red down), saved for next week.
function powerRankOrder(ctx) {
  // score = 90% performance (avg points scored) + 10% record. Heavily performance-weighted
  // ON PURPOSE so the rankings differ from the plain standings — a team that scores big but
  // has bad luck should rank above its record, and vice versa.
  if (ctx.standings.length) {
    return [...ctx.standings].map(s => {
      const games = s.wins + s.losses;
      const winPct = games ? s.wins / games : 0;
      const perf = (s.avg || 0);
      return { roster_id: s.roster_id, name: s.teamName, score: perf * 0.9 + winPct * 100 * 0.1,
               avg: s.avg, rec: `${s.wins}-${s.losses}` };
    }).sort((a, b) => b.score - a.score);
  }
  return ctx.scoredThisWeek.map(s => ({ roster_id: s.rid, name: s.name, score: s.pts, avg: s.pts, rec: '' }));
}

function movementArrow(rid, i, prev) {
  if (!prev) return '';                       // no prior week -> nothing
  const was = prev.indexOf(rid);
  if (was === -1) return '';                  // new/unknown -> nothing
  const delta = was - i;                      // + = moved up
  if (delta === 0) return '';                 // same spot -> nothing (clean)
  if (delta > 0) return ` <span style="color:#2a6b2a;font-weight:700">▲${delta}</span>`;
  return ` <span style="color:#8a2018;font-weight:700">▼${-delta}</span>`;
}

function playoffTiersHtml(race, ctx) {
  const nm = (rid) => ctx.name(rid);
  const t = race.tiers;
  const tier = (title, cls, teams) =>
    `<div class="race-tier ${cls}"><h4>${title}</h4>${teams.map((tm) =>
      `<p><span class="seed">${cls === 'clinched' ? '\u2713' : (cls === 'eliminated' ? '\u2717' : tm.rank)}</span> ${esc(tm.teamName || nm(tm.roster_id))} <b>${tm.wins}-${tm.losses}</b></p>`).join('')}</div>`;
  // If the field is fully determined (nobody contending, nobody on the bubble), collapse
  // to just Clinched + Eliminated — the other two columns are empty and meaningless.
  const determined = (t.contending.length === 0 && t.bubble.length === 0);
  if (determined) {
    return `<div class="race-tiers race-tiers-2">${tier('\u2713 Clinched', 'clinched', t.clinched)}${tier('\u2717 Eliminated', 'eliminated', t.eliminated)}</div>`;
  }
  return `<div class="race-tiers">${tier('\u2713 Clinched', 'clinched', t.clinched)}${tier('In the Seats', 'contending', t.contending)}${tier('On the Bubble', 'bubble', t.bubble)}${tier('\u2717 Eliminated', 'eliminated', t.eliminated)}</div>`;
}

// Render the official Sleeper winners bracket (array of {r,m,t1,t2,w,l,...}).
// Groups matchups by round, shows seeds, marks advancing/eliminated, crowns the champ.
function bracketHtml(bracket, ctx, facts, lockedSeeds = {}) {
  const nm = (rid) => (rid == null ? 'TBD' : ctx.name(rid));
  const seedOf = (rid) => lockedSeeds[rid] || null;
  const seedBadge = (rid) => rid != null && seedOf(rid) ? `<span class="bseed">${seedOf(rid)}</span>` : `<span class="bseed">\u00b7</span>`;

  // WINNERS BRACKET ONLY: drop any game fed by a loser (t*_from.l) and any placement game
  // that isn't the championship (p present and !== 1). Consolation/losers are ignored.
  const isWinners = (g) =>
    !(g.t1_from && g.t1_from.l != null) && !(g.t2_from && g.t2_from.l != null) &&
    (g.p == null || g.p === 1);
  const winGames = bracket.filter(isWinners);

  const rounds = {};
  for (const m of winGames) { (rounds[m.r] ??= []).push(m); }
  const roundNums = Object.keys(rounds).map(Number).sort((a, b) => a - b);
  const totalRounds = roundNums.length;
  const roundName = (r) => {
    const fromEnd = totalRounds - r;
    if (fromEnd === 0) return 'Championship';
    if (fromEnd === 1) return 'Semifinals';
    if (fromEnd === 2) return 'Quarterfinals';
    return `Round ${r}`;
  };
  const shortRoundName = (r) => {
    const fromEnd = totalRounds - r;
    if (fromEnd === 0) return 'Final';
    if (fromEnd === 1) return 'SF';
    if (fromEnd === 2) return 'QF';
    return `R${r}`;
  };

  // PROGRESSIVE REVEAL: round r plays in week (playoffStart + r - 1). Only reveal a round's
  // results once that week has been REACHED by the paper being generated. Future rounds show
  // the matchup structure ("Winner of QF1") but NOT who actually advanced, and no champion.
  const playoffStart = facts.playoffStart || (facts.regWeeks ? facts.regWeeks + 1 : 15);
  const weekOfRound = (r) => playoffStart + (r - 1);
  const roundReached = (r) => facts.week >= weekOfRound(r);

  // For a slot fed by a prior game, build its "Winner of QF1" label. Number games within a
  // round by their position for readable labels.
  const gameLabelById = {};
  for (const r of roundNums) {
    rounds[r].forEach((g, i) => { gameLabelById[g.m] = `${shortRoundName(r)}${i + 1}`; });
  }
  const fedLabel = (from) => {
    if (!from) return 'TBD';
    if (from.w != null) return `Winner of ${gameLabelById[from.w] || 'prior game'}`;
    return 'TBD';
  };

  // Resolve which roster actually occupies a slot. A slot is either a direct entrant
  // (seed/bye, has a roster id, no feeder) or fed by a prior game's winner/loser. Because
  // the paper publishes AFTER all of a week's games, any game whose week has passed is
  // decided — so we can resolve the real advancing team, not "Winner of QF1".
  const gameById = {};
  for (const g of winGames) gameById[g.m] = g;
  const resolveSlot = (rid, from) => {
    // direct entrant (already has the roster id filled in by Sleeper)
    if (rid != null) return rid;
    if (!from) return null;
    const feeder = gameById[from.w != null ? from.w : from.l];
    if (!feeder) return null;
    // only resolve if the feeder game's WEEK has passed (so we don't spoil an unplayed round)
    if (!roundReached(feeder.r)) return null;
    if (from.w != null) return feeder.w ?? null;
    if (from.l != null) return feeder.l ?? null;
    return null;
  };

  // champion only once the FINAL round's week is reached and decided.
  let champId = null;
  const finalR = roundNums[totalRounds - 1];
  if (roundReached(finalR)) {
    const finalGame = rounds[finalR].find(m => m.p === 1 || m.p == null);
    if (finalGame && finalGame.w != null) champId = finalGame.w;
  }

  const cols = roundNums.map(r => {
    const reached = roundReached(r);
    rounds[r].sort((a, b) => a.m - b.m);
    const rows = rounds[r].map((m, gi) => {
      const decided = reached && m.w != null;
      const slot = (rawRid, from) => {
        // resolve the actual roster in this slot (follows feeder chains for played rounds)
        const rid = resolveSlot(rawRid, from);
        if (rid == null) {
          // genuinely not known yet (feeder round hasn't been played) -> show structure
          return `<div class="bteam tbd"><span class="bseed">\u00b7</span><span class="bnm">${esc(fedLabel(from))}</span></div>`;
        }
        // team is known. Mark win/loss only if THIS game is decided; otherwise it's a
        // known participant in an upcoming/undecided game (e.g. a finalist before the final).
        const won = decided && m.w === rid, lost = decided && m.l === rid;
        const cls = won ? ' adv' : (lost ? ' out' : (decided ? '' : ' pending'));
        return `<div class="bteam${cls}">${seedBadge(rid)}<span class="bnm">${esc(nm(rid))}</span>${won ? '<span class="chk">\u2713</span>' : ''}</div>`;
      };
      return `<div class="bmatch${decided ? ' done' : ''}">${slot(m.t1, m.t1_from)}${slot(m.t2, m.t2_from)}</div>`;
    }).join('');
    return `<div class="bround${reached ? '' : ' upcoming'}"><div class="bround-h">${roundName(r)}${reached ? '' : ` \u00b7 Wk ${weekOfRound(r)}`}</div><div class="bround-inner">${rows}</div></div>`;
  }).join('');

  const champBanner = champId != null
    ? `<div class="bchamp">\u265B League Champion \u00b7 <b>${esc(nm(champId))}</b> \u265B</div>`
    : '';
  return `<div class="bracket">${cols}</div>${champBanner}`;
}

// ---- MAIN ----
export async function renderIssue(action, facts) {
  const ctx = computeContext(facts);
  const wk = facts.week;
  const c = { ok: 0, failed: 0 };

  // PLAYOFF MODE: if a bracket exists and we're in a playoff week, the lead must cover an
  // actually-played WINNERS-bracket game this week — never the bye team, never a consolation
  // game. Determine this week's winners-bracket games from the bracket + week mapping.
  const inPlayoffs = !!(facts.bracket && facts.bracket.length && facts.week > (facts.regWeeks || 14));
  let playoffLead = null, playoffBrief = '';
  if (inPlayoffs) {
    const playoffStart = facts.playoffStart || ((facts.regWeeks || 14) + 1);
    const roundThisWeek = facts.week - playoffStart + 1;
    const isWinners = (g) => !(g.t1_from && g.t1_from.l != null) && !(g.t2_from && g.t2_from.l != null) && (g.p == null || g.p === 1);
    const thisWeekGames = facts.bracket.filter(g => g.r === roundThisWeek && isWinners(g) && g.w != null && g.l != null);
    // match bracket games to this week's actual scores (from ctx.thisWeek by roster)
    const ptsOf = {};
    ctx.thisWeek.forEach(gm => { ptsOf[gm.winner] = gm.winnerPts; ptsOf[gm.loser] = gm.loserPts; });
    const scored = thisWeekGames.map(g => {
      const wPts = ptsOf[g.w] ?? null, lPts = ptsOf[g.l] ?? null;
      const margin = (wPts != null && lPts != null) ? +Math.abs(wPts - lPts).toFixed(2) : 999;
      return { g, wPts, lPts, margin };
    });
    // "biggest game" = closest margin (most dramatic) among this week's winners games
    scored.sort((a, b) => a.margin - b.margin);
    const pick = scored[0];
    if (pick) {
      // IMPORTANT: use the ACTUAL game object from ctx.thisWeek (same reference), not a new
      // synthetic one — the "usedGames" set that stops two sections covering the same matchup
      // compares by object identity, so a synthetic object would never be excluded and the
      // Upset section would happily re-pick the lead's game.
      const realGame = ctx.thisWeek.find(gm =>
        (gm.winner === pick.g.w && gm.loser === pick.g.l) ||
        (gm.winner === pick.g.l && gm.loser === pick.g.w));
      playoffLead = realGame || {
        winner: pick.g.w, loser: pick.g.l,
        winnerName: ctx.name(pick.g.w), loserName: ctx.name(pick.g.l),
        winnerPts: pick.wPts, loserPts: pick.lPts, margin: pick.margin,
      };
    }
    const roundLabel = (() => {
      const totalRounds = Math.max(...facts.bracket.map(g => g.r));
      const fromEnd = totalRounds - roundThisWeek;
      if (fromEnd === 0) return 'the CHAMPIONSHIP';
      if (fromEnd === 1) return 'the SEMIFINALS';
      if (fromEnd === 2) return 'the QUARTERFINALS (Round 1)';
      return `Round ${roundThisWeek}`;
    })();
    playoffBrief = `PLAYOFF FORMAT (critical — this is the POSTSEASON, week ${facts.week}): 7 teams make the playoffs, single elimination. The #1 seed gets a BYE in Round 1 (they do NOT play in week ${playoffStart}). Round 1 = week ${playoffStart} (seeds 2-7 play), Semifinals = week ${playoffStart + 1}, Championship = week ${playoffStart + 2}. This week is ${roundLabel}. Do NOT use regular-season language like "playoff race," "bubble team," "clinching," or "first-round bye at risk" — those are OVER. This is win-or-go-home. The stakes are ADVANCING vs ELIMINATION.`;
  }

  const leadPick = pickLeadGame(ctx, facts);
  const gow = playoffLead || leadPick?.game || ctx.closest || ctx.thisWeek[0];
  const isReview = action.type === 'YEAR_REVIEW';
  const s = {};

  // Subject distribution: track which games have been used as a section's MAIN focus,
  // so no two sections lead with the same matchup. Each game-picking section calls
  // pickUnused() to prefer a game nobody's claimed yet.
  const usedGames = new Set([gow]);
  const pickUnused = (candidates, fallback) => {
    const fresh = candidates.filter(g => !usedGames.has(g));
    const pick = (fresh.length ? fresh : candidates)[0] || fallback;
    if (pick) usedGames.add(pick);
    return pick;
  };
  {
    // build explicit stakes context for the writer, from real standings
    const wRank = gow?.winnerRank, lRank = gow?.loserRank;
    const wRec = gow?.winnerRec, lRec = gow?.loserRec;
    const wPrevSeed = ctx.prevRankOf[gow?.winner], lPrevSeed = ctx.prevRankOf[gow?.loser];
    const moveNote = (wRank && wPrevSeed && wRank !== wPrevSeed ? ` ${gow.winnerName} moved from #${wPrevSeed} to #${wRank} after this result.` : '')
      + (lRank && lPrevSeed && lRank !== lPrevSeed ? ` ${gow.loserName} slipped from #${lPrevSeed} to #${lRank}.` : '');
    // How much should this game be framed around the PLAYOFF picture? That depends entirely
    // on how deep into the season we are. Telling the model to "make the playoff implications
    // obvious" in Week 2 produced exactly what you'd expect: a 1-1 team described as staring
    // down "elimination" and "playoff dread", and a meaningless Week-2 standings position
    // reported as though it were a locked-in seed. Early on, the story is the GAME.
    const regWeeks = facts.regWeeks || 14;
    const phase = wk <= 4 ? 'EARLY' : (wk <= Math.min(9, regWeeks - 5) ? 'MID' : 'LATE');

    const earlyNote = `It is only WEEK ${wk} of ${regWeeks}. Do NOT frame this around the playoffs — nobody is "on the bubble", nobody is near "elimination", and a standings position this early is noise, not a seed. Do NOT mention playoff seeding, the bubble, or elimination at all. The story is THE GAME ITSELF: the performance, the collapse, the surprise, what it says about these two teams. Records (${wRec} and ${lRec}) are fine to state plainly.`;

    const midNote = `It is week ${wk} of ${regWeeks} (7 of 14 make the playoffs). The playoff picture is starting to take shape, but it is NOT settled — you may touch on what this result suggests about where these teams are heading, but do not treat current position as a locked seed and do not talk about elimination. The GAME is still the main story.`;

    const lateNote = `STAKES: ${gow.winnerName} is ${wRec} (was #${wPrevSeed ?? wRank} going in, now #${wRank} of 14); ${gow.loserName} is ${lRec} (was #${lPrevSeed ?? lRank}, now #${lRank}). It is week ${wk} of ${regWeeks} — 7 teams make the playoffs, and the race is REAL now.${moveNote} Make it clear why this game matters to the playoff picture (seeding, the bubble, a contender stumbling). IMPORTANT: describe each team by where they stood GOING INTO the game and how this result MOVED them — never call a team "the #${lRank} seed" as if they were already there before losing; say "the now-#${lRank} seed" or "fell from #${lPrevSeed ?? '?'}".`;

    const stakesNote = inPlayoffs
      ? `${playoffBrief} This is the featured playoff game: ${gow?.winnerName} defeated ${gow?.loserName} ${num(gow?.winnerPts)}-${num(gow?.loserPts)}. Write it as a PLAYOFF story — the winner ADVANCES, the loser is ELIMINATED (unless this is the championship, in which case the winner is CHAMPION). Lead with the drama and the stakes of surviving/advancing.`
      : (phase === 'EARLY')
      ? earlyNote
      : (wRank && lRank)
      ? (phase === 'MID' ? midNote : lateNote)
      : `This is the marquee game of the week — make clear why it stands out.`;
    const df = { winner: gow?.winnerName, loser: gow?.loserName,
      winnerPts: gow?.winnerPts, loserPts: gow?.loserPts, margin: gow?.margin,
      winnerRecord: wRec, loserRecord: lRec, winnerSeed: wRank, loserSeed: lRank,
      // The cross-reference rule also has to respect the phase: in the early weeks there IS no
      // playoff picture to reference, so inviting "held their seed / the final spot" language
      // would drag the playoffs straight back in through the side door.
      note: `${stakesNote} Write a HEADLINE, a one-sentence DEK, a punchy PULL-QUOTE, and the BODY. Format exactly as: HED: ...\\nDEK: ...\\nPULL: ...\\nBODY: ... — centered on THIS ONE GAME (${gow?.winnerName} vs ${gow?.loserName}). Break the BODY into 2-3 short paragraphs (separate them with a blank line). RULES: Do NOT recap or narrate any OTHER matchup (no other game's play-by-play or score as its own story). ${phase === 'EARLY'
        ? `Keep the focus squarely on this game. Do NOT bring in the playoff race, seeding, the bubble or elimination — it is far too early for any of that to mean anything.`
        : `You MAY reference other teams ONLY when it affects the PLAYOFF/STANDINGS implications of THIS game — e.g. "held their seed only because their pursuers also lost," "the loss dropped them behind X for the final spot." Keep the focus on this game and what it means for the standings.`}` };
    let hed = gow ? `${gow.winnerName} Edges ${gow.loserName}` : `Week ${wk}`;
    let dek = '', pull = '', body = '';
    try {
      const raw = await callLLM(buildSectionPrompt('lead', df, { name: facts.leagueName, week: wk }).replace(/\{WEEK\}/g, wk), { provider: provider() });
      const line = (s) => s.replace(/\{WEEK\}/g, wk).replace(/\*\*(.+?)\*\*/g, '$1').replace(/(?<!\*)\*(?!\*)([^*]+?)\*(?!\*)/g, '$1').replace(EMOJI, '').trim();
      // robust label-delimiter parse — handles labels run together without clean newlines,
      // so "HED:", "DEK:" etc. never leak into the printed article.
      const f = parseLabeledFields(raw, ['HED', 'DEK', 'PULL', 'BODY']);
      hed = line(f.hed || hed);
      dek = line(f.dek || '');
      // PULL guard: a pull-quote is ONE short sentence. If the model emitted "PULL:" and then
      // flowed straight into the article with no "BODY:" label, the PULL field captures the
      // whole piece. Detect that (no body found + long pull) and split: first sentence (or the
      // quoted string) is the pull, the rest becomes the body.
      let rawPull = f.pull || '';
      let spilloverBody = '';
      const pullWords = rawPull.split(/\s+/).filter(Boolean).length;
      // A pull-quote is ONE short quoted line. If PULL contains a quoted string followed by
      // MORE text (the article flowing in with no BODY: label), OR is just too long, split it:
      // the quote (or first sentence) is the pull, the rest becomes body.
      const quoted = rawPull.match(/^\s*["\u201c][^"\u201d]{3,}["\u201d]/);
      const hasSpillAfterQuote = quoted && rawPull.slice(quoted[0].length).trim().length > 0;
      if ((!f.body && pullWords > 16) || hasSpillAfterQuote) {
        if (quoted) {
          pull = line(quoted[0]);
          spilloverBody = rawPull.slice(quoted[0].length).trim();
        } else {
          const firstSentence = rawPull.match(/^.*?[.!?](\s|$)/);
          pull = line(firstSentence ? firstSentence[0] : rawPull.split(/\s+/).slice(0, 16).join(' '));
          spilloverBody = firstSentence ? rawPull.slice(firstSentence[0].length).trim() : '';
        }
      } else {
        pull = line(rawPull);
      }
      // final hard guard: a pull-quote should never exceed ~25 words
      if (pull.split(/\s+/).filter(Boolean).length > 25) {
        const fs = pull.match(/^.*?[.!?](\s|$)/);
        pull = fs ? line(fs[0]) : line(pull.split(/\s+/).slice(0, 18).join(' '));
      }
      // if BODY was found use it; otherwise use the spillover (from a runaway PULL) or raw
      // MINUS any labels (so the fallback never dumps "HED: ... DEK: ..." into the body).
      let bodySrc = f.body || spilloverBody;
      if (!bodySrc) {
        bodySrc = raw.replace(/\b(HED|DEK|PULL|BODY)\s*:\s*/gi, '').trim();
      }
      body = cleanProse(bodySrc, { week: wk });
      c.ok++; console.log('      \u2713 lead');
    } catch (e) { c.failed++; console.log(`      \u2717 lead: ${e.message}`); body = `<p class="drop">${esc(gow?.winnerName)} edged ${esc(gow?.loserName)} by ${num(gow?.margin)}.</p>`; }
    // quote comes from the WINNER of the lead game (not a random top scorer)
    const q = gow ? await writeQuote(gow.winnerName, { context: `beat ${gow.loserName} ${gow.winnerPts}-${gow.loserPts} in the game of the week (${wRec || ''})` }, provider()) : null;
    s.lead = { edition: `Week ${wk}`, kicker: 'Game of the Week', hed,
      dek: dek || (gow ? `${gow.winnerName} (${wRec}) took down ${gow.loserName} (${lRec}), ${num(gow.winnerPts)}–${num(gow.loserPts)}.` : ''),
      bodyHtml: body, pull, quotes: q ? [q] : [],
      sideBoxHtml: gow ? `<div class="box"><div class="box-h">Final \u00b7 Game of the Week</div><div class="stat-line"><span>${esc(gow.winnerName)}${wRec ? ` <span style="color:#8a7f6a">(${wRec})</span>` : ''}</span><b>${num(gow.winnerPts)}</b></div><div class="stat-line"><span>${esc(gow.loserName)}${lRec ? ` <span style="color:#8a7f6a">(${lRec})</span>` : ''}</span><b>${num(gow.loserPts)}</b></div><div class="stat-line" style="border:none;margin-top:6px"><span>Margin</span><b>${num(gow.margin)}</b></div></div>` +
        (ctx.top && ctx.bottom ? `<div class="box"><div class="box-h">Weather \u00b7 Week ${wk}</div><p><b>High:</b> ${ctx.top.pts}.</p><p><b>Low:</b> ${ctx.bottom.pts}.</p><p><b>Spread:</b> ${(ctx.top.pts - ctx.bottom.pts).toFixed(1)} pts.</p></div>` : '') : '' };
  }

  // CONTROVERSY — reconnected. Focus on a DIFFERENT game than the lead (subject
  // distribution — don't rehash the game of the week).
  {
    // pick a game that ISN'T the lead's game (or any already used): biggest blowout among the rest
    const others = ctx.thisWeek.filter(x => !usedGames.has(x)).sort((a, b) => b.margin - a.margin);
    const focusGame = pickUnused(others.length ? others : ctx.thisWeek, gow);
    let plan;
    try {
      const csv = process.env.SUBMISSIONS_CSV || '';
      let subs = [];
      if (csv) { const { fetchSubmissions } = await import('../lib/controversy.js'); subs = await fetchSubmissions(csv, { sinceMs: Date.now() - 7 * 864e5 }); }
      const focusStandings = ctx.standings.map(st => ({ team: st.teamName, rec: `${st.wins}-${st.losses}`, rank: st.rank }));
      plan = planControversy(subs, {
        biggestBlowout: focusGame,
        controversySeed: { game: focusGame ? { winner: focusGame.winnerName, loser: focusGame.loserName, winnerPts: focusGame.winnerPts, loserPts: focusGame.loserPts } : null, standings: focusStandings, week: wk },
        topBenchCrime: null, avoidGame: gow,
      }, { season: facts.season, week: wk });
    } catch { plan = { mode: 'invented', seedFacts: focusGame }; }
    // Subject distribution applies only when MANUFACTURING. A player submission dictates
    // its own topic, so it's exempt from the "avoid the lead game" rule.
    const distributionNote = (plan.mode !== 'submitted')
      ? `\n\nIMPORTANT: Do NOT write about the ${gow ? esc(gow.winnerName) + ' vs ' + esc(gow.loserName) : 'game of the week'} matchup, or any game already covered elsewhere — find your angle in a DIFFERENT game or team this week.`
      : '';
    const cprompt = controversyPrompt(plan, PERSONA, facts.identity) + distributionNote;
    let body;
    try { body = cleanProse(await callLLM(cprompt, { provider: provider() }), { week: wk }); c.ok++; console.log('      \u2713 controversy'); }
    catch (e) { c.failed++; console.log(`      \u2717 controversy: ${e.message}`); body = `<p class="drop">The Herald's rumor desk is quiet this week. Suspiciously quiet.</p>`; }
    // Controversy pull-quote — separately written, ABOUT this controversy story, styled
    // differently from the lead's quote. Fed the article so it stays on-topic.
    let cPull = '';
    try {
      const plain = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
      const pqPrompt = `You are Vince Malloy. Below is a "Controversy Corner" column you just wrote. Pull ONE short, punchy line (8-16 words) that captures its spiciest point, to run as a pull-quote beside it. It must reflect THIS column's content. Return only the line — no quotes marks, no markdown, no emoji, no ALL-CAPS.\n\nCOLUMN: ${plain}`;
      const raw = (await callLLM(pqPrompt, { provider: provider() })).trim().replace(/^["'\u201c]|["'\u201d]$/g, '').replace(/\{WEEK\}/g, wk).replace(EMOJI, '').trim();
      if (raw && raw.length < 140) cPull = raw;
    } catch {}
    // "The Last Word" — a fresh sign-off each week, same Malloy attitude, new wording.
    let lastWord = `That's Week ${wk}. The scores are final, the excuses are eternal, and Malloy will be here next Tuesday whether you like it or not.`;
    try {
      const lwPrompt = `You are Vince Malloy, cynical fantasy-football newspaper columnist. Write ONE punchy closing sign-off line for this week's issue (Week ${wk}) — the paper's final "Last Word." Same attitude every week (weary, cutting, self-important, threatening to return next week) but FRESH wording. One sentence, under 30 words. No markdown, no emoji, no ALL-CAPS. Return only the line.`;
      const lw = (await callLLM(lwPrompt, { provider: provider() })).trim().replace(/^["'\u201c]|["'\u201d]$/g, '').replace(/\{WEEK\}/g, wk);
      if (lw && lw.length < 220) lastWord = lw;
    } catch {}
    s.controversy = { mode: plan.mode, tag: plan.mode === 'submitted' ? 'Letters to the Editor' : 'Manufactured Outrage',
      bodyHtml: body, pull: cPull, submittedTake: plan.submission?.take || '', submitter: plan.submission?.name || '' };
    s.backPageCaption = lastWord;
  }

  // UPSET — cascade: power rankings -> record -> last week -> near-miss (never "chalk")
  {
    const u = findUpset(ctx, facts, usedGames);
    if (u && u._srcGame) usedGames.add(u._srcGame);
    if (u && u.kind !== 'nearmiss') {
      const basis = u.kind === 'power' ? 'power ranking' : (u.kind === 'lastweek' ? "last week's standing" : 'record');
      const df = { winner: u.winnerName, loser: u.loserName, winnerPts: u.winnerPts, loserPts: u.loserPts,
        winnerRank: u.winnerRank, loserRank: u.loserRank, basis,
        note: `This is a genuine UPSET by ${basis}: the lower-ranked ${u.winnerName} beat the higher-ranked ${u.loserName}. Write about ONE game only — do not mention other matchups.` };
      s.upset = { tag: 'Cinderella', bodyHtml: await proseOr('upset', df, facts,
        `<p class="drop">${esc(u.winnerName)} took down the higher-ranked ${esc(u.loserName)}, ${u.winnerPts}–${u.loserPts} — the underdog bites.</p>`, c) };
    } else if (u && u.kind === 'nearmiss') {
      const df = { favorite: u.winnerName, challenger: u.loserName, favPts: u.winnerPts, chalPts: u.loserPts, margin: u.margin,
        note: `No true upset this week, so cover the CLOSEST CALL: the favorite ${u.winnerName} barely survived ${u.loserName}, winning by just ${u.margin}. Frame it as "the upset that almost happened" — the favorite sweating it out. ONE game only, no other matchups.` };
      s.upset = { tag: 'Upset Watch', bodyHtml: await proseOr('upset', df, facts,
        `<p class="drop">${esc(u.winnerName)} survived the closest scare of the week, holding off ${esc(u.loserName)} by just ${u.margin}. The upset that almost was.</p>`, c) };
    } else {
      s.upset = { tag: 'Upset Watch', bodyHtml: `<p class="drop">Every favorite held firm this week — no scares worth reporting. The order stands, for now.</p>` };
    }
  }

  // BENCH REPORT — worst start/sit blunders: benched player who outscored a same-position
  // starter. Up to 3 across the league.
  {
    const crimes = benchCrimeReport(ctx.thisWeek, facts.playerMap || {}, (rid) => ctx.name(rid), { limit: 3, minGap: 6 });
    if (crimes.length) {
      const items = crimes.map(cr =>
        `<div class="stat-line" style="display:block;border-bottom:1px dotted var(--stamp);padding:6px 0">` +
        `<b>${esc(cr.team)}</b> started <b>${esc(cr.started)}</b> (${cr.startedPts}) at ${esc(cr.pos)} ` +
        `while <b>${esc(cr.benched)}</b> put up <b>${cr.benchedPts}</b> on the bench ` +
        `<span style="color:#8a2018">(&minus;${cr.gap})</span>.</div>`).join('');
      s.benchReport = { tag: 'Blotter', boxHtml:
        `<div class="box"><div class="box-h">Grand Larceny <span style="color:var(--stamp)">Worst Start/Sit Calls</span></div>${items}</div>` };
    } else {
      s.benchReport = { tag: 'Blotter', boxHtml:
        `<div class="box"><div class="box-h">Grand Larceny</div><p>Clean week on the benches — no egregious start/sit blunders. Suspicious.</p></div>` };
    }
  }

  // LUCK — highest-scoring loser (robbed) + lowest-scoring winner (blessed) + fresh quote
  {
    const losers = ctx.thisWeek.map(g => ({ name: g.loserName, pts: g.loserPts })).sort((a, b) => b.pts - a.pts);
    const winners = ctx.thisWeek.map(g => ({ name: g.winnerName, pts: g.winnerPts })).sort((a, b) => a.pts - b.pts);
    const robbed = losers[0], blessed = winners[0];
    let box = '';
    if (robbed) box += `<div class="box"><div class="box-h">Robbed</div><p><b>${esc(robbed.name)}</b> — scored ${robbed.pts} and still lost.</p></div>`;
    if (blessed) box += `<div class="box"><div class="box-h">Blessed</div><p><b>${esc(blessed.name)}</b> — won with just ${blessed.pts}.</p></div>`;
    const q = robbed ? await writeQuote(robbed.name, { context: `scored ${robbed.pts} and still lost this week` }, provider()) : null;
    s.luck = { tag: 'Fortune', boxHtml: box, quotes: q ? [q] : [] };
  }

  // RIVALRY — pick the SPICIEST of this week's matchups by all-time history, show the
  // all-time record, and write it like a real rivalry piece with bad blood.
  {
    const hist = loadHistory();
    // history.json's chain STARTS with the current league, so it can contain the current
    // season's games too. The current season is counted separately from the live DB
    // (seasonH2H below), so we must EXCLUDE the current season here or every current-season
    // meeting gets counted twice. History = PRIOR seasons only.
    const histGames = (hist?.games || []).filter(g => String(g.season) !== String(facts.season));
    const ownerOf = (rid) => facts.identity.ownerOf(rid);

    // this season's completed games, as owner-keyed head-to-head (so the rivalry count
    // includes current-season meetings, not just prior years).
    const allSeasonWeeks = facts.leagueId ? weeksThrough(facts.leagueId, facts.week) : [ctx.thisWeek];
    const seasonH2H = (oa, ob) => {
      const out = [];
      for (const wkGames of allSeasonWeeks) {
        for (const gm of wkGames) {
          const wo = ownerOf(gm.winner), lo = ownerOf(gm.loser);
          if ((wo === oa && lo === ob) || (wo === ob && lo === oa)) {
            out.push({ week: facts.week, winner: wo, loser: lo, winnerPts: gm.winnerPts, loserPts: gm.loserPts });
          }
        }
      }
      return out;
    };

    // score each of this week's games for "spiciness" using all-time head-to-head.
    // EXCLUDE games already used by other sections (lead, controversy) so rivalry is fresh.
    let best = null;
    const rivalryCandidates = ctx.thisWeek.filter(x => !usedGames.has(x));
    const pool = rivalryCandidates.length ? rivalryCandidates : ctx.thisWeek;
    for (const g of pool) {
      const oa = ownerOf(g.winner), ob = ownerOf(g.loser);
      const thisSeason = (oa && ob) ? seasonH2H(oa, ob) : [];
      const r = (oa && ob) ? rivalryStats(oa, ob, histGames, thisSeason) : { meetings: 0, aWins: 0, bWins: 0 };
      // spicy = lots of meetings, close all-time record, or a chronic close margin
      const balance = r.meetings ? 1 - Math.abs(r.aWins - r.bWins) / r.meetings : 0; // 1 = dead even
      const spice = r.meetings * 1.0 + balance * 3 + (10 - Math.min(10, g.margin)) * 0.2;
      if (!best || spice > best.spice) best = { g, r, oa, ob, spice };
    }
    const g = best?.g || pool[0];

    // ---- RIVALRY DEBUG (temporary) ----
    if (best && process.env.RIV_DEBUG) {
      const oa = best.oa, ob = best.ob;
      const nmA = ctx.name(g.winner), nmB = ctx.name(g.loser);
      console.log('\n===== RIVALRY DEBUG: ' + nmA + ' vs ' + nmB + ' =====');
      console.log('owner A (' + nmA + '):', oa, '| owner B (' + nmB + '):', ob);
      console.log('current LEAGUE_ID:', facts.leagueId, '| week:', facts.week);
      const histMatches = histGames.filter(x =>
        (x.win === oa && x.lose === ob) || (x.win === ob && x.lose === oa));
      console.log('--- history.json meetings: ' + histMatches.length + ' ---');
      histMatches.forEach(x => console.log('   [hist] season=' + x.season + ' W' + x.week + '  ' + x.win + ' ' + x.ws + ' vs ' + x.lose + ' ' + x.ls));
      const seasonMatches = seasonH2H(oa, ob);
      console.log('--- live season DB meetings: ' + seasonMatches.length + ' ---');
      seasonMatches.forEach(x => console.log('   [live] W' + x.week + '  ' + x.winner + ' ' + x.winnerPts + ' vs ' + x.loser + ' ' + x.loserPts));
      console.log('--- rivalryStats TOTAL: ' + best.r.meetings + ' (aWins=' + best.r.aWins + ' bWins=' + best.r.bWins + ') ---');
      console.log('   >> history seasons present:', [...new Set(histGames.map(x => x.season))].sort().join(', '));
      console.log('=====================================\n');
    }
    // ---- END RIVALRY DEBUG ----

    if (g) usedGames.add(g);
    const r = best?.r || { meetings: 0, aWins: 0, bWins: 0 };
    // r.aWins = wins for owner `oa` (this week's WINNER); r.bWins = owner `ob` (loser)
    const winnerAllTime = r.aWins, loserAllTime = r.bWins;
    let allTime;
    if (!r.meetings) {
      allTime = `First recorded meeting between ${esc(g.winnerName)} and ${esc(g.loserName)}`;
    } else if (winnerAllTime === loserAllTime) {
      allTime = `The all-time series is dead even at ${winnerAllTime}\u2013${loserAllTime} over ${r.meetings} meetings`;
    } else {
      const leader = winnerAllTime > loserAllTime ? g.winnerName : g.loserName;
      const hi = Math.max(winnerAllTime, loserAllTime), lo = Math.min(winnerAllTime, loserAllTime);
      allTime = `${esc(leader)} leads the all-time series ${hi}\u2013${lo} over ${r.meetings} meetings`;
    }

    // Build the AUTHORITATIVE record string ONCE. Both the box and the article use this
    // exact text, so they can never disagree. The LLM is told to state it verbatim.
    const leaderName = winnerAllTime === loserAllTime ? null : (winnerAllTime > loserAllTime ? g.winnerName : g.loserName);
    const recordPhrase = !r.meetings
      ? `this is their first-ever meeting`
      : (winnerAllTime === loserAllTime
        ? `the all-time series is dead even at ${winnerAllTime}-${loserAllTime} over ${r.meetings} meetings`
        : `${leaderName} leads the all-time series ${Math.max(winnerAllTime, loserAllTime)}-${Math.min(winnerAllTime, loserAllTime)} over ${r.meetings} meetings`);

    // richer stats for the writer (r.a* is keyed to the WINNER of this week's game).
    const winnerPF = r.aPF, loserPF = r.bPF;
    const pfLeader = winnerPF === loserPF ? null : (winnerPF > loserPF ? g.winnerName : g.loserName);
    const pfDiffAbs = Math.abs(+(winnerPF - loserPF).toFixed(2));
    const streakName = r.streakOwner == null ? null : (r.streakOwner === best.oa ? g.winnerName : g.loserName);
    // name resolver for owner ids in the meeting log
    const rivalName = (oid) => (facts.identity.nameOfOwner ? facts.identity.nameOfOwner(oid) : oid);
    // past meetings (most recent first) so the writer can cite ACTUAL old games
    const pastMeetings = (r.last5 || []).slice().reverse().map(m => {
      const yr = m.season === 'current' ? facts.season : m.season;
      return `${yr} Wk ${m.week}${m.playoff ? ' (playoff)' : ''}: ${rivalName(m.win)} beat ${rivalName(m.lose)} ${num(m.ws)}-${num(m.ls)}`;
    });

    const df = { a: g.winnerName, b: g.loserName, aPts: g.winnerPts, bPts: g.loserPts,
      allTimeMeetings: r.meetings, aAllTimeWins: r.aWins, bAllTimeWins: r.bWins,
      exactRecord: recordPhrase,
      closestEverMargin: r.closest?.margin, biggestEverMargin: r.biggest?.margin,
      avgMargin: r.avgMargin,
      allTimePointDiff: pfLeader ? `${pfLeader} has outscored the other by ${pfDiffAbs} points all-time` : 'the teams are dead even on all-time points',
      currentStreak: streakName && r.streak > 1 ? `${streakName} has won the last ${r.streak} meetings` : null,
      playoffHistory: r.playoffMeetings ? `they have met ${r.playoffMeetings} time(s) in the playoffs` : 'they have never met in the playoffs',
      pastMeetings,  // actual old games to reference
      note: `Write this like a real newspaper RIVALRY column: lean on the bad blood and the HISTORY. Reference SPECIFIC past games from the list provided (cite the season, week, and score — e.g. "back in their 2024 Week 14 clash..."). Weave in the color: all-time point differential, average margin, any active win streak, playoff meetings. CRITICAL: the all-time record is EXACTLY this — "${recordPhrase}". State it with these EXACT numbers; do NOT invent or change the meeting count, record, or any score. Only cite games from the list. Do NOT just recap this week's score — tell the story of the whole series.` };

    s.rivalry = { tag: 'Multi-Year · The Long Memory',
      bodyHtml: await proseOr('rivalry', df, facts, g ? `<p class="drop">${esc(g.winnerName)} and ${esc(g.loserName)} renew an old grudge; ${esc(g.winnerName)} takes the latest round ${num(g.winnerPts)}–${num(g.loserPts)}.</p>` : '', c),
      boxHtml: `<div class="box"><div class="box-h">All-Time Series</div><p style="font-style:italic">${allTime}.</p>` +
        `<div class="stat-line" style="margin-top:6px"><span>${esc(g.winnerName)}</span><b>${num(g.winnerPts)}</b></div><div class="stat-line"><span>${esc(g.loserName)}</span><b>${num(g.loserPts)}</b></div></div>` };
  }

  // POWER RANKINGS — performance-weighted (90% scoring / 10% record), real movement arrows.
  // NO commentary: rank, name, movement arrow, record and average only. The old per-team
  // one-liners varied wildly in length (4 words to 25+), which made the two columns render
  // at wildly different heights and look lopsided. Pure data keeps every row one line, so
  // the columns balance by construction. No LLM call needed here at all.
  {
    const order = powerRankOrder(ctx);
    const prev = facts.leagueId ? prevRankings(facts.leagueId, wk) : null;

    const lineFor = (r, i) => {
      const arrow = movementArrow(r.roster_id, i, prev);
      const red = i === order.length - 1 ? 'color:#8a2018;' : '';
      const detail = r.rec ? `${r.rec} \u00b7 ${num(r.avg)} avg` : `${num(r.avg)}`;
      // ONE LINE PER ROW, and it must STAY INSIDE THE COLUMN.
      // The row is a non-wrapping flex line. The NAME is the only part allowed to shrink —
      // and it needs BOTH `min-width:0` and `overflow:hidden` to do so: a flex child refuses
      // to shrink below its content width without min-width:0, which is why long names were
      // punching out of the column and bleeding into the standings table beside it. The
      // record/average is never truncated (it's the actual information), so a very long team
      // name simply ellipses.
      return `<p style="${red}display:flex;align-items:baseline;gap:6px;overflow:hidden">` +
        `<b style="flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i + 1}. ${esc(r.name)}</b>` +
        `<span style="flex:none;white-space:nowrap">${arrow}</span>` +
        `<span style="flex:none;white-space:nowrap;color:#8a7f6a">(${detail})</span></p>`;
    };
    // Explicit even split: first half left, second half right, so 14 teams give a clean 7/7.
    const half = Math.ceil(order.length / 2);
    const leftCol = order.slice(0, half).map((r, i) => lineFor(r, i)).join('');
    const rightCol = order.slice(half).map((r, i) => lineFor(r, i + half)).join('');
    const lines = `<div style="display:grid;grid-template-columns:1fr 1fr;column-gap:28px"><div>${leftCol}</div><div>${rightCol}</div></div>`;
    s.powerRankings = { tag: `Week ${wk} \u00b7 By Performance, Not Just Record`, bodyHtml: lines };
    if (facts.leagueId) saveRankings(facts.leagueId, wk, order.map(r => r.roster_id));
  }

  // STANDINGS — real W-L records
  s.standings = { hed: `After Week ${wk}`, tableHtml: standingsTable(ctx.standings) };

  // TRADE WINDS — grounded rumor mill. Names specific teams with real positional needs,
  // generates trade rumors, and roasts the trade-shy (phones unanswered). Remembers prior
  // rumors so it doesn't repeat and can escalate a persistent hole.
  {
    const depth = facts.rosterDepth || [];
    // teams that are natural trade candidates (a hole AND a surplus), most interesting first
    const candidates = depth.filter(d => d.thin.length).map(d => ({
      team: d.name, roster_id: d.roster_id,
      needs: d.thin.map(t => `${t.pos} (only ${t.have})`),
      surplus: d.stacked.map(s => `${s.pos} (${s.have})`),
    }));
    // trade-shy: teams flagged "Never" traded or 90+ days stale
    const shy = (facts.staleness || []).filter(t => t.never || (t.days ?? 0) >= 90).map(t => t.name).slice(0, 4);
    // memory: prior weeks' rumor subjects, to avoid repeats + enable escalation
    const prior = facts.leagueId ? priorRumors(facts.leagueId, wk) : [];
    const priorByTeam = {};
    for (const p of prior) (priorByTeam[p.roster_id] ??= []).push(p);

    // pick up to 3 rumor subjects this week, preferring teams we HAVEN'T recently covered
    const ranked = candidates.sort((a, b) => (priorByTeam[a.roster_id]?.length || 0) - (priorByTeam[b.roster_id]?.length || 0));
    const picks = ranked.slice(0, 3);
    // note escalation for any team whose SAME need persists from a prior week
    const escalations = picks.filter(p => (priorByTeam[p.roster_id] || []).some(x => p.needs.join().includes(x.pos)))
      .map(p => p.team);

    // STRATEGIC MISALIGNMENT — every team's roster shape vs. their competitive situation.
    // The engine supplies raw facts only (record + oldest/youngest assets, bench flags); the
    // WRITER decides who's "aging", who's a rebuilder clinging to vets, and which contender
    // is letting youth rot on the bench. No hardcoded age thresholds.
    const standBy = {};
    (ctx.standings || []).forEach(st => { standBy[st.roster_id] = st; });
    const rosterShapes = (facts.rosterProfiles || []).map(p => {
      const st = standBy[p.roster_id] || {};
      const rec = st.wins != null ? `${st.wins}-${st.losses}` : '?';
      const place = st.rank ? `#${st.rank} of ${(ctx.standings || []).length}` : '';
      return {
        team: p.name,
        record: `${rec}${place ? ` (${place})` : ''}`,
        oldestAssets: p.oldest,
        youngestAssets: p.youngest,
        youngOnBench: p.benchedYouth,
      };
    });

    const df = {
      candidates: picks.map(p => `${p.team}: thin at ${p.needs.join(', ')}${p.surplus.length ? `, but loaded at ${p.surplus.join(', ')}` : ''}`),
      tradeShy: shy,
      escalating: escalations,
      rosterShapes,
      note: `Write a TABLOID trade-rumor column (Malloy's Rumor Mill). Cook up plausible trade RUMORS — who's "fielding calls", whose phone "should be ringing", who's shopping a surplus to fix a hole. TWO kinds of material: (1) POSITIONAL NEEDS — the teams listed in "candidates" have real holes/surpluses. (2) STRATEGIC MISALIGNMENT — study "rosterShapes": every team's record plus their oldest and youngest assets (and which young players are stuck on the BENCH). YOU decide who is misaligned: a team going nowhere still clinging to declining older assets whose value bleeds away every week they don't sell; a clear contender with young players rotting on the bench who should be flipping that youth for win-now help. Name the specific teams and the specific players. Mock the trade-shy whose phones "ring unanswered" while their roster stays broken. ${escalations.length ? `ESCALATE on these teams — their hole has persisted for weeks and they STILL haven't moved: ${escalations.join(', ')} (get exasperated/mocking).` : ''} Vary WHICH teams you cover week to week — don't fixate on the same names. Gossipy, fun, speculative. These are RUMORS — do NOT claim a trade actually happened. Use only the players/teams given.`,
    };
    const q = await writeQuote('a source familiar with the matter', { context: `gossiping about which team desperately needs to make a trade after week ${wk}` }, provider());
    s.tradeWinds = { tag: 'Rumor Mill · Unconfirmed, Unbothered',
      bodyHtml: await proseOr('tradeWinds', df, facts, `<p class="drop">The trade block was quiet this week. Suspiciously quiet — a few rosters could use a phone call they're clearly too proud to make.</p>`, c),
      quotes: q ? [q] : [] };

    // remember this week's rumor subjects for next week's memory/escalation
    if (facts.leagueId && picks.length) {
      saveRumors(facts.leagueId, wk, picks.map(p => ({ roster_id: p.roster_id, pos: p.needs.join(','), topic: 'need' })));
    }
  }

  // TRADE DESK — staleness + tiers wired from trade data if provided in facts
  {
    const staleHtml = facts.staleness?.length
      ? `<div class="box"><div class="box-h">Staleness Watch <span style="color:var(--stamp)">90+ DAYS FLAGGED</span></div>${facts.staleness.slice(0, 6).map(t =>
          `<div class="stat-line"><span>${esc(t.name)}</span><b${(t.never || t.days >= 90) ? ' style="color:#8a2018"' : ''}>${t.never ? 'Never' : t.days + ' days'}${(!t.never && t.days >= 90) ? ' \u2744' : ''}</b></div>`).join('')}</div>`
      : `<div class="box"><div class="box-h">Staleness Watch</div><p style="font-style:italic;color:#5b5142">Run build-history to populate trade dates.</p></div>`;
    const tiersHtml = facts.traderTiers?.length
      ? `<div class="box"><div class="box-h">Trader Tiers <span style="color:var(--stamp)">ALL-TIME</span></div>${facts.traderTiers.slice(0, 6).map(t =>
          `<div class="stat-line"><span><b>${esc(t.tier)}</b> \u00b7 ${esc(t.name)}</span><b>${t.count}</b></div>`).join('')}</div>`
      : `<div class="box"><div class="box-h">Trader Tiers</div><p style="font-style:italic;color:#5b5142">Builds from trade history.</p></div>`;
    s.tradeDesk = { tag: 'Front Office · Values via FantasyCalc',
      tradesHtml: `<div class="box"><div class="box-h">This Week's Trades</div><p style="font-style:italic;color:#5b5142">${facts.weeklyTrades?.length ? esc(facts.weeklyTrades.length + ' trade(s) logged.') : 'No trades logged this week.'}</p></div>`,
      stalenessHtml: staleHtml, tiersHtml,
      footnote: 'Live values via FantasyCalc (dynasty / 1QB / half-PPR).' };

    // REVISIONIST HISTORY — "How That Trade Aged". Modular: only appears when there's an old
    // trade with a banked "value then" snapshot AND a real divergence since. Structure matches
    // the demo exactly: lede line, then-vs-now verdict, and one aging card per side.
    const rv = facts.revisionist;
    if (rv && rv.sides?.length === 2) {
      const [A_, B_] = rv.sides;
      const nameA = ctx.name(A_.roster_id), nameB = ctx.name(B_.roster_id);
      const thenWinner = rv.thenLeader === 0 ? nameA : nameB;
      const nowWinner  = rv.nowLeader  === 0 ? nameA : nameB;

      const df = {
        weeksAgo: rv.weeksAgo, tradeWeek: rv.week,
        teamA: nameA, teamAGot: A_.received, teamAValueThen: A_.valueThen, teamAValueNow: A_.valueNow, teamADelta: A_.delta,
        teamB: nameB, teamBGot: B_.received, teamBValueThen: B_.valueThen, teamBValueNow: B_.valueNow, teamBDelta: B_.delta,
        lookedLike: thenWinner, looksLike: nowWinner, verdictFlipped: rv.flipped,
        note: `Write the LEDE for a "how that trade aged" column — 2-3 sentences, Malloy's voice. ${rv.weeksAgo} weeks ago (week ${rv.week}), ${nameA} received ${A_.received.join(', ')} (worth ~${A_.valueThen} then, ~${A_.valueNow} now) and ${nameB} received ${B_.received.join(', ')} (worth ~${B_.valueThen} then, ~${B_.valueNow} now). ${rv.flipped ? `The verdict FLIPPED: it looked like ${thenWinner}'s win at the time, but now it looks like ${nowWinner}'s.` : `${nowWinner} still looks ahead, but the numbers have moved a lot.`} IMPORTANT — this is a DYNASTY league: a value gap is NOT automatically a blunder. A contender fairly pays a premium for win-now help; a rebuilder fairly sells a veteran for youth. And trades simply don't pan out sometimes (injury, a breakout) with nobody at fault. Judge the PROCESS, not just the value swing — only call it a fleecing if it truly was one. Use ONLY the players/values given.`,
      };
      let lede = '';
      try { lede = cleanProse(await callLLM(buildSectionPrompt('agingTrade', df, { name: facts.leagueName, week: wk }).replace(/\{WEEK\}/g, wk), { provider: provider() }), { dropCap: false, week: wk }); c.ok++; console.log('      \u2713 revisionist'); }
      catch (e) { c.failed++; }

      if (lede) {
        const card = (side, teamName) => {
          const down = side.delta < 0;
          const up = side.delta > 0;
          const cls = down ? ' down' : (up ? ' up' : '');
          const arrowSym = down ? '\u25BC' : (up ? '\u25B2' : '\u2014');
          const mag = Math.abs(side.delta).toLocaleString();
          return `<div class="aging-card">
          <div class="team-name">${esc(teamName)}</div>
          <div class="got">received: ${esc(side.received.join(', '))}</div>
          <div class="val-row"><span>Value then</span><span>Value now</span></div>
          <div class="val-nums"><span class="v-then">${side.valueThen.toLocaleString()}</span><span class="v-arrow">\u2192</span><span class="v-now${cls}">${side.valueNow.toLocaleString()}</span></div>
          <div class="delta${cls}">${arrowSym} ${mag} (${esc(deltaReason(side))})</div>
        </div>`;
        };
        s.tradeDesk.agingHtml = `<p class="lede-line">${lede.replace(/<\/?p[^>]*>/g, '')}</p>
      <div class="aging-verdict">Looked like <b>${esc(thenWinner)}</b> then \u00b7 Looks like <b>${esc(nowWinner)}</b> now</div>
      <div class="aging-cards">
        ${card(A_, nameA)}
        ${card(B_, nameB)}
      </div>`;
        // GRADED ONCE, EVER — record it so this trade never resurfaces in a future issue.
        try { markGraded(rv.transaction_id, { week: wk, season: facts.season }); } catch {}
      }
    }

    // GRADE THE TRADE — modular: only appears if there's a recent trade to grade. Grades
    // against CURRENT values with dynasty context. No points (that's Revisionist's job).
    // Layout shows WHAT each side got first, then a brief verdict + letter grades.
    const gt = facts.gradeThisTrade;
    if (gt && gt.sides?.length === 2) {
      const [win, lose] = gt.sides; // sorted: win got more raw value
      // ask the LLM ONLY for a short verdict + a letter grade per side, returned labeled so
      // we can place the grades next to each team. Keep the prose tight (a few sentences).
      const df = {
        teamA: win.name, teamAGot: win.received.join(', '), teamAValue: win.value,
        teamB: lose.name, teamBGot: lose.received.join(', '), teamBValue: lose.value,
        rawGap: gt.delta, fairness: gt.fairnessRaw,
        note: `Grade this week's trade. Return EXACTLY this labeled format and nothing else: "GRADE_A: <letter grade for ${win.name}, e.g. B+> | GRADE_B: <letter grade for ${lose.name}> | VERDICT: <2 short sentences max, witty, explaining the grades>". ${win.name} received ${win.received.join(', ')} (~${win.value}); ${lose.name} received ${lose.received.join(', ')} (~${lose.value}); raw value gap ${gt.delta}. DYNASTY: raw value isn't everything — a contender fairly pays a premium for win-now, a rebuilder fairly sells for youth/picks. Weigh intent; don't auto-crown the bigger-value side. Do NOT invent players or values.`,
      };
      let gradeA = '', gradeB = '', verdict = '';
      try {
        const raw = await callLLM(buildSectionPrompt('gradeTrade', df, { name: facts.leagueName, week: wk }).replace(/\{WEEK\}/g, wk), { provider: provider() });
        const f = parseLabeledFields(raw, ['GRADE_A', 'GRADE_B', 'VERDICT']);
        gradeA = (f.grade_a || '').replace(/[^A-Fa-f0-9+\-]/g, '').slice(0, 3);
        gradeB = (f.grade_b || '').replace(/[^A-Fa-f0-9+\-]/g, '').slice(0, 3);
        verdict = cleanProse(f.verdict || raw, { week: wk, dropCap: false });
        c.ok++; console.log('      \u2713 gradeTrade');
      } catch (e) { c.failed++; }
      if (verdict) {
        s.gradeTrade = {
          hed: 'Grade the Trade',
          sides: [
            { name: win.name, received: win.received, value: win.value, grade: gradeA },
            { name: lose.name, received: lose.received, value: lose.value, grade: gradeB },
          ],
          verdictHtml: verdict,
        };
        // Remember it — GRADED ONCE, EVER. Marked only now that it has actually rendered, so a
        // failed LLM call doesn't silently burn the trade and skip it forever. This is what
        // stops next week's paper re-grading a trade this week already covered, and it's what
        // lets a week with several trades drain one per issue.
        try { markSnapGraded(gt.txnId, { week: wk, season: facts.season }); } catch {}
      }
    }
  }

  // PLAYOFF SECTION — phase-aware:
  //  (1) playoffs underway (bracket exists) -> render the official bracket
  //  (2) reg season, race determined -> tiers collapse to Clinched+Eliminated, no scenarios
  //  (3) reg season, race live -> full tiers + "What Needs to Happen" scenarios
  if (facts.bracket && facts.bracket.length) {
    // PLAYOFFS: render the official Sleeper winners bracket.
    // Seed numbers are LOCKED to the final regular-season standings (through regWeeks) so
    // they don't shift as the playoffs progress (the #1 seed stays #1 all postseason).
    let lockedSeeds = {};
    try {
      const regWeeks = facts.regWeeks || 14;
      const finalWeeks = facts.leagueId ? weeksThrough(facts.leagueId, regWeeks) : [];
      if (finalWeeks.length) {
        const finalStandings = buildStandings(facts.rosterIds || [], finalWeeks);
        finalStandings.forEach(s => { lockedSeeds[s.roster_id] = s.rank; });
      }
    } catch {}
    // fallback: if we couldn't compute, use current standings (better than nothing)
    if (!Object.keys(lockedSeeds).length) (ctx.standings || []).forEach(s => { lockedSeeds[s.roster_id] = s.rank; });
    s.playoffBracket = { tag: 'The Bracket · Postseason', html: bracketHtml(facts.bracket, ctx, facts, lockedSeeds) };

    // OBITUARY (postseason) — eulogize teams knocked OUT of the winners bracket THIS week.
    // Only winners-bracket losers (ignore consolation). A loss here ends their season.
    {
      const playoffStart = facts.playoffStart || ((facts.regWeeks || 14) + 1);
      const roundThisWeek = facts.week - playoffStart + 1;
      const isWin = (g) => !(g.t1_from && g.t1_from.l != null) && !(g.t2_from && g.t2_from.l != null) && (g.p == null || g.p === 1);
      const knockedOut = facts.bracket
        .filter(g => g.r === roundThisWeek && isWin(g) && g.l != null)
        .map(g => g.l);
      if (knockedOut.length) {
        const eulogies = [];
        for (const rid of knockedOut) {
          const st = ctx.standings.find(x => x.roster_id === rid) || { wins: 0, losses: 0 };
          const of = obituaryFacts({ roster_id: rid, ...st }, ctx.standings, wk, facts.identity);
          let text = `${of.name} (${of.record}) saw their season end in the playoffs.`;
          try {
            const raw = await callLLM(obituaryPrompt({ ...of, playoff: true }, PERSONA), { provider: provider() });
            const cleaned = cleanProse(raw, { dropCap: false, week: wk }).replace(/<\/?p[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            if (cleaned) text = cleaned;
            c.ok++;
          } catch (e) { c.failed++; }
          eulogies.push({ name: of.name, text });
        }
        console.log(`      \u2713 obituary (${eulogies.length} eliminated in the playoffs)`);
        s.obituary = eulogies.length === 1
          ? { hed: `In Memoriam: ${eulogies[0].name}`, text: eulogies[0].text }
          : { hed: `In Memoriam`, paragraphs: eulogies.map(e => e.text) };
      }
    }
  } else if (playoffRaceActive(wk) && ctx.standings.length) {
    const race = playoffRace(ctx.standings, { playoffSpots: 7, regSeasonWeeks: facts.regWeeks || 14, currentWeek: wk });
    const determined = (race.tiers.contending.length === 0 && race.tiers.bubble.length === 0);
    // Pick the 6 MOST INTERESTING teams (bubble, contenders in danger, live longshots).
    const spots = race.playoffSpots || 7;
    const scoredContenders = (race.scenarios || []).map(sc => {
      const st = ctx.standings.find(x => x.roster_id === sc.roster_id) || {};
      const distToCut = Math.abs((st.rank ?? 99) - spots);
      const bubble = 1 / (1 + distToCut);
      const inDanger = (st.rank <= spots && distToCut <= 2) ? 0.4 : 0;
      const longshot = (st.rank > spots && distToCut <= 2) ? 0.4 : 0;
      return { sc, interest: bubble + inDanger + longshot };
    }).sort((a, b) => b.interest - a.interest);
    const contenders = determined ? [] : scoredContenders.slice(0, 6).map(x => x.sc);
    let scenarioTexts = contenders.map(sc => sc.text);
    // Only write scenarios if the race is still live (skip entirely when determined).
    if (contenders.length) {
      const df = { weeksLeft: race.weeksLeft, playoffSpots: race.playoffSpots,
        teams: contenders.map(sc => ({ team: ctx.name(sc.roster_id), record: `${sc.wins}-${sc.losses}`,
          rank: sc.rank, magicNote: sc.text })),
        note: 'For EACH team, rewrite its magicNote into ONE lean, precise sentence in Malloy\'s voice about what it needs to make the playoffs. Keep every FACT from the magicNote exact — the teams named to catch/hold-off, the number of wins, the tiebreaker. Do NOT invent teams or change the math. Keep it SHORT (one sentence, ~15-20 words). VARY the phrasing between teams. Return one numbered line per team, in order.' };
      try {
        const raw = await callLLM(buildSectionPrompt('playoffRace', df, { name: facts.leagueName, week: wk }).replace(/\{WEEK\}/g, wk), { provider: provider() });
        const lines = raw.replace(/<[^>]+>/g, '').split('\n').map(x => x.trim()).filter(Boolean);
        scenarioTexts = contenders.map((sc, i) => {
          const found = lines.find(l => l.startsWith(`${i + 1}.`) || l.startsWith(`${i + 1} `));
          let t = found ? found.replace(/^\d+[\.\)]\s*/, '') : sc.text;
          return t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(?<!\*)\*(?!\*)([^*]+?)\*(?!\*)/g, '$1').replace(EMOJI, '').trim();
        });
        c.ok++; console.log('      \u2713 playoffRace');
      } catch (e) { c.failed++; console.log(`      \u2717 playoffRace: ${e.message}`); }
    }
    s.playoffRace = {
      tag: determined ? `The Field Is Set · Wk ${wk}` : `Clinch & Elimination · Wk ${wk}`,
      determined,
      tiersHtml: playoffTiersHtml(race, ctx),
      scenariosHtml: contenders.map((sc, i) =>
        `<div class="scenario"><span class="team">${esc(ctx.name(sc.roster_id))}</span><span>${esc(scenarioTexts[i])}</span></div>`).join('') };

    // OBITUARY / IN MEMORIAM — eulogize teams eliminated THIS WEEK only. Compare the
    // eliminated set as of last week vs this week; the difference is who just died.
    let elimBefore = new Set();
    if (ctx.prevStandings && ctx.prevStandings.length) {
      try {
        const prevRace = playoffRace(ctx.prevStandings, { playoffSpots: 7, regSeasonWeeks: facts.regWeeks || 14, currentWeek: wk - 1 });
        elimBefore = new Set(prevRace.tiers.eliminated.map(t => t.roster_id));
      } catch {}
    }
    const justEliminated = race.tiers.eliminated.filter(t => !elimBefore.has(t.roster_id));
    if (justEliminated.length) {
      const eulogies = [];
      for (const victim of justEliminated) {
        const of = obituaryFacts(victim, ctx.standings, wk, facts.identity);
        let text = `${of.name} (${of.record}) has been mathematically eliminated, survived by its unrealized draft ambitions.`;
        try {
          const raw = await callLLM(obituaryPrompt(of, PERSONA), { provider: provider() });
          const cleaned = cleanProse(raw, { dropCap: false, week: wk }).replace(/<\/?p[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          if (cleaned) text = cleaned;
          c.ok++;
        } catch (e) { c.failed++; }
      eulogies.push({ name: of.name, text });
      }
      console.log(`      \u2713 obituary (${eulogies.length} eliminated this week)`);
      s.obituary = eulogies.length === 1
        ? { hed: `In Memoriam: ${eulogies[0].name}`, text: eulogies[0].text }
        : { hed: `In Memoriam`, paragraphs: eulogies.map(e => e.text) };
    }
  }

  // SCOREBOARD — every game, one full-width line. Winner score bold, loser greyed,
  // the week's single highest team score gets a flame, alternating row shading.
  {
    const games = ctx.thisWeek.slice().sort((a, b) => (b.winnerPts + b.loserPts) - (a.winnerPts + a.loserPts));
    const topScore = Math.max(...games.flatMap(g => [g.winnerPts, g.loserPts]));
    const rows = games.map((g, i) => {
      const wFlame = g.winnerPts === topScore ? ' <span class="hi" title="High score of the week">\u25B2</span>' : '';
      const lFlame = g.loserPts === topScore ? ' <span class="hi" title="High score of the week">\u25B2</span>' : '';
      return `<div class="score-row${i % 2 ? ' alt' : ''}"><span class="score-teams"><b>${esc(g.winnerName)}</b> <span class="def">def.</span> ${esc(g.loserName)}</span>` +
        `<span class="score-nums"><b class="win">${num(g.winnerPts)}${wFlame}</b><span class="sep">\u2013</span><span class="lose">${num(g.loserPts)}${lFlame}</span></span></div>`;
    }).join('');
    s.scoreboard = { hed: `Week ${wk} Scoreboard`, tag: 'Every Result', rowsHtml: rows };
  }

  console.log(`      Sections: ${c.ok} ok, ${c.failed} failed.`);
  if (c.ok === 0 && !isReview) throw new Error('ALL LLM sections failed — check LLM_PROVIDER and API key in .env.');

  return broadsheetTemplate({
    leagueName: facts.leagueName, season: facts.season, week: wk, isReview,
    s, identity: facts.identity, images: facts.images ?? [], tagline: PERSONA.tagline,
    formLink: process.env.FORM_LINK || '' });
}
