// Controversy section. League mates submit "hot takes" / drama via a Google Form,
// which writes to a Google Sheet published as CSV (no API key, no auth — the sheet
// owner just does File > Share > Publish to web > CSV). The generator fetches that
// CSV each run, filters to submissions for the current week, and picks ONE at random.
// If none exist, the LLM manufactures a controversy from the week's actual events.

// Parse the published-sheet CSV. Expected columns (Form defaults):
//   Timestamp, Your Name (optional), Your Take
// We keep it forgiving: last non-empty column is treated as the take.
function parseCSV(text) {
  const rows = [];
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return rows;
  // simple CSV split that respects quoted commas
  const split = (line) => {
    const out = []; let cur = '', q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur); return out.map(s => s.trim().replace(/^"|"$/g, ''));
  };
  const header = split(lines[0]).map(h => h.toLowerCase());
  for (let i = 1; i < lines.length; i++) {
    const cells = split(lines[i]);
    const row = {};
    header.forEach((h, j) => row[h] = cells[j] ?? '');
    rows.push(row);
  }
  return rows;
}

// --- USED-SUBMISSION MEMORY -----------------------------------------------------------
// Takes are SINGLE-USE and PERISHABLE. Without this, the same hot take could headline
// Controversy Corner week after week (which is exactly what happened — one "fuk that guy"
// ran in consecutive issues). Google Forms gives no row id, so we fingerprint the
// submission by its timestamp + text. Preserved by reset.js.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const CACHE = './data-cache';
const USED_FILE = `${CACHE}/controversy-used.json`;

const fingerprint = (s) => {
  const raw = `${s.timestamp || s.tsMs || ''}|${(s.take || '').trim().toLowerCase()}`;
  let h = 2166136261;
  for (const c of raw) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
};

function loadUsed() {
  if (!existsSync(USED_FILE)) return { used: {} };
  try { return JSON.parse(readFileSync(USED_FILE, 'utf8')); } catch { return { used: {} }; }
}
export function alreadyUsedSubmission(sub) {
  return !!loadUsed().used[fingerprint(sub)];
}
export function markSubmissionUsed(sub, meta = {}) {
  const store = loadUsed();
  store.used[fingerprint(sub)] = { at: Date.now(), name: sub.name, ...meta };
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
  writeFileSync(USED_FILE, JSON.stringify(store));
}

// Fetch + normalize submissions. Returns [{ name, take, timestamp }].
// sinceMs: only submissions newer than this are returned — this is how each
// week's paper sees ONLY that week's fresh takes without needing to delete rows.
// The generator passes the timestamp of the previous issue, so anything submitted
// before the last paper naturally falls out of the window.
export async function fetchSubmissions(publishedCsvUrl, { sinceMs = 0, weekTag } = {}) {
  if (!publishedCsvUrl) return [];
  let rows;
  try {
    const res = await fetch(publishedCsvUrl);
    rows = parseCSV(await res.text());
  } catch { return []; }

  const norm = rows.map(r => {
    const keys = Object.keys(r);
    const takeKey = keys.find(k => /take|drama|controversy|chat|submit/.test(k)) || keys[keys.length - 1];
    const nameKey = keys.find(k => /name|team/.test(k));
    const weekKey = keys.find(k => /week/.test(k));
    const tsRaw = r['timestamp'] || r[keys[0]] || '';
    const tsMs = Date.parse(tsRaw) || 0;
    return {
      name: (nameKey && r[nameKey]) || 'Anonymous',
      take: r[takeKey] || '',
      week: weekKey ? r[weekKey] : null,
      timestamp: tsRaw, tsMs,
    };
  }).filter(s => s.take && s.take.length > 3);

  // TIME WINDOW: only submissions since the last issue. This is the auto-clear.
  let scoped = sinceMs ? norm.filter(s => s.tsMs >= sinceMs) : norm;

  // NEVER re-run a take that has already been featured. A submission gets exactly one shot;
  // if it isn't picked while it's fresh, it expires and the sender can simply resubmit.
  scoped = scoped.filter(s => !alreadyUsedSubmission(s));

  // If the form also captures a week, honor that as a stricter filter.
  if (weekTag != null) {
    const byWeek = scoped.filter(s => String(s.week).includes(String(weekTag)));
    if (byWeek.length) return byWeek;
  }
  return scoped;
}

// Pick one submission at random (unbiased).
export function pickSubmission(subs, seedStr = '') {
  if (!subs.length) return null;
  // light seeding so a regenerated issue picks the same one
  let h = 2166136261;
  for (const c of seedStr) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  const idx = Math.abs(h) % subs.length;
  return subs[idx];
}

// Decide what the Controversy section should be this week.
// Returns { mode:'submitted'|'invented', submission?, seedFacts? } — the writer
// turns this into the actual article. Section ALWAYS generates (invents if empty),
// per your spec.
export function planControversy(subs, weekFacts, { season, week } = {}) {
  const chosen = pickSubmission(subs, `${season}-w${week}`);
  if (chosen) {
    return { mode: 'submitted', submission: chosen };
  }
  // No submissions -> invent from the week's most dramatic real event.
  // Prefer: a lopsided trade, a suspicious lineup, a bitter rivalry result, a blowout.
  const seed = weekFacts.controversySeed || weekFacts.biggestBlowout || weekFacts.topBenchCrime || null;
  return { mode: 'invented', seedFacts: seed, week };
}

