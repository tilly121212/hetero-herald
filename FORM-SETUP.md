# Form Setup — Controversy Corner Submissions

This lets your league mates submit hot takes, grievances, and accusations. Each
week the paper features one at random. If nobody submits, the paper manufactures
its own drama, so this is optional — but it's more fun with real submissions.

Plan for about 10 minutes. Everything here is free.

---

## Step 1 — Create the Google Form

1. Go to **forms.google.com** → blank form.
2. Title it something like **"Herald Hot Takes."**
3. Add these questions:
   - **"Your team name"** — short answer. (So Malloy can attribute the take.)
   - **"Your take / accusation / drama"** — paragraph. (The actual submission.)

   That's all you need. The submission's date is captured automatically, which is
   how the paper knows a take belongs to the current week — you don't need a
   "which week" question.

## Step 2 — Connect responses to a sheet

1. In the form, click the **Responses** tab.
2. Click the green **Sheets** icon → **Create spreadsheet.**
3. This makes a Google Sheet that fills in automatically as people submit.

## Step 3 — Publish that sheet as CSV

In the **spreadsheet** (not the form):
1. **File → Share → Publish to web.**
2. Choose the responses tab (usually "Form Responses 1").
3. Choose **Comma-separated values (.csv)** as the format.
4. Click **Publish**, confirm, and **copy the URL.** It ends in `output=csv`.

Keep this URL — it's your `SUBMISSIONS_CSV`.

## Step 4 — Get the form's share link

1. In the **form**, click **Send** (top right) → the **link** icon (🔗).
2. Copy the link (optionally tick "Shorten URL").

This is your `FORM_LINK` — the button league mates click in the paper.

## Step 5 — Give the two URLs to the Herald

**On GitHub** (Settings → Secrets and variables → Actions → Variables):
- `FORM_LINK` = the form share link from Step 4
- `SUBMISSIONS_CSV` = the published CSV url from Step 3

**Locally** (in your `.env` file):
```
FORM_LINK=https://forms.gle/xxxxxxxx
SUBMISSIONS_CSV=https://docs.google.com/spreadsheets/d/e/.../pub?output=csv
```

## Step 6 — Test that it works

Before trusting it, run the test command:
```bash
npm run test-form -- --csv "YOUR_SUBMISSIONS_CSV_URL"
```

It will tell you:
- whether it can reach the sheet,
- how many submissions it found,
- which are in the current week's window,
- and which one would be featured.

Submit a test take through your own form first, then run this — you should see it
appear.

---

## How it behaves

- **Fresh submissions only.** Each week's paper uses submissions from the last 7
  days (since the previous issue). Older ones naturally drop out — no manual
  clearing needed.
- **One featured at random.** If several people submit in a week, one is picked at
  random and featured. The pick is stable if the issue is regenerated.
- **Never empty.** If nobody submits, the Controversy Corner manufactures a
  tabloid scandal from that week's real events instead. The submission button
  still shows, inviting takes for next week.

## Privacy note

The responses sheet is published as read-only CSV — the paper can read it but
cannot change it. Only publish the responses tab, nothing else in the sheet. This
is a private league tool; keep the links within your group.
