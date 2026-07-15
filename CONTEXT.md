# The Hetero Herald — Project Context

A running brief so anyone (or any fresh chat) can pick this up from the files alone.
Keep this updated each version.

## What it is
An automated weekly fantasy-football newspaper for a 14-team Sleeper **dynasty**
league. Every Tuesday it pulls the just-completed week from Sleeper, an LLM writes
the articles in the voice of columnist **"Vince Malloy,"** and it publishes a
broadsheet-style HTML paper to GitHub Pages. The commissioner shares the link in the
league chat. Season-aware: weekly issues in-season, an auto year-end review after the
championship, dormant in the offseason.

Tone: sharp, funny, roasts football decisions. The team names are crude/gay-themed
(the league members are in on it) and are used verbatim as neutral proper nouns —
the humor targets football, not the names.

## Tech
- Node.js (v20.6+ for built-in `--env-file`; dev machine runs v24). No build step.
- LLM provider is swappable via `LLM_PROVIDER` env: `gemini` (default, free tier,
  model gemini-2.5-flash), `openai`, or `anthropic`. Key in `.env`.
- Data source: Sleeper public API (no auth). Trade values (later): FantasyCalc.
- Output: static HTML in `docs/` → GitHub Pages. Automation via GitHub Actions.

## Command model
- **generate** — the Tuesday auto-run (GitHub Actions). Detects the just-completed
  week, APPENDS it to the season database, writes + publishes that issue. This is the
  only command in normal operation; the DB builds itself one week at a time.
- **regenerate --week N** — manually recompile ONE week (bug fix / re-roll / provider
  swap). UPSERTS that week (no duplicates). Also `--review` for the year-end issue.
- **sync-season** — one-time backfill of the current season's played weeks into the
  DB (mid-season start or rebuild-after-bug). Not needed in steady state.
- **build-history** — pulls COMPLETED past seasons (rivalries all-time, champions,
  multi-year trade dates). Run occasionally.
- **test-form** — checks the Google Form (Controversy Corner submissions) works.

Env for a run points at a league via `LEAGUE_ID`. 2026 is the live league (pre-draft
right now). Testing uses the completed **2025** league id `1188998801032708096`.

## Data architecture
- `src/lib/season-db.js` — the current season's accumulating game log, at
  `data-cache/season-<leagueId>.json`. Shape: `{leagueId, season, weeks:{"8":[games]},
  rankings:{"8":[rosterIds]}}`. `generate`/`regenerate` upsert into it; standings,
  playoff race, and power-ranking movement all READ from it (weeks ≤ current).
- Real W-L standings come from `analyze.buildStandings` (sorted by wins, then
  points-for tiebreaker — matches league rules).
- Sleeper is always the source of truth; past weeks are immutable, so re-fetching is
  always safe.

## Rendering
- `src/render/render.js` builds structured section objects and hands them to
  `src/render/template.js` (the broadsheet). The ENGINE builds the data (scores,
  boxes, tables, tiers); the LLM writes only the prose (bodyHtml) + short quotes.
- `cleanProse()` in render.js normalizes all LLM text: strips markdown/emoji,
  removes self-written headlines, resolves {WEEK}, applies the drop-cap to the first
  paragraph.
- Design: newsprint broadsheet — Playfair Display heads, Old Standard TT body,
  Special Elite labels; oxblood red accents; red drop caps. **The demo (src/commands/
  demo.js output) is the visual target — "the demo is fire," match it exactly.**

## Status (as of v1.4.2)
Live and deployed. Trade infrastructure (tiers, value retention, Trade Winds, Grade the Trade,
Revisionist History), the publishing/self-seeding pipeline, GitHub Actions + Pages, and the
Week-17 SEASON FINALE (championship lead, Game of the Year, Shittiest Manager, Season in
Numbers, and THE PAYOUTS) are all built and shipped. The roadmap/open-work sections lower down
predate v1.2.0 and are DONE — treat them as history, not a to-do list. Recent finale work:
v1.4.1 made Game of the Year exclude stakes-free losers/consolation playoff games and enriched
the Season-in-Numbers rows; v1.4.2 replaced Final Standings with a Payouts section (who won each
cash prize — places from the bracket, stat prizes from the regular season only). Deferred: image
rotation (deck-shuffle) and the browser maintenance console.

