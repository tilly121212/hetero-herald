# Changelog

## v1.5.0 — off-season data collection + manager departures
The pipeline now stays useful year-round, and a manager leaving finally gets its due.

OFF-SEASON MAINTENANCE. Previously the Tuesday run did nothing in the off-season (it hit SLEEP
and returned). Now, between the finale and next season's first issue, it keeps the league data
current WITHOUT publishing a paper: it self-heals league history, detects manager changes, and
banks FantasyCalc value snapshots for any week Sleeper is filing trades under. That last part
matters because FantasyCalc has no historical API — a value not banked the week a trade happens
is gone forever, and Revisionist History's "value then vs. value now" depends on it. Trades
themselves live permanently on Sleeper and are always re-fetched; what we preserve is the value
snapshot keyed to each off-season trade week (write-once, so re-runs are safe).

MANAGER DEPARTURES. When a roster changes hands — someone abandons their team and a replacement
takes over — the Herald now notices and makes a story of it. Detection uses a rolling owner
snapshot compared against the live league, so every hand-change is caught precisely, including a
roster that changes twice (off-season, then again mid-season). The very first run seeds its
baseline from history.json's most recent prior season, which is how an off-season swap is caught
even though we never ran during the actual switch. Each distinct change is logged once to a
ledger (data-cache/manager-changes.json).

CONTROVERSY CORNER TAKEOVER. A pending (un-announced) departure OVERRIDES Controversy Corner —
above any reader submission or manufactured drama. It runs on the first issue after the change:
Week 1 if it happened in the off-season, or the current week if a manager bails mid-season.
Multiple departures are covered in one column (mock-eulogy for the departed, a needling welcome
for the new blood). Once it runs, the change is marked announced and never resurfaces — but only
after the column actually renders, so a failed LLM call can't silently swallow the announcement.

ROLLOVER-SAFE. reset.js now preserves the departure ledger and the owner snapshot (like it
already does for trade values and single-use submissions), so wiping the rebuildable cache at
season rollover never loses departure memory or the detection baseline.


## v1.4.2 — finale: Payouts section replaces Final Standings
The Week 17 finale now closes with THE PAYOUTS instead of the full standings table — by the
last issue of the year the standings are old news; who got PAID is the story. It computes each
of the league's cash prizes and names the winner alongside the dollar amount:

  * 1st Place ($700), 2nd ($300), 3rd ($100) — read from the winners bracket (3rd from the
    league's third-place game).
  * Best Record ($60) — regular season, most wins with points-for as the tiebreaker.
  * Most Points ($50) — most regular-season points scored.
  * Highest Week ($50) — the single highest team score of the regular season.

The three stat prizes are REGULAR SEASON ONLY (weeks 1-14): playoff scores never inflate "most
points" or "highest week". Any prize whose winner can't be determined (e.g. no third-place game
in the bracket) simply omits its row rather than showing a blank. The weekly paper's standings
are untouched — this swap is finale-only.


## v1.4.1 — finale fixes: Game of the Year stakes + richer superlatives
Two tightening fixes to the Week 17 season-in-review paper.

1. GAME OF THE YEAR CAN NO LONGER BE A STAKES-FREE GAME. The cascade decided a game was a
   "playoff game" purely by its WEEK number (week >= playoff start), so a nail-biter in the
   LOSERS/consolation bracket — two teams already eliminated from title contention — could be
   crowned Game of the Year. (v1.4.0 did exactly this: it picked a week-16 consolation game.)
   Playoff eligibility now comes from the actual WINNERS bracket: only games still competing
   for the championship qualify. Losers/consolation/placement games are excluded from
   contention entirely, no matter how close. If no winners-bracket game stands out, it falls to
   the best REGULAR-SEASON game (tightness decides — a genuine nail-biter wins), never to a
   stakes-free playoff-week game. The old "late-season stakes" middle tier is gone; a true
   nail-biter is the signal, and the regular-season fallback already covers it.
   (Safe no-bracket behaviour: if the bracket is somehow unavailable, no playoff-week game
   qualifies and the pick comes purely from the regular season — never a stakes-free game.)
