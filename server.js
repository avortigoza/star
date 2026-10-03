const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const swaggerUi = require('swagger-ui-express');
const openApiSpec = require('./openapi');

const app = express();
const PORT = 5179;

app.use(cors());
// Default 100kb is too small for /api/branding's base64 image uploads (see
// that route below) - raised globally since this is the middleware that
// actually applies first; a route-specific override would never take
// effect, since body-parser only parses the request body once. Up to three
// images (logo, app-name image, tagline image) can be present in a single
// branding save, each capped at ~2.8MB base64 - 10mb gives headroom above
// that worst case (~8.4MB) plus the rest of the JSON payload.
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ROWS_FILE = path.join(DATA_DIR, 'rows.json');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');
const SORT_PREFS_FILE = path.join(DATA_DIR, 'sort-prefs.json');
const BRANDING_FILE = path.join(DATA_DIR, 'branding.json');
// Where monthly-report.js (mams-automation/scripts/monthly-report.js) saves
// each month's Excel export + HTML summary. Read-only from here - this
// server never writes into it, only lists/serves what that script produced.
const REPORTS_DIR = path.join(__dirname, 'mams-automation', 'reports');
// Automated (monthly cron) reports use "monthly"; a manually-downloaded
// report saved via POST /api/reports/manual below uses "manual" - the
// prefix is the only thing that distinguishes them, so every other report
// endpoint (history, preview, download, delete, /api/v1/reports) accepts
// both through this one shared pattern.
const REPORT_FILENAME_RE = /^star_(monthly|manual)_report_\d{4}-\d{2}-\d{2}_\d{4}\.xls$/;
const REPORT_SOURCE = { monthly: 'automated', manual: 'manual' };

const fsSync = require('fs');
if (!fsSync.existsSync(DATA_DIR)) {
  fsSync.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize users.json if it doesn't exist
if (!fsSync.existsSync(USERS_FILE)) {
  fsSync.writeFileSync(USERS_FILE, JSON.stringify({
    users: [{ username: "postmams", password: "gma7mams", role: "admin", created_at: new Date().toISOString() }]
  }, null, 2));
}

// Default branding matches the app's original built-in look, so nothing
// visually changes until an admin explicitly customizes it via Settings.
const DEFAULT_BRANDING = {
  appName: "STAR",
  accentColor: "#2f5da8",
  tagline: "Storage Tracking & Audit Reporting",
  logoDataUrl: null,
  logoIncludesText: false,
  // Optional alternatives to the plain-text appName/tagline fields above,
  // for brand assets that are themselves designed images (a custom
  // wordmark/logotype, a styled tagline graphic) rather than plain text -
  // each is independent and only overrides its own text field when set,
  // same precedence pattern as logoDataUrl + logoIncludesText already use.
  appNameImageDataUrl: null,
  taglineImageDataUrl: null,
};
if (!fsSync.existsSync(BRANDING_FILE)) {
  fsSync.writeFileSync(BRANDING_FILE, JSON.stringify(DEFAULT_BRANDING, null, 2));
}

// ============ BRANDING API ENDPOINTS ============
app.get('/api/branding', async (req, res) => {
  try {
    const data = JSON.parse(await fs.readFile(BRANDING_FILE, 'utf8'));
    res.json({ ...DEFAULT_BRANDING, ...data });
  } catch (err) {
    res.json(DEFAULT_BRANDING);
  }
});

// Shared validation for every optional image field on /api/branding (logo,
// app-name image, tagline image) - same format whitelist and size cap for
// all three, just with a field-specific label in the error message.
function validateOptionalImage(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^data:image\/(png|jpeg|jpg|svg\+xml|webp);base64,/.test(value)) {
    return `${label} must be a PNG, JPEG, WebP, or SVG image.`;
  }
  if (value.length > 2_800_000) {
    return `${label} is too large - please use an image under ~2MB.`;
  }
  return null;
}

