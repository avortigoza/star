# MAMS Storage Audit — Automation

**Status: fully automated, all three pieces below run unattended.** No manual
Import click, no manual Excel export, no manually typing in "Via Web" usage
numbers before month-end — all of that used to be true and no longer is.

Three jobs chain together across two machines:

| Time | Runs on | Job | Does |
|---|---|---|---|
| Midnight, last day of month | Mac Studio | `audit_storage ver2.sh` | Scans `/Volumes/snibmprod` + `/Volumes/snibmfs5kprod`, writes `IBM.csv`/`COMP.csv`, pushes both into the app via `push-to-mams.js` |
| 8:00 AM, every day | VM | `fetch-usage.js` | SSHes into the Mac Studio, runs `df -k` on both volumes, pushes fresh "Via Web" usage numbers into the app |
| 10:00 AM, last day of month | VM | `monthly-report.js` | Reads the app's data, builds the Excel export + AI summary, emails both out |

The 8am daily refresh means the "Via Web" numbers are always current by the
time the 10am email fires — no more updating them by hand before month-end.

This is a bolt-on: it doesn't modify `server.js`, `App.tsx`, or your CSVs. The
manual Import/Export/AI buttons in the browser still work exactly as before.

## Hardware note: Dell Compellent → IBM FS5K (Sept 2026)

The second storage array was replaced: `sncomprod` (Dell Compellent, 616 TB)
is now `snibmfs5kprod` (IBM FS5K, 440 TB). Every mount path, capacity number,
and human-facing label (UI, printed report, emailed report, AI prompt/summary
text) was updated to match.

**What did NOT change:** the internal identifier `comp`/`COMP` — used as the
JSON key in `data/usage.json` and `data/rows.json`, the CSV filename
(`COMP.csv`), the `/api/v1` endpoint key (`GET /api/v1/rows/comp`), and
variable names throughout the code (`dellRows`, `CAP_DELL`, etc.). Renaming
that internal key would have broken the `/api/v1` contract other apps may
already be querying, plus historical CSV/JSON data — not worth it for what's
just an arbitrary internal label. Read `comp` as "the second storage array,"
not literally "Compellent," going forward.

If a third hardware swap ever happens again, repeat this pattern: update the
mount path, capacity, and every display-facing string; leave the internal
`comp` key alone unless there's a real reason to touch the data schema itself.


## Part 1 — Mac Studio: scan + auto-push CSVs

Script:
```
/Users/postmams/Documents/scripts/audit_storage/audit_storage ver2.sh
```
This already includes the two `push-to-mams.js` calls at the bottom that send
`IBM.csv`/`COMP.csv` into the app the moment they're written — no browser, no
click.

Scheduled in **`postmams`'s** crontab (not root's) on the Mac Studio:
```cron
0 0 28-31 * * [ "$(date -v+1d +\%d)" = "01" ] && "/Users/postmams/Documents/scripts/audit_storage/mams-automation/audit_storage ver2.sh" >> "/Users/postmams/Documents/scripts/audit_storage/mams-automation/logs/cron_log.txt" 2>&1
```
(macOS `date -v+1d` syntax — this is the "run only on the actual last day of
the month" trick; cron has no native concept of it, so this runs daily across
28–31 and only fires for real when tomorrow is the 1st.)

Check it ran: `mams-automation/logs/push.log` should show two
"Pushed N rows" lines after each run.

**Safety note:** if a run produces 0 rows (e.g. a volume was unmounted at
scan time), `push-to-mams.js` refuses to push and exits with an error, so a
bad run can't wipe out good data already in the app.

## Part 2 — VM: daily usage refresh via SSH

`fetch-usage.js` no longer talks to the old MSUM web API (that login kept
failing). It now SSHes directly into the Mac Studio and reads `df -k`:

```
ssh postmams@10.0.0.164 "df -k /Volumes/snibmprod /Volumes/snibmfs5kprod"
```

