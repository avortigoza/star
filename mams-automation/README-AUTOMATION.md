# MAMS Storage Audit — Monthly Automation

**In plain terms:** your script already runs on your Mac and creates `IBM.csv` and
`COMP.csv`. Right now, getting that data into the web app requires opening the
browser and clicking "Import." This adds **two lines to the end of your existing
script** that send those two files straight to the app the moment they're created —
no browser, no click. Same script, same schedule as today, just two extra lines.

Separately, a second script (`monthly-report.js`) runs on the server hosting the
web app and, once a month, rebuilds the Excel export + AI summary and emails them to
you. That part is unrelated to your Mac script — it just reads whatever's already in
the app's data.

This is a bolt-on: it doesn't modify `server.js`, `App.tsx`, or your CSVs. Your
manual Import/Export/AI buttons in the browser keep working exactly as before.

## Part 1 — Mac side: auto-send IBM.csv / COMP.csv after each run

Your script:
```
/Users/postmams/Documents/scripts/audit_storage/audit_storage ver2.sh
```

**Step 1.** Copy this whole `mams-automation` folder onto the Mac, right next to
that script, so you end up with:

```
/Users/postmams/Documents/scripts/audit_storage/
├── audit_storage ver2.sh          <- your existing script (I've added 2 lines - see below)
├── data/                          <- already exists, where IBM.csv/COMP.csv land
└── mams-automation/                <- copy this folder here
    ├── scripts/push-to-mams.js
    └── logs/
```

**Step 2.** I've already added the two lines to the bottom of
`audit_storage ver2.sh` in this package (open it and scroll to the bottom, after the
`Ardome_All_Mats_COMP.csv` line, to see them). Replace your current script with this
version — or if you'd rather not overwrite it, just copy those last 5 lines
(starting with `# ---- Added:`) onto the end of your original file yourself.

Those lines run:
```sh
node "/Users/postmams/Documents/scripts/audit_storage/mams-automation/scripts/push-to-mams.js" IBM "$loc/IBM.csv"
node "/Users/postmams/Documents/scripts/audit_storage/mams-automation/scripts/push-to-mams.js" COMP "$loc/COMP.csv"
```

**Step 3.** `push-to-mams.js` needs to know the web app's address. Set it as an
environment variable. Two ways:
- If your script is triggered by `cron` (check with `crontab -l`), add this line by
  itself when you run `crontab -e`, above the line that runs the script:
  ```
  MAMS_API_URL=http://<the-vm's-ip>:5179
  ```
- Otherwise, edit the default fallback near the top of `push-to-mams.js` directly.

I don't actually know the VM's IP for certain — confirm it from the Mac with:
```bash
curl http://<the-vm's-ip>:5179/api/health
```
(should return something like `{"status":"ok",...}`).

**Step 4.** Confirm Node's install path and fix it in the script if needed:
```bash
which node
```
The script currently assumes `/usr/local/bin/node`. If `which node` shows something
different (e.g. `/opt/homebrew/bin/node` on Apple Silicon Macs), edit the two `node`
lines at the bottom of the script to match.

**Step 5.** Create the log folder and test:
```bash
mkdir -p "/Users/postmams/Documents/scripts/audit_storage/mams-automation/logs"
export MAMS_API_URL=http://<the-vm's-ip>:5179
sh "/Users/postmams/Documents/scripts/audit_storage/audit_storage ver2.sh"
```
Then check the web app in the browser — IBM/COMP data should be updated — and look
at `mams-automation/logs/push.log` for two "Pushed N rows" lines.

`push-to-mams.js` has **no npm dependencies** — it only uses Node's built-ins, so
there's nothing to install on the Mac.

**Safety note:** if a run produces 0 rows (e.g. a volume was unmounted when it ran),
`push-to-mams.js` refuses to push and exits with an error, so a bad run can't wipe
out good data already in the app. If data ever looks stale, check `push.log`.

## Part 2 — Server side: monthly Excel + AI summary email

This is unrelated to the Mac. Put a **second copy** of this `mams-automation`
folder on the machine hosting the Docker container, next to `docker-compose.yml`:

```
your-project/
├── docker-compose.yml
├── data/
└── mams-automation/
```

```bash
cd mams-automation
npm init -y
npm install nodemailer dotenv
cp .env.example .env
```

Edit `.env`:
- `EMAIL_USER` / `EMAIL_PASS` — a Gmail address and a **Gmail App Password** (see
  comments in `.env.example` for how to generate one — not your normal password).
- `EMAIL_TO` — who should receive the report.
- Leave `MAMS_API_URL` / `MAMS_DATA_DIR` as-is if you followed the folder layout above.

### Caveat: "Via Web" usage numbers
The usage numbers typed into the app's UI aren't in any CSV — they're typed by hand.
`monthly-report.js` uses whatever's currently saved, so update that in the app
before month-end, or the report will reflect last month's figure.

### Schedule it
```bash
crontab -e
```
```cron
0 23 28-31 * * cd /path/to/mams-automation && [ "$(date -d tomorrow +\%d)" = "01" ] && /usr/bin/node scripts/monthly-report.js >> logs/monthly-report.log 2>&1
```
(cron has no native "last day of month" — this runs daily in the 28–31 range and
only actually fires when tomorrow is the 1st.) Replace the path, confirm
`/usr/bin/node` with `which node`, and `mkdir -p logs` first.

### Test it
```bash
node scripts/monthly-report.js
```
Check your inbox.

## What still needs a human
- Updating the "Via Web" usage numbers before month-end.
- Confirming macOS cron has permission to read `/Volumes/...` — under System
  Settings → Privacy & Security → Full Disk Access, add `cron`/`Terminal` if paths
  come up empty.

Everything else — pushing CSV data, Excel export, AI summary, and email — runs
unattended.