2. SEASON-IN-NUMBERS ROWS NOW SHOW WHO, AGAINST WHOM, AND WHEN. The blowout / closest / shootout
   rows named only one team and a lone number ("Biggest blowout — Lil Azz Boyz by 82.34"),
   which didn't say who they beat or when. Each now reads matchup + both scores + week
   ("Biggest blowout — Lil Azz Boyz vs Tuki · 210-109 (Wk 4)"). The "Luckiest" row is dropped
   (it wasn't telling of anything earned). Highest score and Unluckiest are unchanged.


## v1.4.0 — The Finale: championship + season in review
The last feature. Week 17 is now a genuine SEASON FINALE rather than a weekly paper wearing a
review's filename — it publishes the championship AND the year's retrospective as the final
issue of the season, and nothing goes out after it.

It skips the weekly pipeline entirely, because none of it means anything once the season is
over: no trade rumours, no playoff race, no bench-crime blotter, no power rankings, no
scoreboard. (Those sections used to render unconditionally, which would have left a row of
empty headings on the review.) What it runs instead:

  * THE CHAMPIONSHIP — the lead. Who won the title, and the story of the season resolving.
    The champion is read from the winners bracket, with the title game's score in the box.
  * GAME OF THE YEAR — chosen by a cascade, not one metric: a playoff game that was a
    nail-biter or a shootout gets first refusal; failing that, a late regular-season game that
    was close AND actually mattered; failing that, simply the best game there was. Malloy is
    told WHY it was picked so he can argue the case.
  * SHITTIEST MANAGER OF THE YEAR — the engine deliberately picks no winner. It gathers the
    evidence (points left on the bench all year, times blown out by 40+, scoring vs. record,
    who never made a single trade) and Malloy crowns whoever he can build the funniest,
    most damning case against. A formula would just crown the worst record; this way the
    coward who never traded, or the manager who scored a mountain and still lost, can win it.
  * THE SEASON IN NUMBERS — a compact record book: highest score, biggest blowout, closest
    game, biggest shootout, luckiest and unluckiest teams.
  * FINAL STANDINGS.

Masthead, page title and footer are review-aware ("2025 Season in Review", "The Final Issue ·
See You Next Season" instead of "Next Issue: Week 18").

Also fixed while building it: the season DB keys games by week but the game objects carry no
week of their own, so flattening the season lost it and every record cited "Wk undefined".
allSeasonGames() now keeps the week attached.


## v1.3.3 — perishable submissions, power-rankings fit
1. READER SUBMISSIONS ARE NOW SINGLE-USE AND PERISHABLE. The same hot take was headlining
   Controversy Corner week after week. Two causes, both fixed:
     * There was no memory of what had already run, so nothing stopped a take being picked
       again. Every featured submission is now fingerprinted and retired — it can never run
       twice. (Preserved by reset, like the other memories.)
     * The eligibility window was "the last 7 days from right now", not "since the last
       issue" — so a single take stayed in range indefinitely, and back-filling several weeks
       in one sitting showed the same one every time. Only takes that arrived since the
       previous paper are eligible now.
   A beef is perishable: if it isn't used while it's fresh, it expires — resubmit if you still
   care. When nothing eligible remains, the column falls back to manufactured outrage as usual.
2. POWER RANKINGS FIT INSIDE THEIR COLUMN. Rows were still running past the divider and getting
   clipped mid-stat. The real culprit was the grid itself: a `1fr` track has an automatic
   minimum size and refuses to shrink below its content, so the rows had nowhere to go.
   minmax(0,1fr) removes that floor. On top of that the record/average now uses a smaller font
   (it's supporting detail, not the headline) and the TEAM NAME is the part that absorbs the
   squeeze — so the numbers always stay fully readable and a very long name simply ellipses.


## v1.3.2 — early-season framing, controversy cast, grade-the-trade memory
1. NO MORE PLAYOFF TALK IN WEEK 2. The lead was being told, every single week from Week 1, to
   "make it OBVIOUS why this game matters to the playoff picture" and was handed standings
   positions as though they were seeds. The result was exactly what you'd expect: a 1-1 team
   described as staring down "elimination" and "playoff dread" two weeks into a fourteen-week
   season. The framing now scales with the calendar — weeks 1-4 are about the GAME (playoffs,
   seeding, the bubble and elimination are off-limits entirely), the middle weeks may hint at
   where teams are heading, and only the closing stretch gets the full stakes treatment.
2. CONTROVERSY CORNER STOPS INVENTING PEOPLE. A vague submitted take ("fuk that guy") left the
   model with no real name to reach for, so it conjured a manager who does not exist — "Maxwell
   'The Malicious' Miller" — and built an entire fake scandal around him. The submitted-take
   prompt was being handed the take and nothing else; it now gets the league's complete roster
   of real teams and a hard rule: invent the DRAMA freely, never the PEOPLE. If a take doesn't
   say who it's aimed at, pin it on a real team.
3. GRADE THE TRADE NO LONGER RE-GRADES THE SAME TRADE. It had no memory, so a week with no new
   trade would reach back and re-grade the previous week's — which is why weeks 1 and 2 both
   graded the same deal. It now remembers every trade it has covered (a graded-once-ever store,
   preserved by reset) and works through a BACKLOG one per issue: three trades in one week get
   graded across three papers, in order, and none is ever covered twice or left stranded.
4. GRADE THE TRADE now values a deal using the snapshot from THE WEEK IT WAS MADE, not today's
   prices — the honest question for a fresh trade is "was this fair at the time?". Then-vs-now
   remains Revisionist History's job, keeping the two features cleanly separated.
5. POWER RANKINGS OVERFLOW FIXED (a regression from v1.3.1). Forcing rows onto one line made
   long team names punch out of the column and bleed into the standings table beside them. A
   flex child won't shrink below its content without min-width:0 — with that in place the name
   ellipses properly and the row stays inside its column.
6. INDEX — the per-issue thumbnails are gone; they looked worse than the plain list.


## v1.3.1 — snapshot integrity, playoff data, week picker, index polish
1. TRADE-VALUE SNAPSHOTS CAN NO LONGER BE POISONED BY A TEST RUN. FantasyCalc only ever
   returns TODAY'S values. That's correct in live operation (the paper runs the Tuesday right
   after a week ends), but back-filling week 3 months later was stamping today's values onto
   week 3 — inventing fake history that Revisionist History's whole "value then vs value now"
   depends on, and which cannot be repaired afterwards. A snapshot is now only banked when the
   week being published is the LATEST scored week. Back-fills and re-runs of old weeks bank
   nothing (and say so in the log). Verified: a full 17-week back-fill writes ONE snapshot, a
   live season writes one per week with correctly diverging values, and re-generating an old
   week leaves its banked value untouched.
2. PLAYOFF WEEKS NOW REACH THE SEASON DB. sync-season capped its back-fill at the regular
   season (week 14), so weeks 15-17 never landed in the current season's database. Standings,
   locked playoff seeds and — most painfully — this-season rivalry meetings all read from it,
   which meant a playoff meeting between two rivals didn't count as a meeting in the very
   paper covering it. It also made the bootstrap re-run the back-fill forever, since those
   weeks could never appear. It now syncs every scored week.
3. PICK A WEEK FROM THE ACTIONS TAB. "Run workflow" now takes an optional week number: leave
   it blank for normal behaviour (oldest unpublished week), or type a number to publish that
   specific week. No terminal needed. FIRST_PUBLISH is now passed through to the workflow too
   (it was built last version but never wired in).
4. REGENERATE now registers what it writes. It rewrote the HTML without touching the ledger,
   so a week it produced never showed on the index and the scheduler still thought that week
   was unpublished. Re-registering is idempotent, so nothing is ever listed twice. It still
   only ever touches the single week you name.
5. POWER RANKINGS — one line per row, guaranteed. A long team name (or one carrying an emoji)
   wrapped onto a second line, which left one column taller than the other. Rows no longer
   wrap; the name ellipses if it must, so rank, arrow and stats always stay visible.
6. INDEX — links were rendering in default browser blue against the newsprint; colours are now
   set explicitly. Each issue also gets a small grayscale thumbnail (its own lede photo,
   recomputed from the same season+week seed, so nothing extra is stored).


## v1.3.0 — publishing logic, self-seeding, images, index
1. CATCH-UP PUBLISHING (the big one). The scheduler only ever looked at the LATEST week, so a
   missed Tuesday (Actions outage, API blip) meant that week's paper was never published —
   ever. It now publishes the OLDEST completed week that hasn't gone out yet, one per run. A
   gap gets picked up automatically on the next run, and you can re-run the workflow
   repeatedly to walk through a backlog in order. Nothing is ever silently skipped.
2. WEEK 17 IS THE FINALE. The year review is now anchored to the CHAMPIONSHIP week (17) — the
   championship game and the season retrospective in one final issue, and the last publication
   of the season. It used to fall back to regWeeks (14), so the "review" was really a Week 14
   paper that hadn't even seen the playoffs. It also fired BEFORE any unpublished weeks, so a
   finished season would skip every week and jump straight to a bogus review (exactly what the
   first live run did).
3. SEASON START GUARD. A FIRST_PUBLISH variable (e.g. 2026-09-15, the Tuesday after Week 1
   finishes) holds the paper until that date, so nothing goes out during the preseason or
   mid-week-1. Set it once a year alongside LEAGUE_ID.
4. SELF-SEEDING. The scheduled run assumed data-cache was already populated — on a fresh
   checkout, or the first run after LEAGUE_ID points at a new season, there'd be no history and
   no season DB, so rivalry records, movement arrows and standings would be silently empty. It
   now detects that (history.json is stamped with the league it was built for) and rebuilds
   history + backfills the season automatically. At rollover you change LEAGUE_ID and the
   pipeline heals itself — no local commands, no manual uploads.
5. IMAGES FIXED. All three photos were broken on the live site. GitHub Pages serves the site
   root from docs/, so the ../images/ path climbed ABOVE the site root and 404'd. Images are now
   mirrored into docs/images/ and referenced relatively, which works on Pages and locally.
6. POWER RANKINGS — commentary removed. Rank, name, movement arrow, record and average only.
   The per-team one-liners ranged from 4 to 25+ words, so the right column rendered much taller
   than the left no matter how they were clipped. Pure data means every row is one line and the
   columns balance by construction. (Also one fewer LLM call per issue.)
7. INDEX PAGE rebuilt to match the paper: newsprint, Playfair/Old Standard type, double rules.
   Seasons newest-first (2026 above 2025), issues newest-first within each season, and the
   finale reads "Season in Review (Week 17)" while everything else is just "Week N".


## v1.2.2 — CI fix: the scheduled run couldn't start
GitHub Actions failed immediately with `node: .env: not found` (exit code 9). Every npm script
ran `node --env-file=.env ...`, which forces Node to load a local .env file — but there IS no
.env on GitHub (it's gitignored, because it holds the API key). In Actions the settings come
from repo Secrets/Variables instead, so Node died before the generator ever ran.

All scripts now use `--env-file-if-exists=.env`: it still reads .env when you run locally, and
silently continues without it in CI, where the environment is supplied by Actions. Verified both
paths. Also bumped the workflow to Node 22 (Actions is deprecating Node 20).


## v1.2.1 — production readiness (deploy blockers)
Three bugs that would each have silently broken the live paper after deploying. None of them
show up in local testing, which is exactly why they're worth calling out.

1. THE SCHEDULED RUN WAS MISSING THE WHOLE TRADE DESK. `generate` (what GitHub Actions runs
   every Tuesday) never loaded any of the trade/roster intel that `regenerate` (the hand-run
   command we've been testing with) did. The live weekly paper would have shipped with no
   Trader Tiers, no Grade the Trade, no Revisionist History, a generic Trade Winds — and, worst
   of all, it would never have banked a trade-value snapshot. Both commands now call one shared
   loader (src/lib/frontoffice.js), so the scheduled paper and a hand-run paper are identical
   and cannot drift apart again.

2. TRADE-VALUE SNAPSHOTS WERE NEVER ACTUALLY RECORDED. getFantasyCalcValues() returns a
   { sleeperId: value } MAP, but the snapshot writer and the Revisionist value lookup both
   expected an ARRAY, so every write silently no-oped ("no data") and Revisionist History could
   never have worked. Both now accept either shape.

3. THE WORKFLOW ONLY COMMITTED docs/. Each Actions run starts from a fresh checkout and the
   container is destroyed afterwards, so anything not committed is lost. It now commits
   data-cache/ as well — the trade-value snapshots (irreplaceable: FantasyCalc has no historical
   API), the graded-once-ever memory, the season DB (prior power rankings + Trade Winds rumor
   memory) and history.json. Without this the snapshots would have been thrown away every single
   week and never accumulated.

Also in the workflow: GEMINI_API_KEY / GEMINI_MODEL are now passed through (it only offered
OpenAI/Anthropic keys, so a Gemini setup would have failed outright), a concurrency guard stops
two runs racing into a push conflict, and the push rebases instead of clobbering. SETUP.md now
documents Gemini, what's committed back and why, and the ~2-minute new-season rollover.


## v1.2.0 — trade value retention + Revisionist History
1. TRADE VALUE RETENTION (the foundation). Every run now banks a snapshot of the week's
   FantasyCalc player values to data-cache/trade-values.json. This matters because FantasyCalc
   only ever serves CURRENT values — there is no historical endpoint, so a week we fail to
   capture is gone forever. Two safeguards:
     * WRITE-ONCE per week. Re-running `regenerate --week 5` months later will NOT overwrite
       week 5's banked values with today's — that would silently corrupt every then-vs-now
       comparison. Once a week is recorded it is immutable.
     * PRESERVED by `npm run reset`, along with the graded-trade memory. Everything else in
       data-cache can be rebuilt from Sleeper; this cannot.
2. REVISIONIST HISTORY — "How That Trade Aged" (built to match the demo exactly). Looks back
   at OLD trades and shows what each side received, what it was worth THEN (from the banked
   snapshot for the trade's own week) and what it's worth NOW: a lede, a "Looked like X then ·
   Looks like Y now" verdict, and an aging card per side with value-then -> value-now and the
   swing (e.g. "8,000 -> 3,000  ▼ 5,000 (cratered)").
     * It hunts for DIVERGENCE — trades whose picture has moved a lot — and prefers ones where
       the verdict actually FLIPPED.
     * DYNASTY-AWARE: the writer is told a value gap is not automatically a blunder (a
       contender fairly pays a premium for win-now; a rebuilder fairly sells a vet), and that
       trades sometimes just don't pan out with nobody at fault. It judges the process, not
       only the swing.
     * GRADED ONCE, EVER. A trade that's been covered is recorded permanently and never
       resurfaces in a future issue.
     * MODULAR — if no old trade has both a banked "value then" and a real divergence, the
       section simply doesn't appear. It will be empty early on and fill in as snapshots
       accumulate; we never fake a "value then" with today's numbers.
   Trader Tiers remain VOLUME-ONLY — trade quality is used here and does not feed back into
   the tiers.


## v1.1.16 — upset/lead duplicate fix + Trade Winds strategic misalignment
1. UPSET NO LONGER REPEATS THE LEAD'S GAME (playoff weeks). The paper tracks which games a
   section has already claimed so no two sections cover the same matchup — but in the
   playoffs the lead was building a NEW object for its pick instead of pointing at the actual
   game, so the "already used" check never matched and the Upset section happily re-covered
   the lead's game. The playoff lead now references the real game object, so the exclusion
   works and Upset always picks a different matchup.
2. TRADE WINDS — STRATEGIC MISALIGNMENT. Beyond positional holes, the rumor mill now looks at
   whether each team's roster actually fits their competitive situation. For EVERY team it is
   given a compact profile — record/standing plus their oldest and youngest assets (with a
   flag for young players stuck on the BENCH). No hardcoded "aging" thresholds: the writer
   decides who's a rebuilder clinging to declining vets whose value bleeds out every week, or
   a contender letting youth rot on the bench instead of flipping it for win-now help. All 14
   teams are in play (so it doesn't recycle the same names), it's told to vary who it covers,
   and it still mocks the trade-shy whose phones ring unanswered. Player ages are now pulled
   into the player cache to support this. Trade Winds word cap 60 -> 95 for the extra material.


## v1.1.15 — pull-quote fix + power-ranking blurb length
1. LEAD PULL-QUOTE FIX — fixes a regression from v1.1.13. When the model emitted "PULL:" and
   then flowed straight into the article WITHOUT a "BODY:" label, the pull-quote field
   captured the entire article, so the big red pull-quote rendered the whole lead. Now: if a
   quoted string is followed by more text (or PULL runs long), the quote is kept as the
   pull-quote and the rest is moved into the body. Hard guard added so a pull-quote can never
   exceed ~25 words.
2. POWER RANKINGS — BLURB LENGTH. The per-team one-liners ranged from 4 words to 25+, making
   the two columns wildly uneven. The writer is now told to keep every blurb 6-12 words, and a
   hard clip trims any that still run long (cutting at a sentence break, else an ellipsis) so
   every team's comment is about the same size and the columns balance.


## v1.1.14 — quote variety, power-ranking balance + logic, rivalry depth, grade-trade font
1. QUOTE VARIETY — the reaction quotes kept reaching for the same pet words ("dazzle" etc.).
   Each quote now gets a randomly rotated TONE (cocky, bitter, deadpan, delusional, fed up,
   and so on) and an explicit ban on overused sportswriter clichés, so they read fresh and
   varied instead of same-y.
2. POWER RANKINGS — BALANCED COLUMNS. The model often stopped writing one-liners partway
   down, so the left column had notes and the right didn't. It's now told to write a line for
   ALL fourteen teams, and if any are still missing it retries once for just those — so both
   columns fill evenly.
3. POWER RANKINGS — LOGIC now 90% performance / 10% record (was 70/30). Heavily weighted to
   how teams actually SCORE, so the rankings meaningfully differ from the plain standings
   instead of mirroring them.
4. GRADE THE TRADE — the verdict text was rendering in the italic In-Memoriam style; it's now
   normal body text like the rest of the paper.
5. RIVALRY BOX — removed the all-time point-differential line from the stat box (it stays fed
   to the writer for the article, just not shown in the box). Box now shows the record + this
   week's score, clean.
6. RIVALRY DEPTH — the writer is now handed the actual list of PAST meetings (season, week,
   score, playoff flag) and told to cite specific old games ("back in their 2024 Week 14
   clash..."), plus the word limit went 70 -> 100 to give room for the history. Upset of the
   Week also went 55 -> 85 words.


## v1.1.13 — lead parser fix, rivalry box formatting, obituary paragraphs, grade-the-trade layout
1. LEAD PARSER — the lead's HED/DEK/PULL/BODY parsing is now robust. When the LLM returned
   the labels run together without clean line breaks, the old line-based regex grabbed too
   much (or failed to find BODY) and dumped the whole raw block — labels and all — into the
   article (the "HED: ... DEK: ..." text showing in print). It now parses by using the labels
   themselves as delimiters (each field runs until the next label), so labels never leak even
   when the model crams everything onto one line. Showed up on the playoff lead.
2. RIVALRY BOX — the all-time point-differential line no longer crams the team name and the
   number into the right-hand value ("Egbuka Matata  +8.26" with weird spacing). The leader's
   name is on the left and "+8.26 pts" on the right, matching the score lines below it.
3. IN MEMORIAM — when multiple teams are eliminated in one week (e.g. the three Round 1
   losers in the playoffs), each eulogy is now its own paragraph instead of being joined
   inline with a dagger separator.
4. GRADE THE TRADE — restructured so it's clear WHAT each side got. Instead of a single prose
   paragraph that buried the players, it now shows each side as a card (team, the players they
   received, and the value) with a letter grade badge, then a brief 1-2 sentence verdict
   underneath. Reads like a trade breakdown, not a wall of text.


## v1.1.12 — bracket advancement, playoff eulogies, rivalry stats, trade winds, grade the trade
1. BRACKET ADVANCEMENT — winners now visibly advance into their next-round slots. Because
   the paper publishes Tuesday after all of a week's games are done, we always know who
   advanced — so a Week-16 (semis) paper shows the two REAL finalists in the Championship
   box, not "Winner of SF1 / SF2". Only the result of a round that genuinely hasn't been
   played yet stays open (e.g. the champion isn't shown until the final is played).
2. PLAYOFF ELIMINATIONS GET EULOGIES — In Memoriam now runs during the playoffs too,
   eulogizing every team knocked out of the WINNERS bracket that week (Round 1 losers in
   Wk 15, semifinal losers in Wk 16, the runner-up in Wk 17). Consolation-bracket losers
   are ignored. Previously the obituary only ran in the regular season.
3. RIVALRY STAT EXPANSION — the rivalry engine now tracks all-time points for/against,
   all-time point differential, average margin, current win streak, playoff-specific record,
   and last-5 meetings. The box adds an ALL-TIME POINTS line (who's outscored whom); the
   richer stats (point diff, avg margin, streak, playoff meetings) are fed to the writer for
   deeper articles. The exact win-loss record is still the single source of truth.
4. TRADE WINDS REBUILD — replaced the thin/wrong version with a grounded rumor mill. It
   analyzes each roster's positional depth (who's thin at RB, stacked at WR, etc.), names
   specific teams with real needs, cooks up trade RUMORS ("fielding calls," "phone should
   be ringing"), and mocks the trade-shy whose phones "ring unanswered" while their roster
   stays broken. It REMEMBERS prior weeks' rumors (stored in the season DB) so it doesn't
   repeat and ESCALATES when a team's hole persists week after week.
5. GRADE THE TRADE (new, modular) — a snap report card on a FRESH trade (current week or one
   week back, one trade per week), graded against current FantasyCalc values with letter
   grades. Dynasty-aware: it weighs intent (a contender fairly overpays for win-now; a
   rebuilder fairly sells for youth) instead of just crowning the bigger-value side. Its own
   box; appears only when there's a recent trade to grade (modular, like Revisionist History).
   Awards NO tier points — that stays exclusive to Revisionist History.


## v1.1.11 — cleanup + reset command + trader tiers attribution
1. NUMBER FORMATTING — floating-point display artifacts (a margin showing
   "13.02000000000001") are gone; a num() formatter rounds shown scores/margins to 2
   decimals and trims trailing zeros, applied across the game box, dek, scoreboard, and
   rivalry box. The playoff-lead margin is also rounded at the source.
2. BRACKET — removed the ugly "#1 [team] — bye" note line; the #1 seed's bye is already
   clear from the bracket structure.
3. MASTHEAD — removed the centered "Dynasty Edition" from the flag bar (the center slot is
   now empty; the week is already shown on the left, "Filed by V. Malloy" on the right).
4. RESET command — `npm run reset` wipes the REBUILDABLE cache (season DBs, history.json,
   players.json) after a y/n confirmation, then tells you to run build-history + sync-season
   to catch back up. It NEVER deletes retained trade-value data (weekly FantasyCalc
   snapshots are irreplaceable — FantasyCalc has no historical API), so any file matching a
   trade-value pattern is preserved automatically. (The retention files don't exist yet —
   that's v1.2.0 — but reset already protects them for when they do.)
5. TRADER TIERS attribution FIXED — everyone was showing "F - 0" because trades come from
   Sleeper as roster_ids but the tiers count by owner_id, and the regular-season trade
   collector wasn't doing the roster->owner conversion (only the all-years collector was).
   Now collectTrades converts roster_ids to durable owner_ids, so trades attribute to the
   right managers and the tiers reflect real trade VOLUME. (Volume-based for now; quality
   weighting waits on trade-value retention in v1.2.0.)


## v1.1.10 — number formatting fix
Floating-point display artifacts (e.g. a margin showing "13.02000000000001" instead of
"13.02") are gone. Added a num() formatter that rounds any displayed score/margin to 2
decimals and trims trailing zeros, applied to the Game-of-the-Week box (scores + margin),
the dek, the scoreboard, and the rivalry box. Also rounded the playoff-lead margin at the
source (it was the main offender — computed with a raw subtraction that wasn't rounded).


## v1.1.9 — playoff patch (8 items)
1. BRACKET progressive reveal — a playoff-week paper now reveals ONLY the rounds that have
   been played by that week. Future rounds show the structure ("Winner of QF1") instead of
   the actual advancing team, and NO champion is shown until the Championship week is
   reached. (Sleeper returns the finished bracket for a completed season, so without this it
   spoiled the whole result in Week 15.)
2. BRACKET winners-only — consolation / losers-bracket games and placement games (3rd, 5th,
   etc.) are filtered out. Only the winners bracket (the path to the championship) is shown.
3. #1 SEED BYE — the bracket now notes the #1 seed's first-round bye (with 7 teams, only the
   top seed byes Round 1; seeds 2-7 play).
4. SEEDS LOCKED — seed numbers now come from the FINAL regular-season standings (through the
   last regular week) and stay frozen for the whole postseason, so the #1 seed always shows
   as #1. (They were being read from current standings, so they drifted — the actual #1 seed
   was showing as #2.)
5. PLAYOFF-MODE LEAD — during the playoffs the lead covers the biggest ACTUALLY-PLAYED
   winners-bracket game that week (closest margin = most dramatic). It never features the bye
   team (they didn't play) or a consolation game. Written as a win-or-go-home playoff story.
   (Previously it wrote a regular-season-style "Game of the Week" about a team that had a
   bye — a game that never happened.)
6. PLAYOFF BRIEFING to the writer — the LLM is now told the exact format (7 teams, #1 byes
   Round 1, Round 1 = Wk 15 / seeds 2-7, Semifinals = Wk 16, Championship = Wk 17, single
   elimination) so it stops using regular-season language ("bubble team," "playoff race,"
   "clinching") during the playoffs and frames everything as advance-or-be-eliminated.
7. PLAYOFF GAMES IN HISTORY — build-history now pulls the winners-bracket playoff games
   (weeks 15-17), flagged playoff:true, so playoff meetings count toward all-time rivalry
   records. (It stopped at the regular season, so a playoff rivalry meeting never counted.)
8. RIVALRY article + box = ONE source of truth — the exact all-time record is computed once
   and both the box and the article use it; the writer is handed that exact record string
   and told to state it verbatim, so the article and the box can never disagree (no more
   "3-2 in 5 meetings" in the prose while the box says "3-1 in 4").


## v1.1.8 — bracket rebuild + rivalry double-count fix
1. RIVALRY double-count FIXED — history.json's season chain STARTS with the current league,
   so it contained the current season's games; the rivalry also counts the current season
   from the live DB, so every current-season meeting was counted TWICE (Chase vs Merry Men
   showed "4-1"/5 meetings when the real all-time is 3: two in 2024, one in 2025). History
   is now filtered to PRIOR seasons only; the current season comes solely from the live DB.
   Complete all-time history, every game counted exactly once.
2. RIVALRY DEBUG command — `npm run debug-rivalry -- "Chase" "Merry"` prints every meeting
   the engine sees, labeled by source (history.json vs live DB), with a before/after count
   so any miscount is obvious. Diagnostic tool, safe to run anytime.
3. BRACKET — real bracket look. Rebuilt with connector lines joining each matchup to the
   next round, rounds left-to-right (Quarterfinals -> Semifinals -> Championship rightmost),
   seed badges, winners bold with a check, losers legibly greyed and struck (readable now,
   not ghost-faint), newspaper styling (serif, oxblood accents, double-rule champion banner).
4. BRACKET progressive reveal — a Week-15 paper (Round 1) now shows ONLY Round 1 results;
   Semifinals and Championship appear as upcoming/pending, and NO champion is shown until the
   Championship week is actually reached. Previously it rendered the whole finished bracket
   (spoiling the champion in Week 15) because Sleeper returns the completed bracket for a
   finished season. Rounds are mapped to weeks: R1 = playoff start (Week 15), R2 = 16, R3 = 17.
5. BRACKET week anchor — playoffs default to a Week 15 start (Round 1 = 15, Semis = 16,
   Championship = 17); Sleeper's live playoff_week_start overrides if the league differs.


## v1.1.7 — cleanup batch (8 items)
1. LEAD — loosened the strict one-game rule. It still must NOT recap or narrate other
   matchups, but it MAY now reference other teams when they affect THIS game's playoff/
   standings implications ("held their seed only because their pursuers also lost," "made
   the playoffs in spite of the loss"). The most interesting angle is no longer blocked.
2. PLAYOFF RACE collapses when the field is determined — if nobody is contending or on the
   bubble, the section shows only Clinched + Eliminated (the two empty middle columns
   disappear) and "What Needs to Happen" is dropped. Tag becomes "The Field Is Set."
3. PLAYOFF BRACKET (postseason) — once the playoffs start (Sleeper's official winners
   bracket exists, week > reg season), the paper renders the real bracket: rounds
   (Championship / Semifinals / Quarterfinals), seeds, who advanced (checkmark) vs
   eliminated (struck through), TBD slots, and a champion banner when the final is decided.
   It replaces the regular-season race view and persists through season's end. (Bracket
   data comes live from Sleeper, so this is the one piece only a real postseason run can
   fully prove.)
4. CONTROVERSY PULL-QUOTE — centered vertically (even margin) so it sits midway between the
   text and the divider below it, instead of hugging the text.
5. RIVALRY meeting count — the box was undercounting because it was fed an empty array for
   this season's games (only counting prior years). Now it includes this season's head-to-
   head, so the box count matches the article ("third installment" now shows 3 meetings).
6. MASTHEAD volume — "Vol." is now tied to the season: 2026 = Vol. 1, 2027 = Vol. 2, and so
   on (season - 2025). "No." remains the week. (The league's "Established 2023" is separate
   — that's the league's founding, not the paper's first volume.)
7. Removed the redundant centered "WEEK X" in the flag bar (the week is already shown on
   the left of that same bar); replaced with "Dynasty Edition."
8. Removed all image caption text — the photos stand on their own, no captions.


## v1.1.6 — logic & polish batch (5 items)
1. CONTROVERSY PULL-QUOTE — the decorative quote mark was rendering as raw text "201C"
   (double-escaped in the CSS). Fixed the escape so it's a real quotation mark, and
   restyled the pull-quote as a boxed tabloid callout with framing quote marks on both
   corners — distinct from the lead's quote.
2. PLAYOFF SCENARIO LOGIC — deliberate rebuild. It was naming already-clinched teams far
   ahead as "root against" targets and omitting the actual teams a bubble team is chasing.
   Now it identifies the real cutoff teams (the ones holding the last seats you can still
   reach), gets "controls own fate" right, uses correct magic numbers, and handles the
   points-for tiebreaker. Scenarios are LEAN but PRECISE (~15-20 words, every fact exact).
   Still spotlights the 6 most interesting teams.
3. OBITUARY / IN MEMORIAM — now eulogizes only teams eliminated THIS WEEK (compares this
   week's eliminated set vs last week's), and eulogizes ALL of them, not one picked at
   random from everyone ever eliminated. If nobody was newly eliminated, the section
   disappears. (Also cleaned up the "In Memoriam ·" leading-dot header.)
4. BENCH CRIME REPORT — was reading custom.bench_points, a field Sleeper doesn't provide,
   so it was always empty. Rebuilt to compute from real lineup data: finds benched players
   who outscored a starter at the SAME position, and calls out up to 3 of the worst
   start/sit blunders league-wide ("started X (9) at QB while Y put up 28 on the bench").
   Needs the players cache (already synced each run) for positions.
5. SCOREBOARD — made it read like a real results page: winner's score bold, loser's
   greyed, the week's single highest score gets a marker, and subtle alternating row
   shading. Same structure/data, just proper scoreboard texture.


## v1.1.5 — same as v1.1.4 content, new version number
Identical code to the completed 16-item Patch 1. Re-versioned only to give it an
unmistakable new filename (the previous v1.1.4 filename was reused, which caused
confusion about which build was which). If you tested and saw NO weather box, NO
controversy pull-quote, and the old scoreboard, you were viewing an HTML file generated
BEFORE unzipping — regenerate after unzipping THIS build to see the Patch 1 changes.


## v1.1.4 — Patch 1 of 3 (visible content fixes) [COMPLETE]
The first of three agreed patches from the big review. 16 items.

1. LEAD / GAME OF THE WEEK — picks by STAKES first (contenders clashing, seeding/bubble,
   a contender stumbling), ramping up late season; falls back to the SPICIEST game if
   nothing is at stake. Headline, the box BESIDE the lead, and the quote BESIDE the lead
   all follow that ONE game; quote comes from the WINNER. Fed each team's record + seed so
   it spells out WHY it matters; hard rule forbids mentioning any other matchup.
2. LEAD length 250 -> 220, and broken into 2-3 paragraphs (was one dense block).
3. WEATHER BOX restored (league-wide High/Low/Spread) — it had been removed in the lead
   rewrite; put back.
4. TEMPORAL STANDINGS — articles now reference where a team stood GOING INTO the week and
   how the result moved them ("the now-#2 seed," "fell from #1"), never describing a team
   by its post-result seed as if it were already there. Prior-week standings computed from
   the DB and fed to the lead.
5. PLAYOFF "WHAT NEEDS TO HAPPEN" — the 6 MOST INTERESTING teams (bubble, contenders in
   danger, live longshots), not just the top 6 by rank.
6. CONTROVERSY CORNER — rotates weekly across 8 angles (Feud, Overreaction, Mock
   Investigation, Power Abuse, Redemption/Downfall, Trade Outrage, Coaching Malpractice,
   Petty Grievances). Fed real standings. Subject distribution applies only when
   MANUFACTURING (avoids games used by lead/upset/rivalry); a player SUBMISSION is exempt
   and follows its own topic.
7. CONTROVERSY PULL-QUOTE — a separately-written pull-quote runs beside the column to fill
   the space, drawn to reflect THAT column, styled differently from the lead's quote
   (centered, big lead-in quote mark) so it doesn't look copy-pasted.
8. IMAGES 2 & 3 — remapped to the 3 real photo slots (broke in v1.1.3's count 5->3).
9. UPSET — cascade: power rankings -> record -> last week's standing -> NEAR-MISS ("the
   upset that almost was") instead of the lazy "chalk, how boring" dead-end.
10. SCOREBOARD — rebuilt as a clean full-width single list of all games (winner bolded,
    "def." separator, score right-aligned), replacing the lopsided half-boxed version.
11. POWER RANKINGS weighting 60/40 -> 70/30 (scoring/winning), in both render and
    sync-season, so rankings diverge more from raw record.
12. RIVALRY all-time wording fix — no more "leads the series 1-1" (a contradiction). Now
    "dead even at X-X" when tied, names the ACTUAL leader when someone leads, "first
    meeting" when none.
13. OBITUARY / IN MEMORIAM — now renders: a mock eulogy for a team eliminated from playoff
    contention (triggers on elimination only). Was built but never wired.


## v1.1.3 — display polish batch (items 1-6)
Six agreed fixes, batched and tested together.

1. CONTROVERSY ALL-CAPS: no-caps rule added to the controversy prompt (it builds its
   own prompt and wasn't getting the global guardrail), PLUS a code-level de-shout in
   cleanProse() that softens any ALL-CAPS emphasis word (4+ letters) to normal case
   while preserving real acronyms (NFL, RB, TE, QB, PPR, LGBTQ, etc.).
2. LEAD length: word cap 200 -> 250 to fill the column under the main article.
3. SUBJECT DISTRIBUTION: a usedGames tracker ensures Lead, Controversy, Upset, and
   Rivalry each cover a DIFFERENT game — no two sections share a matchup.
4. POWER RANKINGS 7/7: the column split is now an explicit even split (7 left, 7 right)
   instead of CSS auto-flow, which balanced by height and gave uneven 6/8.
5. IMAGES: the paper only has 3 real photo spots (Game of Week, Trade Wire, Last Word),
   but the code was requesting 5 from a pool of 8 — forcing 2+ repeats every week. Now
   requests 3, matching the real spots, so weeks rarely overlap.
6. THE LAST WORD: the closing sign-off is now LLM-written fresh each week (same weary
   Malloy attitude, new wording) instead of the same hardcoded line every issue.

Untouched (working, left in scope): data architecture, standings/playoff/rivalry logic,
retry backoff, drop caps, markdown/emoji/{WEEK} cleanup.


## v1.1.2.3 — subject distribution now covers Upset too
- UPSET vs CONTROVERSY collision: Upset of the Week picked its game independently and
  could land on the same matchup as Controversy (or any section). Now findUpset()
  respects the usedGames tracker and registers its pick. All four game-focused sections
  — Lead, Controversy, Upset, Rivalry — run in order and each claims a DISTINCT game, so
  none can share a matchup.


## v1.1.2.2 — subject distribution (no two sections share a game)
- RIVALRY vs LEAD collision: the Rivalry Desk could pick the same matchup as the lead
  story (game of the week). Fixed with a systematic usedGames tracker — the lead claims
  its game, then Controversy and Rivalry each pick from the REMAINING games, so no two
  sections ever lead with the same matchup. This generalizes the earlier Controversy fix
  so it can't recur in another section.


## v1.1.2.1 — caps fix + lead length (quick patch on 1.1.2)
- CONTROVERSY CORNER ALL-CAPS: the no-caps guardrail wasn't reaching this section —
  controversyPrompt() builds its own self-contained prompt and didn't include it. Added
  the no-ALL-CAPS rule directly to both controversy modes (manufactured + submitted).
  ALSO added a code-level de-shout in cleanProse(): any ALL-CAPS emphasis word (4+
  letters) the LLM writes anyway is softened to normal case, while real acronyms
  (NFL, RB, TE, QB, PPR, LGBTQ, etc.) are preserved. Belt-and-suspenders, so caps can't
  slip through regardless of the model.
- LEAD length: 200 -> 250 words (still empty space under the main article).


## v1.1.2 — Content & Voice (Piece 2a of the demo-match work)
The writing/presentation half of the post-review fixes. Focus: how the paper reads.
(v1.1.3 will handle trade-data infrastructure: trader-tier attribution, value
retention, trade-winds roster analysis, reset command.)

Fixed:
- LEAD length: word cap raised 130 -> 200 to fill the column under the main article.
- PLAYOFF RACE: seed numbers now use each team's REAL rank (were hardcoded positional
  offsets, so they were wrong). Tiers use the real cumulative records from the DB, so
  eliminated teams no longer show as "bubble." The "What Needs to Happen" scenarios are
  now LLM-written in Malloy's voice, varied per team — no more the same copy-pasted
  "Controls its own fate: win out (X of 6)..." line for everyone.
- RIVALRY DESK: now picks the SPICIEST of the week's matchups using all-time head-to-
  head history (close series / lopsided / chronic nail-biters score highest), shows an
  "All-Time Series" record box, and is written like a real rivalry column with history
  and bad blood — not just this week's score. (All-time data needs build-history.)
- CONTROVERSY (and all sections): added a guardrail banning ALL-CAPS emphasis
  (BALONEY!, JUSTICE!) — reads naturally now, not shouty. Same guardrail bans emoji in
  prose.
- SUBJECT DISTRIBUTION: Controversy Corner now deliberately covers a DIFFERENT game
  than the lead story (was rebuilding the exact game-of-the-week). Sections spread
  coverage across the week instead of rehashing one game.
- POWER RANKINGS: fixed the triple-record display (record was appearing ~3x per line) —
  the LLM is no longer fed the record to echo, so it shows once, cleanly. Movement
  arrows (green ▲N / red ▼N) now actually appear: sync-season computes and saves each
  week's ranking order as it backfills, so there's a prior week to compare against.

Untouched (working, left in scope): the v1.1.0 data architecture, v1.1.1 cleanup
(drop caps, markdown/emoji strip, {WEEK} fix, retry backoff), template/layout/CSS.


## v1.1.1 — formatting & cleanup pass (Piece 1 of the demo-match work)
The first half of the post-review fixes. Focus: make the output clean and match the
demo's formatting. (Piece 2 / v1.1.2 will cover the bigger content features:
playoff-scenario variety, rivalry all-time + narrative, trade-winds roster analysis.)

Fixed:
- DROP CAPS: every LLM-written section's first paragraph now gets the big red
  drop-cap letter (was missing entirely). Centralized in a cleanProse() helper.
- MARKDOWN: Gemini's raw **bold** / *italic* were showing as literal asterisks.
  Now stripped/converted across all prose, quotes, headlines, and blurbs.
- EMOJI: stripped from generated prose (the 📈➡️📉 Gemini adds), while emoji that
  are part of a team/player NAME (e.g. King 💩) are preserved — names come from
  data, not prose.
- {WEEK} LEAK: the literal "{WEEK}" placeholder no longer appears. Resolved at the
  prompt source (buildSectionPrompt) so the model never sees it, plus belt-and-
  suspenders stripping in cleanProse and quotes.
- POWER RANKINGS formatting: removed the ugly double "— —" and stray emoji; clean
  line format now. Movement arrows rewritten to show green ▲N / red ▼N with the
  number of spots moved, and NOTHING when a team holds its spot (computed from the
  saved prior-week ranking in the season DB).
- TRADER TIERS: was hardcoded empty ([]); now actually wired to the traderTiers
  engine (volume-based S/A/B/C/F tiers). Value-quality weighting comes later with
  FantasyCalc.
- STALENESS WATCH: shows "Never" instead of the ugly placeholder "999 days" for
  teams with no trades on record. Real day counts (which already worked) unchanged.
- RETRY BACKOFF: now climbs 2s → 5s → 15s → 30s → 60s over up to 6 attempts, so a
  Gemini per-minute rate-limit is actually waited out instead of failing fast.

Verified (not changed — was already correct):
- IMAGE PICKER: confirmed it already varies by week (seeded on season+week). The
  "same 3 images" was from only ever regenerating the SAME week (week 8), which
  correctly produces the same images each time. Different weeks get different sets.

Untouched (working, left in scope): template/layout/CSS, masthead, design system,
the real-standings/playoff data architecture (v1.1.0), .env loading, length caps.


## v1.1.0 — real season data + reconnected sections
The big rebuild from the full paper review. Data now reflects the real season.

Data architecture:
- NEW `sync-season` command — backfills all current-season played weeks into a
  season database (for mid-season starts or rebuild-after-bug).
- `generate` now APPENDS each week to the season DB; `regenerate` UPSERTS its week
  (replace, no duplicates). Standings/playoff/movement read the accumulated DB.
- Standings now show REAL W-L records (sorted by record, points-for tiebreaker) —
  not one week's points with fake W/L letters.
- Playoff Race shows REAL records + real clinch/elimination math — not weekly points.

Reconnected sections (engines existed; the v1.0 render had dropped/stubbed them):
- Controversy Corner — was missing entirely; wired back in (submissions or
  manufactured drama, with the submission button).
- Trade Desk Staleness Watch — computes days-since-last-trade, flags 90+ days.
- Trade Desk Trader Tiers — wired to trade data.

Content/logic fixes:
- Power Rankings now weighted toward PERFORMANCE (points) over record, labeled as
  such, with REAL week-over-week movement (green ▲ / red ▼), saved each week.
- Upset of the Week = a real underdog win (worse-ranked team beats better-ranked),
  not the biggest blowout.
- Headline, dek, and pull-quote are now LLM-generated and unique each week (were
  hardcoded templates); headline + dek are one coherent story.
- Quotes are freshly generated every week (no hardcoded/repeated quotes).
- Removed the leftover "RUMOR FORMAT / [Team]" placeholder box from Trade Winds.

Untouched (working, left alone): template/layout/CSS, masthead, design system,
image handling, .env loading, retry logic, length caps.


## v1.0.3 — third quote slot
Fixed:
- Added the Trade Winds pull-quote (from "a source familiar with the matter").
  v1.0.2 only wired 2 of the 3 quote slots; now the lead, Luck Ledger, AND Trade
  Winds all have their quotes, matching the demos. Includes a fallback line so the
  slot never renders empty if the LLM quote call fails.


## v1.0.2 — length caps + quotes restored
Fixed:
- Gemini was writing sprawling paragraphs. Added HARD per-section word caps to
  the prompts (lead ~130 words, side columns 40-70, etc.). Newspaper-punchy now,
  not essays.
- Pull-quotes were missing (the demo had them, the v1.0.1 rebuild dropped them).
  Restored: the lead gets a quote from the week's top scorer, the Luck Ledger gets
  one from the highest-scoring loser. Short (<=18 words), LLM-written, attributed.


## v1.0.1 — layout fix + images in live output
Fixed:
- Rebuilt render.js to produce the SAME structured sections as the approved demos.
  v1.0.0 flattened everything into raw prose (power rankings became one run-on
  paragraph, playoff race became a rambling essay, stat boxes disappeared). Now
  the structure (14 formatted rank lines with arrows, the four playoff tiers, the
  standings table, stat boxes) is built from real data, and the LLM prose drops
  only into the body-text slots — matching the demo look.
- regenerate.js now loads photos from /images and passes them to the paper (it
  never did before, so live issues always showed halftone placeholders). Paths
  are docs-relative so they resolve on GitHub Pages.
- Tagline simplified to "Malloy" (was "—Malloy, who watches everything").


## v1.0.0 — first working live pipeline
The build where the LLM actually writes the paper end-to-end.

Fixed:
- `.env` now loads automatically on every command (added `--env-file=.env` to all
  npm scripts). Previously `.env` was never read, so the provider silently fell
  back to "anthropic" with no key and rendered a blank page.
- Added retry-on-503 / transient-error logic to the LLM call (up to 4 attempts
  with backoff). A momentary Gemini "high demand" no longer blanks the issue.
- Raised Gemini token budget to 4096 so its "thinking" tokens don't starve the
  article output.
- Rebuilt the render layer so LLM prose is merged into the structured section
  objects the template expects, with real engine data (scores, standings, boxes)
  computed per section. This was the missing link that kept the live path from
  ever producing a real paper.
- Section failures are now loud (visible on the page + logged), and an all-fail
  run throws a clear error instead of producing a silent blank page.

Included:
- Full engine suite, broadsheet template, demo + regenerate + test-form commands,
  Gemini/OpenAI/Anthropic provider support, upgraded playoff scenarios, aging-trade
  revisionist history, controversy corner with Google Form wiring, 5 image slots.
