# The Hetero Herald

An auto-generated weekly fantasy football newspaper for a Sleeper dynasty league.
Every week it pulls your league's real results, writes a full broadsheet of
articles (recaps, power rankings, a playoff race, trade desk, manufactured
tabloid drama, and more) in the voice of "Vince Malloy," and publishes it to a
clickable URL. It runs itself for free on GitHub Actions.

## What it does automatically

- **Weekly issue** after each week's scores finalize
- **Season-in-review** edition automatically after the championship
- **Goes dormant** in the offseason, **wakes up** once the new season's Week 1 finishes
- Every issue lives at a permanent, shareable URL (e.g. `.../2025-week-8.html`)

## Sections

Game of the Week · Upset of the Week · Bench Crime Report · The Luck Ledger ·
Malloy's Power Rankings · Standings · Rivalry Desk (multi-year) · Trade Winds
(rumor mill) · The Trade Desk (staleness, all-time trader tiers, weekly grades,
revisionist trade history) · The Playoff Race (from Week 6) · Obituaries (on
elimination) · Controversy Corner (reader-submitted or manufactured drama).

## Commands

```bash
npm run generate                      # the automatic run — writes whatever's due
npm run demo -- --week 8              # preview any week with sample data
npm run demo -- --review              # preview the season-in-review edition
npm run regenerate -- --week 8        # force-rebuild one issue (glitch / LLM swap)
npm run regenerate -- --week 8 --provider anthropic   # rebuild using a different LLM
npm run build-history                 # one-time: seed multi-year rivalries & champions
npm run test-form -- --csv "URL"      # verify your Google Form submissions are readable
```

## Setup

See **SETUP.md** for the full deploy walkthrough (GitHub + free automation) and
**FORM-SETUP.md** for wiring the Controversy Corner submission form.

## Cost

Free, except the LLM API — roughly a few cents per issue, well under $1/month for
a season. Everything else (GitHub, Actions, Pages, Sleeper, FantasyCalc) is free.

## Notes

- Team names are used verbatim; the writer roasts football decisions only.
- The paper is written each week knowing only that week and earlier — no spoilers
  from the future leak into past issues.
- Revisionist trade history starts empty and fills as trades happen and age
  (needs ~3 weeks per trade before it appears).
