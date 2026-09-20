#!/usr/bin/env node
// push-to-mams.js
//
// Zero-dependency (uses only Node's built-in fs/http/https - nothing to
// npm install). Parses one of audit_storage_ver2.sh's output CSVs
// (bytes,location per line) and pushes it to the MAMS Storage Audit app's
// /api/rows endpoint - the exact same effect as clicking "Import IBM CSV"
// / "Import COMP CSV" in the browser.
//
// Usage:
//   node push-to-mams.js IBM  /Users/postmams/Documents/scripts/audit_storage/data/IBM.csv
//   node push-to-mams.js COMP /Users/postmams/Documents/scripts/audit_storage/data/COMP.csv
//
// Config:
//   Set MAMS_API_URL to override the default below, e.g.:
//     export MAMS_API_URL=http://10.0.1.50:8104

const fs = require("fs");
const http = require("http");
const https = require("https");

const API_URL = process.env.MAMS_API_URL || "http://10.0.1.50:8104";
const BYTES_PER_GB = 1024 ** 3;

// ---- ported from the app's parsing rules (src/App.tsx) ----
function toNumber(val) {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (val == null) return 0;
  let s = String(val).trim().replace(/\u00A0/g, "");
  if (s === "") return 0;
  if (s.includes(",") && !s.includes(".")) s = s.replace(/,/g, ".");
  s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function deriveContent(side, loc) {
  const L = String(loc || "").toLowerCase();
  if (side === "IBM") {
    const ibmPrefixes = [
      "/volumes/snibmprod/prod_hr2",
      "/volumes/snibmprod/media/hr",
      "/volumes/snibmprod/media",
      "/volumes/snibmprod/to_carbon",
      "/volumes/snibmprod/from_carbon",
    ];
    return ibmPrefixes.some((p) => L.startsWith(p)) ? "System Files" : "";
  }
  const dellPrefixes = [
    "/volumes/snibmfs5kprod/lost+found",
    "/volumes/snibmfs5kprod/epr",
    "/volumes/snibmfs5kprod/library",
    "/volumes/snibmfs5kprod/snibmprod",
    "/volumes/snibmfs5kprod/media/hr",
    "/volumes/snibmfs5kprod/media",
    "/volumes/snibmfs5kprod/prod_hr2",
  ];
  return dellPrefixes.some((p) => L.startsWith(p)) ? "System Files" : "";
}

// audit_storage_ver2.sh's `du -sk ... | awk '{print $1","$2}'` output is
// always plain "number,path" per line, no quoting - so a simple split on
// the first comma is enough (and safer than a full CSV parser for paths
// that might themselves contain a comma).
function parseCsv(text, side) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const idx = line.indexOf(",");
    if (idx === -1) continue;
    const rawBytes = line.slice(0, idx);
    const loc = line.slice(idx + 1).trim();
    if (/^total:?$/i.test(loc) || /^total:?$/i.test(rawBytes)) break;
    const bytes = toNumber(rawBytes);
    if (!Number.isFinite(bytes) || !loc || loc.toLowerCase() === "location") continue;
    out.push({ location: loc, size_tb: bytes / BYTES_PER_GB, content: deriveContent(side, loc) });
  }
  return out;
}

function putJson(urlStr, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === "https:" ? https : http;
    const data = JSON.stringify(body);
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname,
        method: "PUT",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
        timeout: 15000,
      },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(chunks);
          else reject(new Error(`HTTP ${res.statusCode}: ${chunks}`));
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.write(data);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wraps putJson with a few retries on network-level failures (a momentary
// EHOSTUNREACH/ETIMEDOUT/ECONNREFUSED blip, seen in practice on this Mac's
// path to the VM, shouldn't require manually re-running the whole audit).
// Does NOT retry on a real HTTP error response (4xx/5xx) - those are
// application-level failures a retry won't fix.
async function putJsonWithRetry(urlStr, body, attempts = 3, delayMs = 3000) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await putJson(urlStr, body);
    } catch (err) {
      lastErr = err;
      const isNetworkError = /^HTTP \d/.test(err.message) === false;
      if (!isNetworkError || i === attempts) throw err;
      console.error(`Attempt ${i}/${attempts} failed (${err.message}), retrying in ${delayMs / 1000}s...`);
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

async function main() {
  const [, , side, filePath] = process.argv;
  if (!side || !filePath || !["IBM", "COMP"].includes(side)) {
    console.error("Usage: node push-to-mams.js <IBM|COMP> <path-to-csv>");
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const text = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(text, side);

  if (rows.length === 0) {
    console.error(`Parsed 0 rows from ${filePath} - NOT pushing (leaving the app's existing data untouched so a bad/empty run can't wipe good data).`);
    process.exit(1);
  }

  await putJsonWithRetry(`${API_URL}/api/rows`, { side, data: rows });
  console.log(`[${new Date().toISOString()}] Pushed ${rows.length} rows for ${side} from ${filePath}`);
}

main().catch((err) => {
  console.error("push-to-mams.js failed:", err.message);
  process.exit(1);
});
