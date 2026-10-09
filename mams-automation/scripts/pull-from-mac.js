#!/usr/bin/env node
// pull-from-mac.js
//
// Runs on the VM. Pulls the folder-scan CSVs (IBM.csv / COMP.csv) from the
// Mac Studio over SSH and imports them into STAR - the same effect as the
// Mac pushing them with push-to-mams.js, but with the connection going the
// other way. The VM -> Mac SSH path is the one fetch-usage.js already uses
// every morning, and it is reliable; the Mac -> VM HTTP path (Node on the Mac)
// intermittently fails with EHOSTUNREACH. Pulling sidesteps that entirely.
//
// Safe to run as often as you like (idempotent):
//   - It does nothing while the scan is still running on the Mac, so a
//     half-written CSV is never imported.
//   - It only imports a CSV whose modified time is newer than the one it
//     imported last time (remembered in .pull-state.json).
//   - It reuses push-to-mams.js for parsing/uploading, so the rules (skip
//     'total' lines, refuse to import 0 rows, retry on network blips) are
//     exactly the same as before.
//
// Usage:
//   node scripts/pull-from-mac.js            # import whatever is new
//   node scripts/pull-from-mac.js --dry-run  # show what it would do
//   node scripts/pull-from-mac.js --force    # import even if unchanged or old
//
// Exit codes: 0 = ok (imported something, or nothing new), 1 = error,
//             2 = scan still running on the Mac (skipped).
//
// Config (all optional, in mams-automation/.env):
//   MAC_STUDIO_HOST / MAC_STUDIO_USER   same as fetch-usage.js
//   MAC_AUDIT_DATA_DIR                  where the scan writes its CSVs
//   MAMS_API_URL                        default http://localhost:5179
//   PULL_MAX_CSV_AGE_HOURS              skip CSVs older than this (default 48)

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

const SSH_HOST = process.env.MAC_STUDIO_HOST || "10.0.0.164";
const SSH_USER = process.env.MAC_STUDIO_USER || "postmams";
const DATA_DIR = (process.env.MAC_AUDIT_DATA_DIR || "/Users/postmams/Documents/scripts/audit_storage/data").replace(/\/+$/, "");
const API_URL = (process.env.MAMS_API_URL || "http://localhost:5179").replace(/\/+$/, "");
// A CSV older than this is never imported automatically. Importing stamps the
// data with "now", so re-importing a weeks-old CSV would make STAR (and the
// monthly report's stale-data guard) think a fresh scan had just happened.
// Use --force to import an old CSV on purpose.
const MAX_CSV_AGE_HOURS = Number(process.env.PULL_MAX_CSV_AGE_HOURS) || 48;
const STATE_FILE = path.join(__dirname, "..", ".pull-state.json");
const PUSH_SCRIPT = path.join(__dirname, "push-to-mams.js");

const SIDES = [
  { side: "IBM", file: "IBM.csv" },
  { side: "COMP", file: "COMP.csv" }, // COMP = the FS5K volume (internal name)
];

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

function ssh(remoteCmd, opts = {}) {
  return execFileAsync(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", `${SSH_USER}@${SSH_HOST}`, remoteCmd],
    { maxBuffer: 256 * 1024 * 1024, ...opts }
  );
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch (e) { return {}; }
}
function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

async function scanRunning() {
  // The [a] trick stops pgrep matching its own command line.
  const { stdout } = await ssh(`pgrep -f '[a]udit_storage ver2' >/dev/null && echo RUNNING || echo IDLE`);
  return stdout.trim() === "RUNNING";
}

async function remoteMtime(file) {
  // macOS stat: %m = modified time in epoch seconds
  try {
    const { stdout } = await ssh(`stat -f %m '${DATA_DIR}/${file}'`);
    const n = Number(stdout.trim());
    return Number.isFinite(n) ? n : null;
  } catch (e) {
    return null; // file missing
  }
}

async function main() {
  try {
    if (await scanRunning()) {
      log("Scan is still running on the Mac - not importing a half-written CSV. Will try again next run.");
      return 2;
    }
  } catch (err) {
    throw new Error(`SSH to ${SSH_USER}@${SSH_HOST} failed: ${err.message}`);
  }

  const state = readState();
  let imported = 0;
  let failed = 0;

  for (const { side, file } of SIDES) {
    const mtime = await remoteMtime(file);
    if (mtime === null) {
      log(`${side}: ${DATA_DIR}/${file} not found on the Mac - skipping.`);
      failed++;
      continue;
    }
    const when = new Date(mtime * 1000).toISOString();
    if (!FORCE && state[side] && state[side].mtime >= mtime) {
      log(`${side}: nothing new (CSV from ${when}, already imported).`);
      continue;
    }
    const ageHours = (Date.now() / 1000 - mtime) / 3600;
    if (!FORCE && ageHours > MAX_CSV_AGE_HOURS) {
      log(`${side}: CSV on the Mac is from ${when} (${(ageHours / 24).toFixed(1)} days old) - not importing, it would look like a fresh scan. Use --force to import it anyway.`);
      continue;
    }
    if (DRY_RUN) {
      log(`${side}: would import ${file} from ${when}.`);
      continue;
    }

    const tmp = path.join(os.tmpdir(), `star-pull-${side}-${process.pid}.csv`);
    try {
      const { stdout } = await ssh(`cat '${DATA_DIR}/${file}'`);
      fs.writeFileSync(tmp, stdout);
      const { stdout: out } = await execFileAsync("node", [PUSH_SCRIPT, side, tmp], {
        env: { ...process.env, MAMS_API_URL: API_URL },
      });
      process.stdout.write(out);
      state[side] = { mtime, importedAt: new Date().toISOString() };
      writeState(state);
      log(`${side}: imported ${file} (CSV from ${when}).`);
      imported++;
    } catch (err) {
      failed++;
      console.error(`${side}: import failed: ${(err.stderr || err.message || "").toString().trim()}`);
    } finally {
      try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
    }
  }

  if (!imported && !failed && !DRY_RUN) log("Up to date.");
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(`[${new Date().toISOString()}] pull-from-mac.js failed: ${err.message}`);
  process.exit(1);
});