app.put('/api/branding', async (req, res) => {
  const { appName, accentColor, tagline, logoDataUrl, logoIncludesText, appNameImageDataUrl, taglineImageDataUrl } = req.body || {};
  if (typeof appName !== 'string' || !appName.trim() || appName.length > 60) {
    return res.status(400).json({ error: "App name must be 1-60 characters." });
  }
  if (typeof accentColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(accentColor)) {
    return res.status(400).json({ error: "Accent color must be a hex code like #2f5da8." });
  }
  // Tagline is optional (admins may want none at all), unlike app name.
  if (tagline !== undefined && (typeof tagline !== 'string' || tagline.length > 100)) {
    return res.status(400).json({ error: "Tagline must be 100 characters or fewer." });
  }
  for (const [value, label] of [
    [logoDataUrl, "Logo"],
    [appNameImageDataUrl, "App name image"],
    [taglineImageDataUrl, "Tagline image"],
  ]) {
    const err = validateOptionalImage(value, label);
    if (err) return res.status(400).json({ error: err });
  }
  const branding = {
    appName: appName.trim(),
    accentColor,
    tagline: typeof tagline === 'string' ? tagline.trim() : '',
    logoDataUrl: logoDataUrl || null,
    logoIncludesText: logoIncludesText === true,
    appNameImageDataUrl: appNameImageDataUrl || null,
    taglineImageDataUrl: taglineImageDataUrl || null,
  };
  try {
    await fs.writeFile(BRANDING_FILE, JSON.stringify(branding, null, 2));
    res.json(branding);
  } catch (err) {
    res.status(500).json({ error: "Failed to save branding settings." });
  }
});

app.post('/api/branding/reset', async (req, res) => {
  try {
    await fs.writeFile(BRANDING_FILE, JSON.stringify(DEFAULT_BRANDING, null, 2));
    res.json(DEFAULT_BRANDING);
  } catch (err) {
    res.status(500).json({ error: "Failed to reset branding settings." });
  }
});

// ============ USER API ENDPOINTS ============
app.get('/api/users', async (req, res) => {
  try {
    const data = JSON.parse(await fs.readFile(USERS_FILE, 'utf8'));
    const users = data.users.map(({ password, ...user }) => user);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Failed to load users." });
  }
});

app.post('/api/users', async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required." });
  }
  try {
    const data = JSON.parse(await fs.readFile(USERS_FILE, 'utf8'));
    if (data.users.find(u => u.username === username)) {
      return res.status(400).json({ error: "User already exists." });
    }
    data.users.push({ username, password, role: role || "user", created_at: new Date().toISOString() });
    await fs.writeFile(USERS_FILE, JSON.stringify(data, null, 2));
    res.json({ message: `User ${username} created.` });
  } catch (err) {
    res.status(500).json({ error: "Failed to create user." });
  }
});

app.put('/api/users/password', async (req, res) => {
  const { username, newPassword } = req.body;
  if (!username || !newPassword) {
    return res.status(400).json({ error: "Missing fields." });
  }
  try {
    const data = JSON.parse(await fs.readFile(USERS_FILE, 'utf8'));
    const userIndex = data.users.findIndex(u => u.username === username);
    if (userIndex === -1) {
      return res.status(404).json({ error: "User not found." });
    }
    data.users[userIndex].password = newPassword;
    await fs.writeFile(USERS_FILE, JSON.stringify(data, null, 2));
    res.json({ message: `Password updated for ${username}.` });
  } catch (err) {
    res.status(500).json({ error: "Failed to update password." });
  }
});

app.delete('/api/users/:username', async (req, res) => {
  const { username } = req.params;
  if (username === "postmams") {
    return res.status(403).json({ error: "Cannot delete main admin." });
  }
  try {
    const data = JSON.parse(await fs.readFile(USERS_FILE, 'utf8'));
    data.users = data.users.filter(u => u.username !== username);
    await fs.writeFile(USERS_FILE, JSON.stringify(data, null, 2));
    res.json({ message: `User ${username} deleted.` });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete user." });
  }
});

app.post('/api/users/check', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required." });
  }
  try {
    if (username === "postmams" && password === "gma7mams") {
      return res.json({ valid: true, role: "admin", username: "postmams" });
    }
    const data = JSON.parse(await fs.readFile(USERS_FILE, 'utf8'));
    const user = data.users.find(u => u.username === username);
    if (!user) {
      return res.status(401).json({ valid: false, error: "User not found." });
    }
    if (user.password !== password) {
      return res.status(401).json({ valid: false, error: "Invalid password." });
    }
    res.json({ valid: true, role: user.role, username: user.username });
  } catch (err) {
    res.status(500).json({ error: "Login check failed." });
  }
});