## Status (as of v1.1.9)
Playoffs handled properly now: bracket shows winners-only with the #1 bye, seeds LOCKED to
final regular-season standings, PROGRESSIVE reveal (Week-15 paper shows only Round 1, "Winner
of QF1" for future slots, no champion until Championship week). Playoff-week LEAD covers the
biggest actually-played winners-bracket game (never the bye team / consolation) and the writer
gets a playoff-format briefing so it drops regular-season language. Playoff games (wks 15-17)
now pulled into history so they count toward rivalries. Rivalry article + box share one exact
record (can't disagree). Everything below still current from v1.1.8:

## (prior) Status (as of v1.1.8)
Bracket rebuilt: real tree with connector lines, left-to-right (Championship rightmost),
readable contrast, and PROGRESSIVE REVEAL — a Week-15 paper shows only Round 1, no champion
until the championship week (rounds mapped to weeks: R1=15, R2=16, R3=17; Sleeper's
playoff_week_start overrides). Rivalry double-count fixed (history = prior seasons only, so
current-season games aren't counted twice); `npm run debug-rivalry -- "A" "B"` traces counts
by source. Everything below still current from v1.1.7:
All content/logic/display polish done through three patches. WORKING: stakes-first
coherent lead cluster (with Weather box + temporal standings), playoff race with the 6
most interesting teams and LEAN-but-PRECISE scenarios (correct cutoff teams, magic
numbers, tiebreaker), Controversy (8 rotating angles + distinct boxed pull-quote),
3 mapped images, upset cascade, scoreboard (winner/loser styling, high-score marker,
row shading), rivalry (spiciest pick, correct all-time wording), obituary (newly-
eliminated-this-week only, all of them), bench crime report (real start/sit blunders),
power rankings 70/30 with 7/7 split and movement arrows, fresh weekly Last Word.

## Roadmap
- v1.1.4 / v1.1.5 / v1.1.6 (DONE) — all content, voice, logic & display polish.
- v1.2.0 (NEXT) — the "bigger stuff": TRADE INFRASTRUCTURE.

## Open work — v1.2.0 (trade infrastructure — the big one)
1. TRADER TIERS: everyone shows F·0 — roster->owner attribution is broken (trades use
   roster_ids like [6,10]; engine counts by owner_ids; conversion missing). Fix it, build
   a POINT SYSTEM (Option B): points per trade for volume now, quality points ready. 50%
   volume / 50% quality once values exist; volume-only must work now. Walk
   previous_league_id chain for all-time.
2. RETAIN TRADE VALUE DATA: save a weekly FantasyCalc snapshot, WRITE-ONCE per week
   (regenerate must NOT overwrite). Enables grading/revisionist/quality-tiers/resilience.
3. TRADE WINDS full rebuild: roster-by-position depth analysis (stacked/thin), rumors
   grounded in real needs, MEMORY of prior weeks' rumors, escalation when a hole persists.
4. REVISIONIST HISTORY: past trades whose value diverged dramatically (presume fair-when-
   made baseline), highlight best story, MEMORY so no repeats unless different teams,
   DYNASTY-AWARE framing (value gap != loss). Activates as data accumulates.
5. CURRENT-WEEK TRADE GRADING: wire gradeWeeklyTrades (works now with current values).

## Then — cleanup (v1.2.x)
- RIVALRY DESK: track/database many more stats (all-time PF/PA, avg margin, closest/
  biggest games, streaks, playoff meetings, last-5) for richer articles.
- RESET command: npm run reset clears current-season DB; -- --all full wipe.
- Full demo audit — line-by-line vs the demo screenshots.

## After that's stable
- Push to GitHub (SETUP.md); Google Form (FORM-SETUP.md); ready for 2026 live.

## Known-inert (fills in over the season, NOT bugs)
- Revisionist History and quality-weighted tiers get richer as trade data accumulates.
- Rivalry all-time record needs build-history to have run.

## Conventions
- Every change ships as a COMPLETE ZIP (no per-file patches), with the version in the
  filename, a CHANGELOG.md entry, and this CONTEXT.md kept current.
- Versioning: patch = fixes (1.1.x), minor = features (1.x.0), major = big rewrites.
- Surgical edits over rewrites; don't change things that aren't on the list.
