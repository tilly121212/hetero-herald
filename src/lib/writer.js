// The writer layer. Turns structured engine "facts" into newspaper articles.
// LLM-swappable: implement callLLM() for whichever provider at deploy.
// The persona is a config block so "Malloy" can be renamed/rebuilt without touching logic.

export const PERSONA = {
  name: 'Vince Malloy',
  tagline: 'Malloy',
  bio: `The league's beat writer. Has covered every season, remembers every score, every
collapse, every trade, and is not shy about any of it. No favorites, no mercy, no personal
mythology — just a sharp eye for a bad lineup decision and a long memory for who choked.`,
  voice: `Openly comedic, roast-heavy, ruthless. Dry wit over goofiness. Confident, authoritative,
a little world-weary from watching this league make the same mistakes for years. Short punchy
sentences mixed with one long grandiose one. Never mean about real-world personal traits — the
cruelty is aimed squarely at football decisions, lineup malpractice, draft busts, losing streaks,
and choke jobs.`,
};

// Hard content rules baked into every prompt, regardless of persona.
export const GUARDRAILS = `
CONTENT RULES (never violate):
- TEMPORAL RULE (critical): This issue is written the day after Week {WEEK}. You know
  ONLY what has happened through Week {WEEK}. You do NOT know any future result. Never
  reference final records, playoff berths, championships, season-long streaks, or how
  anything "turned out" — those haven't happened yet. No "eventual champion", no "future
  11-win team", no "as it turned out". Speak only from games played so far. Speculation
  about the future is fine ONLY if clearly framed as speculation ("we'll see", "too early
  to say", "if this holds").
- Use team names EXACTLY as given, verbatim. Do not comment on, mock, editorialize about,
  or riff on the meaning of any team name. Treat every team name as a neutral proper noun.
- Roast ONLY football: lineup choices, bench points, draft/keeper decisions, losing streaks,
  bad trades, chokes, luck. Never generate slurs, sexual content, or personal insults about
  managers as people.
- Every burn must be earned by a real number from the DATA. No invented stats. If you didn't
  get a fact in the DATA block, don't assert it.
- STYLE: Do NOT use ALL-CAPS words for emphasis (no "BALONEY!", "OPTIMALLY?", "JUSTICE!"). It
  reads as shouty and amateurish. Make your point through sharp wording and wit, not screaming.
  Proper nouns and normal capitalization only. Also do NOT use emoji in your prose.
- DYNASTY TRADE CONTEXT: this is a keeper/dynasty league. Contenders and rebuilders trade for
  opposite reasons — a contender giving up future value for win-now help, or a rebuilder selling
  a productive veteran for youth/picks, is playing the game correctly even when the raw value
  "delta" looks lopsided. Never treat a value gap alone as proof of a fleecing or a blunder, and
  never call a trade bad just because a player later got hurt or busted (nobody controls that).
  Roast genuinely bad process; respect sound moves that aged poorly.
`;

// Section-specific voice guidance (tone shifts by section, newspaper-style).
export const SECTION_VOICE = {
  lead:        'Malloy in full voice. The single biggest story of the week. Grandiose, cutting.',
  gameOfWeek:  'Straight-faced AP-wire sportswriting. Play it painfully straight for contrast. Seed the historical head-to-head callback.',
  upset:       '"For the ages" drama. Heighten the improbability. Almost mock-epic.',
  powerRankings:'Snarky columnist with grudges. One cutting line per team. Include movement arrows.',
  benchReport: 'Deadpan police-blotter voice. Report the bench crimes like a crime log.',
  luck:        'Wry. The lucky should feel undeserving; the unlucky, cosmically wronged.',
  tradeWinds:  'Tabloid whisper. Unnamed sources, "reportedly", "eyebrows raised". Gossip.',
  agingTrade:  'Gleeful revisionist history — but FAIR. A trade that looked one way and aged another. Cite the then-vs-now values. IMPORTANT: dynasty league, so judge intent, not just the value delta. A contender trading picks for win-now, or a rebuilder trading a vet for youth/picks, is executing a STRATEGY, not blundering. Trades also just do not pan out sometimes (injuries, breakouts) with nobody at fault. Only call something a fleecing/blunder when the process was genuinely bad, not merely when value shifted.',
  gradeTrade:  'A snap trade report card in Malloy\'s voice — witty, opinionated, quick. Assign each side a letter grade (A-F). DYNASTY-aware: raw value gaps can be a fair win-now/rebuild swap, so weigh intent before crowning a winner. A verdict on a FRESH trade, not a historical one.',
  obituary:    'Mock-solemn funeral eulogy. Only when a team is mathematically eliminated.',
};

// Build the prompt for a single section from engine facts.
// Hard length caps per section (words). Newspaper columns are punchy, not essays.
const SECTION_WORDS = {
  lead: 220, gameOfWeek: 110, upset: 85, benchReport: 50, luck: 50,
  rivalry: 100, powerRankings: 90, tradeWinds: 95, tradeDesk: 60,
  playoffRace: 80, controversy: 160, obituary: 70, gradeTrade: 70,
};