// ============ ROWS API ============
app.get('/api/rows', async (req, res) => {
  const { side } = req.query;
  if (!side || (side !== "IBM" && side !== "COMP")) {
    return res.status(400).json({ error: "Invalid side parameter." });
  }
  try {
    const data = JSON.parse(await fs.readFile(ROWS_FILE, 'utf8'));
    res.json(side === "IBM" ? (data.IBM || []) : (data.COMP || []));
  } catch (err) {
    console.error("Error reading rows:", err);
    res.json([]);
  }
});

// Shared by PUT /api/rows (browser import / JSON push) and POST
// /api/ingest/:side (raw-CSV push) so both write exactly the same way.
async function saveRows(side, data) {
  let fileData;
  try {
    fileData = JSON.parse(await fs.readFile(ROWS_FILE, 'utf8'));
  } catch (e) {
    fileData = { IBM: [], COMP: [] };
  }
  fileData[side] = data;
  // Per-side timestamp, so the UI can show when EACH side last changed rather
  // than the whole file's mtime (which would make an IBM-only save also look
  // like it touched COMP's data, since both sides live in one file).
  fileData[`${side}Updated`] = new Date().toISOString();
  await fs.writeFile(ROWS_FILE, JSON.stringify(fileData, null, 2));
}

app.put('/api/rows', async (req, res) => {
  const { side, data } = req.body;
  console.log("Saving rows for side:", side);
  console.log("Data length:", data?.length);

  if (!side || (side !== "IBM" && side !== "COMP")) {
    return res.status(400).json({ error: "Invalid side parameter. Use 'IBM' or 'COMP'." });
  }
  if (!Array.isArray(data)) {
    return res.status(400).json({ error: "Data must be an array." });
  }

  try {
    await saveRows(side, data);
    console.log("✅ Successfully saved.", data.length, "rows for", side);
    res.json({ success: true, message: `Saved ${data.length} rows for ${side}.` });
  } catch (err) {
    console.error("❌ Error saving rows:", err);
    res.status(500).json({ error: "Failed to save rows.", details: err.message });
  }
});

// ---- Raw-CSV ingest ----
// Lets the Mac Studio push audit_storage's CSV output with plain `curl`
// instead of Node. Twice now (once earlier, once on the Sep 30 month-end
// run) Node on that Mac lost the ability to reach the VM (EHOSTUNREACH)
// while curl kept working, so parsing happens here, server-side, and the
// Mac only needs to upload the file. Parsing rules are a port of
// mams-automation/scripts/push-to-mams.js - keep the two in sync.
const BYTES_PER_GB = 1024 ** 3;

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

function parseAuditCsv(text, side) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
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

app.post('/api/ingest/:side', express.text({ type: () => true, limit: '20mb' }), async (req, res) => {
  const side = String(req.params.side || "").toUpperCase();
  if (side !== "IBM" && side !== "COMP") {
    return res.status(400).json({ error: "Invalid side. Use IBM or COMP." });
  }
  const rows = parseAuditCsv(typeof req.body === "string" ? req.body : "", side);
  // Same safety as push-to-mams.js: a bad/empty upload must never wipe good data.
  if (rows.length === 0) {
    return res.status(400).json({ error: "Parsed 0 rows - NOT saving, existing data left untouched." });
  }
  try {
    await saveRows(side, rows);
    console.log("✅ Ingested", rows.length, "rows for", side, "(raw CSV)");
    res.json({ success: true, message: `Saved ${rows.length} rows for ${side}.` });
  } catch (err) {
    console.error("❌ Error ingesting rows:", err);
    res.status(500).json({ error: "Failed to save rows.", details: err.message });
  }
});

// ============ USAGE API ============
app.get('/api/usage', async (req, res) => {
  try {
    const data = JSON.parse(await fs.readFile(USAGE_FILE, 'utf8'));
    res.json({ ibm: data.ibm || 0, comp: data.comp || 0 });
  } catch (err) {
    res.json({ ibm: 0, comp: 0 });
  }
});