// Writer prompt for the section.
export function controversyPrompt(plan, persona, identity) {
  // The real cast of the league. The submitted-take branch used to get NOTHING but the take
  // itself, so a vague submission ("fuk that guy") left the model with no real names to reach
  // for — and it duly invented one, then built an entire fake incident around a manager who
  // does not exist. Inventing DRAMA is the whole point of this column; inventing PEOPLE is not.
  const teamList = (() => {
    try {
      // identity exposes rosterToOwner — its keys ARE the roster ids.
      const ids = Object.keys(identity?.rosterToOwner || {});
      const names = ids.map(rid => identity.nameOf(Number(rid))).filter(Boolean);
      return names.length ? names : null;
    } catch { return null; }
  })();
  const castRule = teamList
    ? `\n\nTHE LEAGUE'S ONLY TEAMS (this is the complete cast — every manager you name MUST be one of these, spelled exactly):\n${teamList.map(n => `- ${esc(n)}`).join('\n')}\nHARD RULE: NEVER invent a manager, team, or person. If the take doesn't make clear who it's aimed at, pick one of the real teams above and pin it on them. You may invent the DRAMA freely — the benching, the betrayal, the scandal, the anonymous sources — but every name that appears must come from that list.`
    : `\n\nHARD RULE: NEVER invent a manager, team, or person's name. Only refer to teams that actually appear in the data you've been given.`;

  if (plan.mode === 'submitted') {
    return `Write a MEATY tabloid "Controversy" column (140-200 words) in the voice of
${persona.name}. A league member submitted this hot take — treat it as an explosive
"letter to the editor" that lands on your desk, and go to town. Amplify the drama to
absurd heights, pick a side, name the feud, demand accountability that will never come.
Football-only; never real-world/personal. Fill the space — this is the juiciest column
in the paper. STYLE: no ALL-CAPS words for emphasis (reads shouty), no markdown, no emoji.
SUBMITTED TAKE (from ${esc(plan.submission.name)}): "${esc(plan.submission.take)}"${castRule}`;
  }

  // Rotate the ANGLE each week so it isn't always a conspiracy. Seed by week so a given
  // issue is stable but consecutive weeks differ.
  const ANGLES = [
    { name: 'Feud / Beef', dir: 'Stoke a simmering feud between two managers whose teams keep clashing. Manufacture bad blood, a petty history, dueling quotes. Name the rivalry.' },
    { name: 'The Overreaction Desk', dir: 'Take ONE result and spin a wildly overblown hot take from it — is this team secretly a fraud? A juggernaut? Overreact with total confidence, then undercut yourself.' },
    { name: 'Mock Investigation', dir: 'Open a mock "investigation" into something suspicious — a bizarre lineup call, a "leaked" group-chat screenshot nobody has seen, a curiously timed waiver. Cite anonymous sources and zero evidence.' },
    { name: 'Power Abuse', dir: 'Insinuate the commissioner is "rigging" something — the schedule, waiver priority, a convenient ruling. Mock-serious demands for oversight that will never come.' },
    { name: 'Redemption / Downfall', dir: 'Write an arc: a former champ or top team collapsing, OR a long-suffering doormat suddenly rising. Treat it like a dramatic fall-from-grace or Cinderella story.' },
    { name: 'Trade Outrage', dir: 'Manufacture outrage over a lopsided-looking trade "nobody is talking about." Question motives, insinuate a fleecing — but remember this is dynasty; a value gap is not automatically a robbery.' },
    { name: 'Coaching Malpractice', dir: 'Roast a manager for obvious tactical malpractice — benching a stud, starting a bust, blowing a start/sit that any fool could have called. Treat it like professional negligence.' },
    { name: 'Petty Grievances', dir: 'Air petty grievances: trash-talk callouts, broken promises, draft-day betrayals, unpaid buy-ins, ghosted trade offers. Small, human, hilarious drama.' },
  ];
  const wk = plan.week || 1;
  const angle = ANGLES[(Number(wk) + (plan.angleOffset || 0)) % ANGLES.length];

  return `Write a MEATY tabloid "Controversy" column (150-220 words) in the voice of
${persona.name}. Nobody wrote in, so MANUFACTURE a column from the real event below.

THIS WEEK'S ANGLE — ${angle.name}: ${angle.dir}

HARD RULES:
- It must read as OBVIOUS satire — the Herald is stirring nonsense for laughs. Lean on
  "allegedly," "sources say," "we're just asking questions."
- Football/fantasy conduct ONLY. Never allege a real real-world crime as if true,
  nothing about real-world personal life, no slurs, team names verbatim as neutral nouns.
- Get your facts from the EVENT below — don't invent stats. Be accurate about records
  and standings if you cite them.
- Make it FUNNY and FILL THE SPACE. Multiple paragraphs.
- STYLE: Do NOT use ALL-CAPS words for emphasis. Get intensity from sharp wording, not
  screaming. Normal capitalization only. No markdown, no emoji.

EVENT / CONTEXT TO BUILD FROM: ${JSON.stringify(plan.seedFacts)}`;
}

function esc(s=''){ return String(s).replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }
