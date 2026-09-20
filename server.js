const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = 5179;

app.use(cors());
app.use(express.json());
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
const REPORT_FILENAME_RE = /^star_monthly_report_\d{4}-\d{2}-\d{2}_\d{4}\.xls$/;

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
const DEFAULT_BRANDING = { appName: "STAR", accentColor: "#2f5da8", logoDataUrl: null };
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

// Bigger JSON body limit on just this route - a base64 logo data URL can
// easily exceed express.json()'s default 100kb limit used everywhere else.
app.put('/api/branding', express.json({ limit: '3mb' }), async (req, res) => {
  const { appName, accentColor, logoDataUrl } = req.body || {};
  if (typeof appName !== 'string' || !appName.trim() || appName.length > 60) {
    return res.status(400).json({ error: "App name must be 1-60 characters." });
  }
  if (typeof accentColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(accentColor)) {
    return res.status(400).json({ error: "Accent color must be a hex code like #2f5da8." });
  }
  if (logoDataUrl !== null && logoDataUrl !== undefined) {
    if (typeof logoDataUrl !== 'string' || !/^data:image\/(png|jpeg|jpg|svg\+xml|webp);base64,/.test(logoDataUrl)) {
      return res.status(400).json({ error: "Logo must be a PNG, JPEG, WebP, or SVG image." });
    }
    if (logoDataUrl.length > 2_800_000) {
      return res.status(400).json({ error: "Logo is too large - please use an image under ~2MB." });
    }
  }
  const branding = { appName: appName.trim(), accentColor, logoDataUrl: logoDataUrl || null };
  try {
    await fs.writeFile(BRANDING_FILE, JSON.stringify(branding, null, 2));
    res.json(branding);
  } catch (err) {
    res.status(500).json({ error: "Failed to save branding settings." });
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
    // Read existing data
    let fileData;
    try {
      const fileContent = await fs.readFile(ROWS_FILE, 'utf8');
      fileData = JSON.parse(fileContent);
    } catch (e) {
      fileData = { IBM: [], COMP: [] };
    }
    
    // Update the specified side
    fileData[side] = data;
    // Per-side timestamp, so the UI can show when EACH side last changed rather
    // than the whole file's mtime (which would make an IBM-only save also look
    // like it touched COMP's data, since both sides live in one file).
    fileData[`${side}Updated`] = new Date().toISOString();
    
    // Write back to file
    await fs.writeFile(ROWS_FILE, JSON.stringify(fileData, null, 2));
    console.log("✅ Successfully saved.", data.length, "rows for", side);
    res.json({ success: true, message: `Saved ${data.length} rows for ${side}.` });
  } catch (err) {
    console.error("❌ Error saving rows:", err);
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
      if (!REPORT_FILENAME_RE.test(filename)) continue; // strict whitelist - see below
      const m = filename.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})/);
      const stat = await fs.stat(path.join(REPORTS_DIR, filename));
      reports.push({
        filename,
        date: `${m[1]}-${m[2]}-${m[3]}`,
        time: `${m[4]}:${m[5]}`,
        sizeBytes: stat.size,
        generatedAt: stat.mtime.toISOString(),
      });
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
    res.json({ success: true });
  } catch (e) {
    res.status(404).json({ error: 'Report not found.' });
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

app.get('/api/v1', (req, res) => {
  res.json({
    name: 'STAR Storage API',
    version: 'v1',
    endpoints: {
      'GET /api/v1/usage': 'IBM/COMP usage summary (TB used, capacity, % full)',
      'GET /api/v1/rows': 'All storage rows for both IBM and COMP',
      'GET /api/v1/rows/:side': "Storage rows for one side - 'ibm' or 'comp'",
      'GET /api/v1/reports': 'List of past monthly Excel reports',
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
      if (!REPORT_FILENAME_RE.test(filename)) continue;
      const m = filename.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})/);
      const stat = await fs.stat(path.join(REPORTS_DIR, filename));
      reports.push({
        filename,
        date: `${m[1]}-${m[2]}-${m[3]}`,
        time: `${m[4]}:${m[5]}`,
        sizeBytes: stat.size,
        generatedAt: stat.mtime.toISOString(),
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