app.put('/api/usage', async (req, res) => {
  const { ibm, comp } = req.body;
  console.log("Saving usage - received:", { ibm, comp });
  
  try {
    // Read existing data first
    let currentData = { ibm: 0, comp: 0 };
    try {
      const fileContent = await fs.readFile(USAGE_FILE, 'utf8');
      currentData = JSON.parse(fileContent);
      console.log("Current usage:", currentData);
    } catch (err) {
      console.log("No existing file, creating new.");
    }
    
    // Update only the provided values (preserve others). Timestamp only the
    // side that was actually sent, so an IBM-only save does not make COMP's
    // "last updated" look changed too - see the same fix on /api/rows above.
    const now = new Date().toISOString();
    if (ibm !== undefined) { currentData.ibm = Number(ibm) || 0; currentData.ibmUpdated = now; }
    if (comp !== undefined) { currentData.comp = Number(comp) || 0; currentData.compUpdated = now; }
    
    console.log("Saving usage - updated:", currentData);
    
    // Write back to file
    await fs.writeFile(USAGE_FILE, JSON.stringify(currentData, null, 2));
    res.json({ success: true, message: "Usage saved.", data: currentData });
  } catch (err) {
    console.error("Error saving usage:", err);
    res.status(500).json({ error: "Failed to save usage." });
  }
});

// ============ SORT PREFS API ============
app.get('/api/sort-prefs', async (req, res) => {
  try {
    const data = JSON.parse(await fs.readFile(SORT_PREFS_FILE, 'utf8'));
    res.json(data);
  } catch (err) {
    res.json({});
  }
});

app.put('/api/sort-prefs', async (req, res) => {
  const { bucketKey, sortDesc } = req.body;
  try {
    let data = {};
    try { data = JSON.parse(await fs.readFile(SORT_PREFS_FILE, 'utf8')); } catch(e) {}
    data[bucketKey] = sortDesc;
    await fs.writeFile(SORT_PREFS_FILE, JSON.stringify(data, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to save sort pref." });
  }
});

// ============ CLEAR ALL ============
app.post('/api/clear-all', async (req, res) => {
  try {
    await fs.writeFile(ROWS_FILE, JSON.stringify({ IBM: [], COMP: [] }, null, 2));
    await fs.writeFile(USAGE_FILE, JSON.stringify({ ibm: 0, comp: 0 }, null, 2));
    await fs.writeFile(SORT_PREFS_FILE, JSON.stringify({}, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to clear data." });
  }
});

// ============ AI SUMMARY ============
app.post('/api/ai/generate', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Missing prompt." });
  try {
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    const response = await fetch("http://10.0.0.164:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-oss:20b", prompt: prompt, stream: false }),
      timeout: 30000
    });
    const json = await response.json();
    res.json({ response: json.response });
  } catch (err) {
    res.status(500).json({ error: "AI request failed." });
  }
});

// ============ HEALTH ============
// ============ META API ============
// Last-modified times of the data files, so the UI can show when each source
// last refreshed. rows.json is written by the nightly scan push; usage.json by
// the daily usage fetch. Returns null for a file that does not exist yet.
app.get('/api/meta', async (req, res) => {
  const readJson = async (f) => {
    try {
      return JSON.parse(await fs.readFile(f, 'utf8'));
    } catch (e) {
      return {};
    }
  };
  try {
    const rows = await readJson(ROWS_FILE);
    const usage = await readJson(USAGE_FILE);
    res.json({
      ibmRowsUpdated: rows.IBMUpdated || null,
      compRowsUpdated: rows.COMPUpdated || null,
      ibmUsageUpdated: usage.ibmUpdated || null,
      compUsageUpdated: usage.compUpdated || null,
    });
  } catch (err) {
    res.status(500).json({ error: "Could not read data timestamps." });
  }
});