export function buildSectionPrompt(section, facts, leagueMeta) {
  const cap = SECTION_WORDS[section] ?? 80;
  const wk = leagueMeta.week ?? '';
  const prompt = `You are ${PERSONA.name}, columnist for the ${leagueMeta.name} Gazette.
PERSONA: ${PERSONA.bio}
VOICE: ${PERSONA.voice}
THIS SECTION: ${SECTION_VOICE[section] ?? 'Malloy in his standard voice.'}
${GUARDRAILS}

DATA (the only facts you may use):
${JSON.stringify(facts, null, 2)}

Write the "${section}" section. Return prose only — no headline, no markdown, no sign-off.
STRICT LENGTH LIMIT: ${cap} words MAXIMUM. Be punchy and tight — a newspaper column, not an essay. Going over the limit is a failure. Short, sharp sentences.`;
  return prompt.replace(/\{WEEK\}/g, wk);   // resolve placeholder before the model ever sees it
}

// Generate a short pull-quote (<= 18 words) attributed to a team, for the demos'
// quote blocks. Returns { quote, attribution } or null on failure.
export async function writeQuote(subject, contextFacts, provider) {
  // rotate a tone so quotes don't converge on the same voice/vocabulary every week
  const TONES = [
    'cocky and boastful', 'bitter and defensive', 'deadpan and unbothered',
    'wildly over-confident', 'making excuses', 'throwing a rival under the bus',
    'falsely humble', 'menacing and ominous', 'delusional optimism', 'exhausted and fed up',
  ];
  const tone = TONES[Math.floor(Math.random() * TONES.length)];
  const prompt = `You are writing a single short trash-talk or reaction QUOTE for a fantasy
football newspaper, attributed to the team "${subject}". Context: ${JSON.stringify(contextFacts)}.
TONE for this quote: ${tone}. Make it sound like a real, specific person — fresh and varied.
AVOID overused sportswriter clichés and pet words — especially "dazzle", "dazzling", "outdueled",
"statement", "on notice", "for the ages". Use plain, punchy, original phrasing instead.
Return ONLY the quote text, first-person, 18 words or fewer, no attribution, no quotation marks, no markdown.`;
  try {
    const EMOJI_Q = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\uFE0F\u{1F1E6}-\u{1F1FF}]/gu;
    const t = (await callLLM(prompt, { provider })).trim()
      .replace(/^["'\u201c]|["'\u201d]$/g, '')
      .replace(/\{WEEK\}/g, '')
      .replace(/\*\*(.+?)\*\*/g, '$1').replace(/(?<!\*)\*(?!\*)([^*]+?)\*(?!\*)/g, '$1')
      .replace(EMOJI_Q, '').trim();
    if (!t || t.length > 160) return null;
    return { quote: t, attribution: subject };
  } catch { return null; }
}

// Swappable LLM call, with automatic retry on transient failures (503 "busy",
// network blips, rate limits). Retries up to 4 times with growing backoff so a
// momentary Google/OpenAI hiccup never silently blanks the paper.
export async function callLLM(prompt, { provider = 'anthropic' } = {}) {
  const maxAttempts = 6;
  const backoff = [2000, 5000, 15000, 30000, 60000]; // climbs to a full minute for per-min limits
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const text = await callOnce(prompt, provider);
      if (!text || !text.trim()) throw new Error('empty response from model');
      return text;
    } catch (e) {
      lastErr = e;
      const msg = String(e.message || e);
      const transient = /503|overloaded|high demand|UNAVAILABLE|429|rate|timeout|ECONNRESET|fetch failed|empty response/i.test(msg);
      if (attempt < maxAttempts && transient) {
        const waitMs = backoff[attempt - 1] ?? 60000;
        console.log(`      (attempt ${attempt} failed: ${msg} — retrying in ${waitMs/1000}s)`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      break;
    }
  }
  // Loud failure — do NOT return blank. Caller decides, but the error is explicit.
  throw new Error(`LLM call failed after ${maxAttempts} attempts (${provider}): ${lastErr?.message || lastErr}`);
}

// One raw attempt at the configured provider.
async function callOnce(prompt, provider) {
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(`Anthropic: ${data.error.message}`);
    return (data.content || []).map(b => b.text ?? '').join('\n');
  }
  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(`OpenAI: ${data.error.message}`);
    return data.choices?.[0]?.message?.content || '';
  }
  if (provider === 'gemini') {
    // Google Gemini (free tier). Flash is a "thinking" model — it spends tokens
    // reasoning before answering, so the budget must be generous or the article
    // gets starved. 4096 leaves ample room for both thinking and the output.
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 4096, temperature: 1.0 },
        }),
      }
    );
    const data = await res.json();
    if (data.error) throw new Error(`Gemini: ${data.error.message}`);
    const cand = data.candidates?.[0];
    // If Gemini hit the token cap mid-think with no text, treat as transient.
    if (!cand || cand.finishReason === 'MAX_TOKENS' && !cand.content?.parts?.length) {
      throw new Error('Gemini returned no text (thinking used the budget) — retrying may help');
    }
    return (cand.content?.parts || []).map(p => p.text ?? '').join('\n');
  }
  throw new Error(`Unknown provider: ${provider}`);
}