Requires **passwordless SSH key auth** from the VM to the Mac Studio:
- Key: `~/.ssh/mams_studio` (postmams's home on the VM), no passphrase
  (cron can't type one)
- `~/.ssh/config` on the VM has a `Host 10.0.0.164` entry pointing at that key
- Public key installed in the Mac Studio's `~/.ssh/authorized_keys` for
  `postmams`

Scheduled in **`postmams`'s** crontab on the VM (`vmmams-core`):
```cron
0 8 * * * cd /srv/mams-storage-audit/mams-automation/scripts && /usr/bin/node fetch-usage.js >> /tmp/fetch-usage.log 2>&1
```

Env vars (optional overrides, see top of `fetch-usage.js` for defaults):
`MAC_STUDIO_HOST`, `MAC_STUDIO_USER`, `IBM_MOUNT`, `COMP_MOUNT`,
`MAMS_API_URL`.

**Important:** use plain `crontab -e` (as `postmams`), never `sudo crontab -e`.
The latter edits **root's** crontab, and root has no access to postmams's SSH
key — the job will fail with `Permission denied (publickey,...)`. If
`crontab -e` says the user isn't allowed to use `crontab`, `postmams` needs
adding to `/etc/cron.allow` (`sudo`, then confirm the file is world-readable —
`chmod 644 /etc/cron.allow` — or cron can't even check who's allowed).

## Part 2b — VM: pull the scan CSVs from the Mac (backup for the Mac's push)

The Mac normally pushes `IBM.csv` / `COMP.csv` to STAR itself at the end of the
scan (Part 1). That push runs Node *on the Mac* and has been seen to fail
intermittently with `EHOSTUNREACH` while the VM -> Mac SSH path (Part 2) keeps
working. `scripts/pull-from-mac.js` closes the gap by going the other way: the
VM SSHes to the Mac, reads the CSVs and imports them through the same
`push-to-mams.js` code.

- Does nothing while the scan is still running on the Mac (so it never imports
  a half-written CSV).
- Only imports a CSV that is newer than the one it imported last time
  (remembered in `mams-automation/.pull-state.json`, gitignored). Safe to run
  hourly.
- Exit codes: `0` ok / nothing new, `1` error, `2` scan still running.
- Options: `--dry-run` (show what it would do), `--force` (re-import even if
  unchanged).
- Optional `.env` setting: `MAC_AUDIT_DATA_DIR` (default
  `/Users/postmams/Documents/scripts/audit_storage/data`). Host/user come from
  `MAC_STUDIO_HOST` / `MAC_STUDIO_USER`, same as Part 2.

Scheduled in **`postmams`'s** crontab on the VM:
```cron
10 * * * * cd /srv/mams-storage-audit/mams-automation && /usr/bin/node scripts/pull-from-mac.js >> logs/pull-from-mac.log 2>&1
```
Try it by hand first: `node scripts/pull-from-mac.js --dry-run`.

Note the month-end timing: the scan starts at midnight and takes ~5 hours, so
the pull imports it at the first hourly run after it finishes. The 10:00
monthly report is still held by the stale-data guard if the data is not in by
then.

## Part 3 — VM: monthly Excel + AI summary email

Lives at `/srv/mams-storage-audit/mams-automation` on the VM, next to
`docker-compose.yml`. `.env` there (gitignored) holds:
- `EMAIL_USER` / `EMAIL_PASS` — Gmail address + **Gmail App Password** (not
  the normal account password — see `.env.example`)
- `EMAIL_TO` — comma-separated recipients (`EMAIL_CC`/`EMAIL_BCC` optional)
- `MAMS_API_URL` / `MAMS_DATA_DIR` — leave as-is if following the standard
  folder layout
- `EMAIL_ALERT_TO` *(strongly recommended)* — the only address emailed when a
  report is held (see below). If unset, nothing is emailed and the hold is
  only written to `logs/monthly-report.log`. The report recipients are never
  contacted about a held report.
- `REPORT_MAX_DATA_AGE_HOURS` *(optional, default 24)* — how old the data may
  be before the report is held.

Scheduled in **`postmams`'s** crontab on the VM:
```cron
0 10 28-31 * * cd /srv/mams-storage-audit/mams-automation && [ "$(date -d tomorrow +\%d)" = "01" ] && /usr/bin/node scripts/monthly-report.js >> logs/monthly-report.log 2>&1
```
(GNU `date -d tomorrow` — different syntax than the Mac Studio job above,
because this runs on Linux, not macOS.)

### Test it manually anytime
```bash
cd /srv/mams-storage-audit/mams-automation
node scripts/monthly-report.js
```
Sends immediately if the data is fresh. Check your inbox; on success the
terminal prints `Email sent to: ...`. Mid-month the data is weeks old, so a
manual test run will be **held** by the stale-data guard (below) - add
`--force` to send it anyway.

### Stale-data guard
Before building anything, the script checks when each of its four inputs was
last written - the IBM and IBM FS5K folder scans (`IBMUpdated` / `COMPUpdated`
in `data/rows.json`) and the two web-usage figures (`ibmUpdated` /
`compUpdated` in `data/usage.json`). If any is older than
`REPORT_MAX_DATA_AGE_HOURS` (default 24), or has no timestamp at all, the
report is **held**:

- nothing is sent to the report recipients, and no files are written to
  `reports/` (so Report History never shows a report that wasn't sent)
- an alert email listing exactly which inputs are stale (and how old) goes to
  `EMAIL_ALERT_TO` only
- the script exits with code 2 (0 = sent, 1 = error), and the reason is in
  `logs/monthly-report.log`

Once the data is refreshed, just re-run `node scripts/monthly-report.js`. To
send despite stale data, run `node scripts/monthly-report.js --force` (a
command-line flag only, so the cron job can never do this by accident) - the email then opens with a "Data freshness warning"
section so recipients aren't misled.

Why this exists: on Sep 30 2026 the Mac's push of the month-end scan failed,
STAR kept the Sep 20 data, and the report was emailed using it with nothing to
flag that.

## Troubleshooting notes learned the hard way
- **`sudo crontab -e` vs `crontab -e`** — always use the latter for these
  jobs. Sudo edits root's crontab, a completely different, separate file from
  postmams's.
- **`/etc/cron.allow` permissions** — if it's `rw-------` (root-only), even a
  correctly-listed user gets rejected because `crontab` can't read the file
  to check. Needs to be at least world-readable.
- **SSH key must have no passphrase** — cron has no terminal to prompt on,
  so an interactively-tested key with a passphrase will work fine by hand and
  silently fail under cron.
- Confirm `which node` on each machine before trusting a hardcoded `node`
  path in a cron line — it differs between macOS (Homebrew) and the VM.
- **Check `/etc/cron.d/` too, not just `crontab -l`** — a job can end up
  scheduled in BOTH places at once (system-wide `/etc/cron.d/<name>` file
  AND a user's personal crontab) without either being obviously wrong on
  its own. This actually happened here: `/etc/cron.d/mams-monthly-report`
  (pre-existing, unrelated to the crontab line documented above) fired the
  exact same `monthly-report.js` job at the exact same 10am time, so the
  Aug 2026 report email sent twice. Diagnosed via `journalctl -u cron |
  grep monthly-report`, which showed two distinct CMD lines with slightly
  different argument order at the same timestamp — that's the signature
  of two independent schedulers hitting the same job, not a bug in the
  script itself. Fixed by `sudo rm /etc/cron.d/mams-monthly-report`,
  keeping the crontab entry above as the single source of truth. If a
  STAR email/job ever seems to double-fire again, check
  `sudo ls /etc/cron.d/` first.

Everything above — the scan, the push, the daily usage refresh, and the
monthly export/email — now runs unattended.