// ============ REPORT HISTORY API ============
// Lists past monthly Excel exports so they can be browsed/downloaded from
// Settings, instead of only ever existing as a one-time email attachment.
app.get('/api/reports/history', async (req, res) => {
  try {
    let files;
    try {
      files = await fs.readdir(REPORTS_DIR);
    } catch (e) {
      return res.json([]); // no reports/ folder yet (e.g. before the first month-end run)
    }
    const reports = [];
    for (const filename of files) {
      const fm = filename.match(REPORT_FILENAME_RE);
      if (!fm) continue; // strict whitelist - see below
      const m = filename.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})/);
      const stat = await fs.stat(path.join(REPORTS_DIR, filename));
      const entry = {
        filename,
        date: `${m[1]}-${m[2]}-${m[3]}`,
        time: `${m[4]}:${m[5]}`,
        sizeBytes: stat.size,
        generatedAt: stat.mtime.toISOString(),
        source: REPORT_SOURCE[fm[1]],
      };
      if (entry.source === 'manual') {
        // Best-effort: a missing/unreadable sidecar just means "by" is omitted,
        // never a reason to drop the report entry itself.
        try {
          const meta = JSON.parse(await fs.readFile(path.join(REPORTS_DIR, `${filename}.meta.json`), 'utf8'));
          if (typeof meta.by === 'string' && meta.by) entry.by = meta.by;
        } catch (e) { /* no sidecar - fine */ }
      }
      reports.push(entry);
    }
    reports.sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1)); // newest first
    res.json(reports);
  } catch (err) {
    console.error('Error listing report history:', err);
    res.status(500).json({ error: 'Could not list report history.' });
  }
});

// Serves the same report file INLINE as HTML for in-app preview, rather than
// as a download. The "Excel" exports are actually HTML tables with an .xls
// extension (the same trick exportExcel() uses in the browser), so the content
// can be rendered directly without any parsing. Same strict whitelist as the
// download endpoint - this is still a filesystem read driven by a query param.
app.get('/api/reports/preview', async (req, res) => {
  const { file } = req.query;
  if (typeof file !== 'string' || !REPORT_FILENAME_RE.test(file)) {
    return res.status(400).send('Invalid report filename.');
  }
  const fullPath = path.join(REPORTS_DIR, file);
  if (path.resolve(fullPath) !== path.resolve(REPORTS_DIR, file) || !fullPath.startsWith(path.resolve(REPORTS_DIR))) {
    return res.status(400).send('Invalid report path.');
  }
  try {
    const content = await fs.readFile(fullPath, 'utf8');
    // A browser can never render this HTML table pixel-identical to opening
    // the same file in Excel - Excel auto-fits column widths and uses tight
    // native row heights, while a browser strictly honors the file's own CSS
    // padding/font-size, which makes headers like "SIZE (TB)" wrap onto two
    // lines and every cell look taller. This override ONLY tightens spacing
    // and stops that wrapping, to get visually closer to Excel's compact
    // look - it does NOT touch border, color, or layout rules AT ALL, so the
    // grid lines and structure stay exactly as the file defines them.
    const previewCss = `
<style>
  html, body { padding: 14px; }
  th, td { padding: 3px 8px !important; line-height: 1.3 !important; white-space: nowrap !important; }
</style>`;
    const withPreviewCss = content.includes('</head>')
      ? content.replace('</head>', `${previewCss}</head>`)
      : previewCss + content;
    res.set('Content-Type', 'text/html; charset=utf-8');
    // Explicitly inline (not attachment) so the browser renders it in the
    // preview frame instead of triggering a download.
    res.set('Content-Disposition', 'inline');
    res.send(withPreviewCss);
  } catch (e) {
    res.status(404).send('Report not found.');
  }
});

app.get('/api/reports/download', async (req, res) => {
  const { file } = req.query;
  // Strict whitelist BEFORE touching the filesystem - this is a download
  // endpoint driven by a query param, so it must never be possible to walk
  // outside REPORTS_DIR (e.g. "../../server.js") via a crafted filename.
  if (typeof file !== 'string' || !REPORT_FILENAME_RE.test(file)) {
    return res.status(400).json({ error: 'Invalid report filename.' });
  }
  const fullPath = path.join(REPORTS_DIR, file);
  // Defense in depth: confirm the resolved path is still actually inside
  // REPORTS_DIR even after the regex check above.
  if (path.resolve(fullPath) !== path.resolve(REPORTS_DIR, file) || !fullPath.startsWith(path.resolve(REPORTS_DIR))) {
    return res.status(400).json({ error: 'Invalid report path.' });
  }
  try {
    await fs.access(fullPath);
  } catch (e) {
    return res.status(404).json({ error: 'Report not found.' });
  }
  res.download(fullPath, file, (err) => {
    if (err) console.error('Error sending report file:', err);
  });
});

