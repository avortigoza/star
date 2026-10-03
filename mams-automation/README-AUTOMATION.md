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

## Part 3 — VM: monthly Excel + AI summary email

Lives at `/srv/mams-storage-audit/mams-automation` on the VM, next to
`docker-compose.yml`. `.env` there (gitignored) holds:
- `EMAIL_USER` / `EMAIL_PASS` — Gmail address + **Gmail App Password** (not
  the normal account password — see `.env.example`)
- `EMAIL_TO` — comma-separated recipients (`EMAIL_CC`/`EMAIL_BCC` optional)
- `MAMS_API_URL` / `MAMS_DATA_DIR` — leave as-is if following the standard
  folder layout

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
Sends immediately using whatever data is currently in the app. Check your
inbox; on success the terminal prints `Email sent to: ...`.

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


## Why the Mac pushes with curl, not Node

Twice now (once earlier, and again on the Sep 30 month-end run) Node.js on
the Mac Studio lost the ability to reach the VM - every request failed with
`connect EHOSTUNREACH 10.0.1.50:8104` - while `curl` and `nc` to the same
address kept working. A reboot cleared it each time, and the unattended 2 AM
cron run had no one to do that, so STAR silently kept stale data and the
monthly email went out using it.

`audit_storage ver2.sh` therefore uploads the raw CSVs with plain `curl` to
`POST /api/ingest/IBM|COMP` (see server.js), and the server does the parsing.
curl retries for ~5 minutes and logs a clear `Pushed ...` or `PUSH FAILED ...`
line to `logs/push.log`.

`scripts/push-to-mams.js` still works and is kept as a manual fallback, but
its parsing rules are duplicated in server.js (`parseAuditCsv`) - if you
change one, change the other.

Manual push from the Mac (no Node needed):

    curl --fail -H "Content-Type: text/csv" --data-binary @/Users/postmams/Documents/scripts/audit_storage/data/IBM.csv  http://10.0.1.50:8104/api/ingest/IBM
    curl --fail -H "Content-Type: text/csv" --data-binary @/Users/postmams/Documents/scripts/audit_storage/data/COMP.csv http://10.0.1.50:8104/api/ingest/COMP
