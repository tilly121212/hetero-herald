# Deploy Guide — GitHub + Free Automation

This gets the Herald running on GitHub Actions, publishing itself every week to a
free public URL. Plan for about 20 minutes. No server, no hosting bill.

## What you'll end up with

- The code lives in a GitHub repo.
- Every Tuesday morning, GitHub runs the generator for free.
- New issues publish to `https://YOUR-USERNAME.github.io/YOUR-REPO/`.
- You share that link (or a specific week's link) in your league chat.

---

## Step 1 — Get the code onto GitHub

1. Create a new repository on GitHub (e.g. `hetero-herald`). Public is simplest
   and keeps Actions unlimited-free.
2. Push this project to it:
   ```bash
   git init
   git add .
   git commit -m "The Hetero Herald"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
   git push -u origin main
   ```

## Step 2 — Get your LLM API key

You need an API key (this is separate from any ChatGPT/Claude subscription).

- **Google Gemini (what this is set up to use — free tier):** aistudio.google.com/apikey
  → create a key (starts with `AIza`). Do NOT enable billing and it stays free.
  The free tier is enough for a weekly paper.
- **OpenAI:** platform.openai.com → API keys → create one. Add a small amount of credit
  ($5 lasts a very long time at this usage). Set a spending cap so it can't surprise you.
- **Anthropic (Claude):** console.anthropic.com → API keys → create one.

Any of them works — the paper is provider-agnostic. Switching is a one-line change
(the `LLM_PROVIDER` variable below).

## Step 3 — Add your settings to GitHub

In your repo: **Settings → Secrets and variables → Actions**.

Add one **Secret** (this is the sensitive one):
- `LLM_API_KEY` = your API key from Step 2

Add these **Variables** (not secret):
- `LEAGUE_ID` = your current-season Sleeper league ID (the 18-digit number in
  your league's URL)
- `LLM_PROVIDER` = `gemini` (or `openai` / `anthropic`)
- `OPENAI_MODEL` = (optional) e.g. `gpt-5.4-mini` to pick a cheaper/newer model

## Step 4 — Turn on GitHub Pages (the public URL)

**Settings → Pages**:
- Source: **Deploy from a branch**
- Branch: **main**, folder: **/docs**
- Save.

After the first issue publishes, your paper is live at
`https://YOUR-USERNAME.github.io/YOUR-REPO/`.

## Step 5 — Seed the history (one time)

From the **Actions** tab, or locally, run the history build so rivalries and
champions have data:
```bash
npm run build-history
```
(Locally this needs Node 18+ and `npm install` first. It writes to `data-cache/`
and, for the parts that matter long-term, is committed by the Action.)

## Step 6 — Test it before trusting the schedule

From the **Actions** tab → the "Publish The Hetero Herald" workflow → **Run
workflow** (manual trigger). Watch it run. If your league's season is live, it
publishes the latest week. If it's the offseason/pre-draft, it correctly does
nothing — that's expected.

To preview locally anytime without touching live data:
```bash
npm install
npm run demo -- --week 8
# open demo-output/2025-week-8.html
```

## Step 7 — Let it run

The schedule in `.github/workflows/publish.yml` fires every Tuesday at 15:00 UTC
(~7am Pacific), after Monday Night Football. Adjust that cron line if you want a
different time. From here it's hands-off:

- In-season: a new issue each week.
- After the championship: the season review, automatically.
- Offseason: quiet, until next season's Week 1 finishes.

---

## Fixing or re-rolling an issue

If a week comes out wrong, or you switch LLMs and want to rebuild:
```bash
npm run regenerate -- --week 8                      # rebuild week 8
npm run regenerate -- --week 8 --provider anthropic # rebuild with a different LLM
```
This overwrites just that one issue; the rest of the archive is untouched.

## Swapping LLM providers permanently

Change the `LLM_PROVIDER` variable in GitHub (Step 3) to `openai` or `anthropic`,
and make sure `LLM_API_KEY` matches that provider. Done — no code change.

## Photos (optional)

Drop black-and-white football photos into the `images/` folder and commit them.
The paper rotates them automatically. Empty folder = halftone placeholders, which
look intentional. See `images/README.md`.

## The submission form (optional)

To let league mates submit drama for the Controversy Corner, see **FORM-SETUP.md**.

---

## What gets committed back to the repo (and why)

Each Actions run starts from a fresh checkout and the container is thrown away when it
finishes. So anything the Herald needs to REMEMBER between weeks has to be committed back.
The workflow commits two folders:

- **`docs/`** — the published papers (this is what GitHub Pages serves).
- **`data-cache/`** — the Herald's memory. Do not gitignore this. It holds:
  - `trade-values.json` — the weekly FantasyCalc value snapshots. **These are
    irreplaceable.** FantasyCalc only serves *current* values (no historical API), so a
    week that isn't captured is gone forever. Revisionist History ("how that trade aged")
    is built entirely on these. They are written **once per week and never overwritten**,
    so re-running an old week can't corrupt them.
  - `revisionist-graded.json` — which trades have already been written about, so the same
    trade is never graded twice.
  - `season-<leagueId>.json` — prior weeks' power rankings (for the movement arrows) and
    the Trade Winds rumor memory (so it doesn't repeat itself).
  - `history.json` — the past-season game log used by the Rivalry Desk.

`players.json` is gitignored on purpose — it's large and re-downloads from Sleeper cheaply.

## Each new season (about 2 minutes)

Sleeper mints a brand-new league ID every year. When the new season starts:

1. Update the `LEAGUE_ID` variable in **Settings → Secrets and variables → Actions**.
2. Locally, run `npm run reset` (this clears the rebuildable cache but **preserves** your
   trade-value snapshots and graded-trade memory), then `npm run build-history` and
   `npm run sync-season`, and commit the refreshed `data-cache/`.

`build-history` follows Sleeper's `previous_league_id` chain, so giving it the new ID
automatically pulls every prior season back into the history — you don't lose anything.