app.delete('/api/reports/delete', async (req, res) => {
  const { file } = req.query;
  // Same strict whitelist as preview/download - this deletes a file on disk
  // driven entirely by a query param, so it must never be tricked into
  // touching anything outside REPORTS_DIR.
  if (typeof file !== 'string' || !REPORT_FILENAME_RE.test(file)) {
    return res.status(400).json({ error: 'Invalid report filename.' });
  }
  const fullPath = path.join(REPORTS_DIR, file);
  if (path.resolve(fullPath) !== path.resolve(REPORTS_DIR, file) || !fullPath.startsWith(path.resolve(REPORTS_DIR))) {
    return res.status(400).json({ error: 'Invalid report path.' });
  }
  try {
    await fs.unlink(fullPath);
    // Also remove the matching .html summary if it exists, so a deleted
    // report doesn't leave an orphaned file behind. Its absence is not an
    // error - not every .xls necessarily has one.
    const htmlPath = fullPath.replace(/\.xls$/, '.html');
    await fs.unlink(htmlPath).catch(() => {});
    // A manual report's optional "by" sidecar - same best-effort cleanup.
    await fs.unlink(`${fullPath}.meta.json`).catch(() => {});
    res.json({ success: true });
  } catch (e) {
    res.status(404).json({ error: 'Report not found.' });
  }
});

// Saves a copy of a manually-downloaded report (the "Download Excel" button
// in the browser) into the same reports/ folder the automated monthly job
// uses, so it shows up in Report History too - distinguished from an
// automated report by the "manual" filename prefix (see REPORT_FILENAME_RE)
// rather than a separate table/flag, keeping one single source of truth for
// "what reports exist" (a directory listing) instead of a DB that could
// drift out of sync with the actual files.
app.post('/api/reports/manual', async (req, res) => {
  const { html, by } = req.body || {};
  if (typeof html !== 'string' || !html.trim()) {
    return res.status(400).json({ error: 'No report content provided.' });
  }
  // Not a hard security boundary (this endpoint just writes a new file,
  // it can't be pointed outside REPORTS_DIR), just a sanity cap - matches
  // the global 3mb JSON body limit already in place, well beyond any
  // realistic HTML table export.
  if (html.length > 3_000_000) {
    return res.status(400).json({ error: 'Report content is too large.' });
  }
  const now = new Date();
  const yyyy = now.getFullYear(), mm = String(now.getMonth() + 1).padStart(2, '0'), dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0'), min = String(now.getMinutes()).padStart(2, '0');
  const filename = `star_manual_report_${yyyy}-${mm}-${dd}_${hh}${min}.xls`;
  try {
    await fs.mkdir(REPORTS_DIR, { recursive: true });
    await fs.writeFile(path.join(REPORTS_DIR, filename), html, 'utf8');
    if (typeof by === 'string' && by.trim()) {
      // Best-effort - a failed sidecar write shouldn't fail the save itself,
      // it just means this entry shows up without a "by" name later.
      await fs.writeFile(path.join(REPORTS_DIR, `${filename}.meta.json`), JSON.stringify({ by: by.trim().slice(0, 60) }), 'utf8').catch(() => {});
    }
    res.json({ success: true, filename });
  } catch (err) {
    console.error('Error saving manual report:', err);
    res.status(500).json({ error: 'Could not save report.' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ PUBLIC API v1 (read-only, for other apps) ============
// Separate from the /api/* routes above, which are the internal API the
// React frontend uses and can change shape/add write endpoints freely.
// Everything under /api/v1 is GET-only and considered a stable contract -
// other apps can build against it without tracking internal app changes.
const CAP_IBM = 660;
const CAP_DELL = 440;

// Interactive Swagger UI + raw OpenAPI spec for the /api/v1 contract above -
// mounted before the /api/v1 routes themselves purely for readability
// (registration order doesn't matter here, these paths don't overlap).
app.use('/api/v1/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
app.get('/api/v1/openapi.json', (req, res) => res.json(openApiSpec));

app.get('/api/v1', (req, res) => {
  res.json({
    name: 'STAR Storage API',
    version: 'v1',
    documentation: '/api/v1/docs',
    endpoints: {
      'GET /api/v1/usage': 'IBM/COMP usage summary (TB used, capacity, % full)',
      'GET /api/v1/rows': 'All storage rows for both IBM and COMP',
      'GET /api/v1/rows/:side': "Storage rows for one side - 'ibm' or 'comp'",
      'GET /api/v1/reports': 'List of past Excel reports (automated monthly + manual downloads)',
      'GET /api/v1/reports/:filename/download': 'Download one report file by name',
    },
  });
});

app.get('/api/v1/usage', async (req, res) => {
  const readJson = async (f, fallback) => {
    try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch (e) { return fallback; }
  };
  try {
    const usage = await readJson(USAGE_FILE, {});
    const ibmUsed = Number(usage.ibm) || 0;
    const compUsed = Number(usage.comp) || 0;
    res.json({
      ibm: {
        usedTB: ibmUsed,
        capacityTB: CAP_IBM,
        percentFull: CAP_IBM ? Math.round((ibmUsed / CAP_IBM) * 1000) / 10 : 0,
        updatedAt: usage.ibmUpdated || null,
      },
      comp: {
        usedTB: compUsed,
        capacityTB: CAP_DELL,
        percentFull: CAP_DELL ? Math.round((compUsed / CAP_DELL) * 1000) / 10 : 0,
        updatedAt: usage.compUpdated || null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not read usage data.' });
  }
});

app.get('/api/v1/rows/:side', async (req, res) => {
  const side = String(req.params.side || '').toUpperCase();
  if (side !== 'IBM' && side !== 'COMP') {
    return res.status(400).json({ error: "side must be 'ibm' or 'comp'." });
  }
  try {
    const data = JSON.parse(await fs.readFile(ROWS_FILE, 'utf8'));
    res.json({ side, rows: data[side] || [], updatedAt: data[`${side}Updated`] || null });
  } catch (err) {
    res.json({ side, rows: [], updatedAt: null });
  }
});

app.get('/api/v1/rows', async (req, res) => {
  try {
    const data = JSON.parse(await fs.readFile(ROWS_FILE, 'utf8'));
    res.json({
      ibm: { rows: data.IBM || [], updatedAt: data.IBMUpdated || null },
      comp: { rows: data.COMP || [], updatedAt: data.COMPUpdated || null },
    });
  } catch (err) {
    res.json({ ibm: { rows: [], updatedAt: null }, comp: { rows: [], updatedAt: null } });
  }
});

// Reuses the same strict filename whitelist as the internal reports API -
// this is still a filesystem read, just under a different route.
app.get('/api/v1/reports', async (req, res) => {
  try {
    let files;
    try {
      files = await fs.readdir(REPORTS_DIR);
    } catch (e) {
      return res.json([]);
    }
    const reports = [];
    for (const filename of files) {
      const fm = filename.match(REPORT_FILENAME_RE);
      if (!fm) continue;
      const m = filename.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})/);
      const stat = await fs.stat(path.join(REPORTS_DIR, filename));
      reports.push({
        filename,
        date: `${m[1]}-${m[2]}-${m[3]}`,
        time: `${m[4]}:${m[5]}`,
        sizeBytes: stat.size,
        generatedAt: stat.mtime.toISOString(),
        source: REPORT_SOURCE[fm[1]],
        downloadUrl: `/api/v1/reports/${encodeURIComponent(filename)}/download`,
      });
    }
    reports.sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1));
    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: 'Could not list report history.' });
  }
});

app.get('/api/v1/reports/:filename/download', async (req, res) => {
  const { filename } = req.params;
  if (typeof filename !== 'string' || !REPORT_FILENAME_RE.test(filename)) {
    return res.status(400).json({ error: 'Invalid report filename.' });
  }
  const fullPath = path.join(REPORTS_DIR, filename);
  if (path.resolve(fullPath) !== path.resolve(REPORTS_DIR, filename) || !fullPath.startsWith(path.resolve(REPORTS_DIR))) {
    return res.status(400).json({ error: 'Invalid report path.' });
  }
  try {
    await fs.access(fullPath);
  } catch (e) {
    return res.status(404).json({ error: 'Report not found.' });
  }
  res.download(fullPath, filename, (err) => {
    if (err) console.error('Error sending report file:', err);
  });
});

// ============ CATCH-ALL ============
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  }
});

// ============ ERROR HANDLER ============
// Must be registered last (after every route) - Express only routes errors
// to handlers defined below the point where they occurred. Currently only
// meaningfully hit by /api/branding's oversized-logo case (body-parser
// rejects an over-limit request body before any route handler runs), but
// kept generic so any future payload-size limit gets the same clean
// JSON error instead of Express's default HTML error page.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(400).json({ error: "Request body too large." });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}.`);
});
