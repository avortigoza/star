// scripts/monthly-report.js
//
// Recreates what a human currently does by hand at month-end:
//   1. Click "AI Summary" in the browser
//   2. Click "Download Excel"
//   3. Email both files to whoever needs them
//
// This reads the SAME data the app reads (data/rows.json + data/usage.json),
// rebuilds the same HTML "Excel" workbook exportExcel() builds in the browser,
// asks the same Ollama model for a summary using the same prompt, and emails
// both as attachments via Gmail SMTP.
//
// Run manually to test:
//   node scripts/monthly-report.js
//
// Run for real via cron - see README-AUTOMATION.md.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

// ---------- Config ----------
// Resolve relative to THIS FILE, not the current working directory - otherwise
// running the script from anywhere but mams-automation/ silently reads the wrong
// folder and reports zero rows.
const DATA_DIR = path.resolve(__dirname, "..", process.env.MAMS_DATA_DIR || "data");
const API_URL = process.env.MAMS_API_URL || "http://localhost:5179";
const REPORTS_DIR = process.env.MAMS_REPORTS_DIR || path.join(__dirname, "..", "reports");
const CAP_IBM = 660;
const CAP_DELL = 440;

const parseAddrs = (v) => (v || "").split(",").map((s) => s.trim()).filter(Boolean);
const EMAIL_TO = parseAddrs(process.env.EMAIL_TO);
const EMAIL_CC = parseAddrs(process.env.EMAIL_CC);
const EMAIL_BCC = parseAddrs(process.env.EMAIL_BCC);
const EMAIL_USER = process.env.EMAIL_USER; // e.g. yourname@gmail.com
const EMAIL_PASS = process.env.EMAIL_PASS; // Gmail App Password (not your normal password)

// Stale-data guard (see checkDataFreshness below). If any input to the report
// is older than this when the script runs, the report is HELD and an alert is
// sent instead. Month-end normally runs ~4-5h after the Mac pushes its scan and
// ~2h after the daily usage refresh, so 24h leaves plenty of margin.
const MAX_DATA_AGE_HOURS = Number(process.env.REPORT_MAX_DATA_AGE_HOURS) || 24;
// The ONLY address emailed when a report is held. If unset, nothing is emailed
// at all (the hold is just logged) - report recipients are never contacted.
const EMAIL_ALERT_TO = parseAddrs(process.env.EMAIL_ALERT_TO);
// --force sends even if data is stale, with a warning in the email. Deliberately
// a command-line flag only (no env var): the cron job never passes it, and a
// stray line in .env can't quietly switch the guard off.
const FORCE = process.argv.includes("--force");

// ---------- Helpers (ported from src/App.tsx) ----------
const formatTB = (v) => (Math.round((v + Number.EPSILON) * 10000) / 10000).toFixed(4);

function getBuckets(side) {
  if (side === "IBM") {
    return [
      { label: "/Volumes/snibmprod", prefix: "/Volumes/snibmprod", exclude: ["/Volumes/snibmprod/media/", "/Volumes/snibmprod/prod_hr2"] },
      { label: "/Volumes/snibmprod/media", prefix: "/Volumes/snibmprod/media", exclude: ["/Volumes/snibmprod/media/hr/"], skipExact: true },
      { label: "/Volumes/snibmprod/media/hr", prefix: "/Volumes/snibmprod/media/hr", skipExact: true },
      { label: "/Volumes/snibmprod/prod_hr2", prefix: "/Volumes/snibmprod/prod_hr2" },
    ];
  }
  return [
    { label: "/Volumes/snibmfs5kprod", prefix: "/Volumes/snibmfs5kprod", exclude: ["/Volumes/snibmfs5kprod/media/", "/Volumes/snibmfs5kprod/prod_hr2"] },
    { label: "/Volumes/snibmfs5kprod/media", prefix: "/Volumes/snibmfs5kprod/media", exclude: ["/Volumes/snibmfs5kprod/media/hr/"], skipExact: true },
    { label: "/Volumes/snibmfs5kprod/media/hr", prefix: "/Volumes/snibmfs5kprod/media/hr", skipExact: true },
    { label: "/Volumes/snibmfs5kprod/prod_hr2", prefix: "/Volumes/snibmfs5kprod/prod_hr2" },
  ];
}

function pickBucketRows(rows, bucket) {
  const start = bucket.prefix;
  const excludes = bucket.exclude || [];
  return (rows || []).filter((r) => {
    const loc = r.location || "";
    if (!loc.startsWith(start)) return false;
    if (bucket.skipExact && loc === start) return false;
    for (const ex of excludes) if (loc.startsWith(ex)) return false;
    return true;
  });
}

function buildWorkbookHtml({ ibmRows, dellRows, usageIbm, usageDell, sortPrefs }) {
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const pctTxt = (v) => (Number.isFinite(v) ? (v * 100).toFixed(1) + "%" : "—%");

  const makeBucketTable = (label, rows, storageKey) => {
    const sortDesc = (sortPrefs && sortPrefs[storageKey]) || false;
    const sortedRows = sortDesc ? [...rows].sort((a, b) => (Number(b.size_tb) || 0) - (Number(a.size_tb) || 0)) : rows;
    const body = sortedRows.length === 0
      ? `</td><td class="nodata" colspan="3">No Data Available.</td></tr>`
      : sortedRows.map((r, i) => `<tr class="${i % 2 ? "row-alt" : "row"}"><td class="cell-left nowrap">${esc(r.location)}</td><td class="cell-center">${esc(r.content ?? "")}</td><td class="cell-center">${esc(formatTB(Number(r.size_tb) || 0))}</td></tr>`).join("");
    const total = sortedRows.reduce((a, r) => a + (Number(r.size_tb) || 0), 0);
    return `<table class="card"><thead><tr><th class="bucket-hdr" colspan="3">${esc(label)}</th></tr><tr class="head"><th class="th-center">LOCATION</th><th class="th-center">CONTENT</th><th class="th-center">SIZE (TB)</th></tr></thead><tbody>${body}</tbody><tfoot><tr class="total"><td class="th-left">TOTAL:</td><td></td><td class="th-center">${esc(formatTB(total))}</td></tr></tfoot></table>`;
  };

  const ibmBuckets = getBuckets("IBM");
  const dellBuckets = getBuckets("Dell");

  const buildSide = (title, viaWebUsage, cap, buckets, rows) => {
    const viaWeb = `<table class="webcard"><tr><td class="webtitle nowrap"><b>${esc(title)} (Via Web)</b></td><td class="webusage-label nowrap" align="center"><b>USAGE (TB):</b></td><td class="webusage-value nowrap" align="center">${esc(viaWebUsage || 0)}</td><td class="webusage-pct nowrap" align="center">${esc(pctTxt(cap ? viaWebUsage / cap : 0))}</td></tr></table>`;
    const tables = buckets.map((b) => makeBucketTable(b.label, pickBucketRows(rows, b), `sar-sort:${title}:${b.label}`)).join(`<div class="gap"></div>`);
    return `<div class="column">${viaWeb}<div class="gap"></div>${tables}</div>`;
  };

  const left = buildSide("Post Prod HR Storage IBM", usageIbm, CAP_IBM, ibmBuckets, ibmRows);
  const right = buildSide("Post Prod HR Storage IBM FS5K", usageDell, CAP_DELL, dellBuckets, dellRows);

  const css = `body { font-family: Arial, sans-serif; font-size: 12px; } .page { width: 100%; } .column { vertical-align: top; width: 50%; } .gap { height: 10px; } .webcard { border-collapse: collapse; width: 100%; background: #2f5da8; color: #fff; } .webcard td { padding: 6px 8px; } .webtitle { font-weight: 700; font-size: 12px; } .webusage-label { font-weight: 700; font-size: 12px; text-align: center; } .webusage-value { background: #ffffff; color: #1f4294; text-align: center; padding: 2px 6px; font-weight: 600; } .webusage-pct { font-weight: 700; font-size: 12px; text-align: center; } .card { border-collapse: collapse; width: 100%; border: 1px solid #c7d2e9; border-radius: 12px; } .bucket-hdr { background: #2f5da8; color: #fff; font-weight: 700; text-align: left; padding: 6px 8px; } .head th { background: #e8f0fe; color: #1f4294; font-weight: 700; } th, td { border: 1px solid #e1e8f8; padding: 6px 8px; } .row { background: #ffffff; } .row-alt { background: #f6f9ff; } .total td { background: #e8f0fe; color: #1f4294; font-weight: 700; } .nowrap { white-space: nowrap; } .th-center, .cell-center { text-align: center; } .nodata { text-align: center; font-style: italic; color: #6b7280; }`;

  return `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8" /><style>${css}</style><title>STAR - Storage Tracking &amp; Audit Reporting</title></head><body><table class="page"><tr><td colspan="2"><div style="font-weight:700; font-size:16px; color:#1f4294;">STAR - Storage Tracking &amp; Audit Reporting</div></td></tr><tr><td class="column">${left}</td><td class="column">${right}</td></tr></table></body></html>`;
}

// The CSV comes from several `du -sk <path>/*` passes at different depths, so
// summing EVERY row double-counts: /Volumes/snibmprod/media already contains
// /media/hr, which contains /media/hr/hr1/2026, etc. Only the direct children
// of the volume root are mutually exclusive, so only those add up to real
// occupied space. (Summing all rows gave 1,052 TB on a 660 TB volume.)
function rootChildren(rows, root) {
  return (rows || []).filter((r) => {
    const loc = String(r.location || "").replace(/\/+$/, "");
    if (!loc.startsWith(root + "/")) return false;
    const rest = loc.slice(root.length + 1);
    return rest.length > 0 && !rest.includes("/");
  });
}
function rootTotal(rows, root) {
  return rootChildren(rows, root).reduce((sum, r) => sum + (Number(r.size_tb) || 0), 0);
}

// Key Takeaways are generated in code, not by the model. The model was
// producing plausible-sounding but wrong arithmetic here (e.g. claiming
// occupied space "exceeded" web-reported usage when it was lower), and this
// report is emailed to people who take the figures at face value.
function buildTakeaways(usageIbm, usageDell, ibmTotal, dellTotal, ibmRows, dellRows) {
  const tb2 = (v) => (Math.round((v + Number.EPSILON) * 100) / 100).toFixed(2);
  const topOf = (rows, root) =>
    [...rootChildren(rows, root)].sort((a, b) => (Number(b.size_tb) || 0) - (Number(a.size_tb) || 0))[0];

  const pI = (usageIbm / CAP_IBM) * 100;
  const pD = (usageDell / CAP_DELL) * 100;
  const freeIbm = Math.max(0, CAP_IBM - usageIbm);
  const freeDell = Math.max(0, CAP_DELL - usageDell);
  const lines = [];

  lines.push(`- IBM is at ${pI.toFixed(1)}% of capacity, using ${usageIbm} TB of its ${CAP_IBM} TB with ${freeIbm.toFixed(0)} TB still free.`);

  // Comparison direction is computed, never assumed.
  const cmp = pD > pI ? `slightly higher at ${pD.toFixed(1)}%` : pD < pI ? `slightly lower at ${pD.toFixed(1)}%` : `at the same ${pD.toFixed(1)}%`;
  lines.push(`- IBM FS5K is ${cmp}, using ${usageDell} TB of its ${CAP_DELL} TB with ${freeDell.toFixed(0)} TB free. The two have ${(freeIbm + freeDell).toFixed(0)} TB of free space combined.`);

  const gI = usageIbm > 0 ? ((usageIbm - ibmTotal) / usageIbm) * 100 : 0;
  const gD = usageDell > 0 ? ((usageDell - dellTotal) / usageDell) * 100 : 0;
  const sameGap = Math.abs(gI - gD) < 1.5;
  lines.push(`- The folder scan found ${tb2(ibmTotal)} TB on IBM and ${tb2(dellTotal)} TB on IBM FS5K. Both come out about ${((gI + gD) / 2).toFixed(0)}% lower than what the storage systems report${sameGap ? ", and the difference is the same on both, so nothing looks off" : ", and the difference is not the same on both this time"}.`);

  const ti = topOf(ibmRows, "/Volumes/snibmprod");
  const td = topOf(dellRows, "/Volumes/snibmfs5kprod");
  if (ti && td) {
    const shI = ibmTotal > 0 ? (Number(ti.size_tb) / ibmTotal) * 100 : 0;
    const shD = dellTotal > 0 ? (Number(td.size_tb) / dellTotal) * 100 : 0;
    lines.push(`- Most of the data is in a single folder on each system. ${ti.location} holds ${tb2(Number(ti.size_tb) || 0)} TB, which is ${shI.toFixed(0)}% of IBM's measured total, and ${td.location} holds ${tb2(Number(td.size_tb) || 0)} TB, or ${shD.toFixed(0)}% of IBM FS5K's.`);
  }

  return `\n\n**Key Takeaways**\n\n${lines.join("\n")}`;
}

// ---- Shared report renderer ----
// Built for Outlook on Windows (Word engine): no flexbox, no grid, no
// border-radius, no max-width, and unreliable percentage widths - so this is
// fixed-pixel tables + inline styles + bgcolor attributes throughout.
const ACCENT = "#2f5da8", ACCENT2 = "#4f46e5";
const W = 780, COL = 380, BAR = 344;

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inlineBold(s) {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}
const FONT = "font-family:Arial,Helvetica,sans-serif;mso-line-height-rule:exactly;";
// Browsers drop background colors when printing unless told otherwise; without
// this the bars come out blank in a saved PDF.
const KEEPBG = "-webkit-print-color-adjust:exact;print-color-adjust:exact;";

function bar(pct, color, width) {
  const w = width || BAR;
  const fill = Math.max(0, Math.min(w, Math.round((pct / 100) * w)));
  const rest = w - fill;
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="${w}" style="border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;${KEEPBG}"><tr>` +
    (fill > 0 ? `<td width="${fill}" height="10" bgcolor="${color}" style="width:${fill}px;height:10px;font-size:0;line-height:0;background-color:${color};${KEEPBG}">&nbsp;</td>` : "") +
    (rest > 0 ? `<td width="${rest}" height="10" bgcolor="#e5e7eb" style="width:${rest}px;height:10px;font-size:0;line-height:0;background-color:#e5e7eb;${KEEPBG}">&nbsp;</td>` : "") +
    `</tr></table>`;
}

function gaugeCell(label, used, total, color) {
  const pct = total > 0 ? (used / total) * 100 : 0;
  return `<td width="${COL}" valign="top" style="width:${COL}px;padding:0 5px;">
    <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="${COL - 10}" style="width:${COL - 10}px;border:1px solid #d7e0f2;border-collapse:collapse;page-break-inside:avoid;">
      <tr><td style="padding:14px;${FONT}">
        <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="${BAR}" style="width:${BAR}px;"><tr>
          <td style="${FONT}font-size:13px;line-height:16px;font-weight:bold;color:#5b6472;">${esc(String(label).toUpperCase())}</td>
          <td align="right" style="${FONT}font-size:13px;line-height:16px;color:#5b6472;white-space:nowrap;">${esc(used)} / ${esc(total)} TB</td>
        </tr></table>
        <p style="margin:8px 0 6px;${FONT}font-size:32px;line-height:34px;font-weight:bold;color:#111827;">${pct.toFixed(1)}<span style="font-size:15px;font-weight:normal;color:#5b6472;"> % used</span></p>
        ${bar(pct, color)}
        <p style="margin:7px 0 0;${FONT}font-size:13px;line-height:16px;color:#5b6472;">${Math.max(0, total - used).toFixed(0)} TB free</p>
      </td></tr>
    </table>
  </td>`;
}

function topPathsCell(title, rows, color, tb2) {
  const top = [...(rows || [])].sort((a, b) => (Number(b.size_tb) || 0) - (Number(a.size_tb) || 0)).slice(0, 5);
  const max = top.length ? Number(top[0].size_tb) || 0 : 0;
  const body = top.length === 0
    ? `<p style="margin:0;${FONT}font-size:14px;color:#9ca3af;font-style:italic;">No data available.</p>`
    : top.map((r) => {
        const v = Number(r.size_tb) || 0;
        const w = max > 0 ? (v / max) * 100 : 0;
        return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="${BAR}" style="width:${BAR}px;margin-bottom:11px;page-break-inside:avoid;">
          <tr>
            <td style="${FONT}font-size:13px;line-height:17px;color:#374151;">${esc(r.location)}</td>
            <td align="right" style="${FONT}font-size:13px;line-height:17px;font-weight:bold;color:#111827;white-space:nowrap;padding-left:10px;">${tb2(v)} TB</td>
          </tr>
          <tr><td colspan="2" style="padding-top:4px;">${bar(w, color)}</td></tr>
        </table>`;
      }).join("");
  return `<td width="${COL}" valign="top" style="width:${COL}px;padding:0 5px;">
    <p style="margin:0 0 10px;${FONT}font-size:13px;line-height:16px;font-weight:bold;color:#5b6472;">${esc(String(title).toUpperCase())}</p>
    ${body}
  </td>`;
}

function summaryTextToHtml(text) {
  let inGroup = false;
  const out = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^\*\*(.+?)\*\*:?$/);
    if (h) {
      inGroup = false;
      out.push(`<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="page-break-after:avoid;"><tr><td style="${FONT}font-size:17px;line-height:22px;font-weight:bold;color:#111827;border-bottom:1px solid #e5e7eb;padding:18px 0 7px;">${esc(h[1].replace(/:$/, ""))}</td></tr></table>`);
      continue;
    }
    const b = line.match(/^([-*+\u2022])\s+(.*)$/);
    if (b) {
      const content = b[2].trim();
      const bare = content.replace(/\*\*/g, "");
      if (/^[^:]{1,40}:$/.test(bare)) {
        inGroup = true;
        out.push(`<p style="margin:12px 0 4px;${FONT}font-size:15px;line-height:20px;font-weight:bold;color:#111827;page-break-after:avoid;">${esc(bare.replace(/:$/, ""))}</p>`);
        continue;
      }
      const nested = inGroup || b[1] === "+";
      out.push(`<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="margin:3px 0;page-break-inside:avoid;"><tr>
        <td width="${nested ? 34 : 16}" valign="top" style="width:${nested ? 34 : 16}px;padding-left:${nested ? 20 : 2}px;${FONT}font-size:15px;line-height:22px;color:${ACCENT};">${nested ? "&rsaquo;" : "&bull;"}</td>
        <td valign="top" style="${FONT}font-size:15px;line-height:22px;color:#374151;">${inlineBold(content)}</td>
      </tr></table>`);
      continue;
    }
    out.push(`<p style="margin:4px 0;${FONT}font-size:15px;line-height:22px;color:#374151;">${inlineBold(line)}</p>`);
  }
  return out.join("\n");
}

function buildReportHtml(o) {
  const tb2 = (v) => (Math.round((v + Number.EPSILON) * 100) / 100).toFixed(2);
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>STAR Monthly Report${o.monthLabel ? " - " + esc(o.monthLabel) : ""}</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
<style type="text/css">
  table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
  body, table, td, p { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  @page { size: A4 portrait; margin: 12mm; }
  @media print {
    html, body { background:#ffffff !important; }
    * { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
    .sheet { width:100% !important; }
    .outer { padding:0 !important; background:#ffffff !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;${KEEPBG}">
<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="background-color:#f3f4f6;${KEEPBG}"><tr><td class="outer" align="center" style="padding:18px 8px;">
<!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="${W}"><tr><td><![endif]-->
<table class="sheet" cellpadding="0" cellspacing="0" border="0" role="presentation" width="${W}" style="width:${W}px;background-color:#ffffff;${KEEPBG}">
  <tr><td bgcolor="${ACCENT}" style="padding:16px 24px;${FONT}color:#ffffff;font-size:19px;line-height:24px;font-weight:bold;background-color:${ACCENT};${KEEPBG}">
    STAR Monthly Report${o.monthLabel ? ` &mdash; <span style="font-weight:normal;">${esc(o.monthLabel)}</span>` : ""}
  </td></tr>
  <tr><td style="padding:18px 15px 6px;">
    <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="${W - 30}" style="width:${W - 30}px;"><tr>
      ${gaugeCell("Post Prod HR Storage IBM", o.ibmUsage, 660, ACCENT)}
      ${gaugeCell("Post Prod HR Storage IBM FS5K", o.dellUsage, 440, ACCENT2)}
    </tr></table>
  </td></tr>
  <tr><td style="padding:14px 15px 0;">
    <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="${W - 30}" style="width:${W - 30}px;"><tr>
      ${topPathsCell("IBM - Top 5 Paths", o.ibmRows, ACCENT, tb2)}
      ${topPathsCell("IBM FS5K - Top 5 Paths", o.dellRows, ACCENT2, tb2)}
    </tr></table>
  </td></tr>
  <tr><td style="padding:8px 24px 26px;">
    <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="${W - 48}" style="width:${W - 48}px;border-top:1px solid #e5e7eb;"><tr><td style="padding-top:6px;">
      ${summaryTextToHtml(o.summaryText)}
    </td></tr></table>
  </td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
}

function buildAiPrompt({ ibmRows, dellRows, usageIbm, usageDell }) {
  const ibmTopLevel = rootChildren(ibmRows, "/Volumes/snibmprod");
  const dellTopLevel = rootChildren(dellRows, "/Volumes/snibmfs5kprod");
  const ibmTotal = rootTotal(ibmRows, "/Volumes/snibmprod");
  const dellTotal = rootTotal(dellRows, "/Volumes/snibmfs5kprod");

  return `Summarize the storage data from these tables in a clear, concise way:

IBM STORAGE DATA (Capacity: ${CAP_IBM} TB):
- Web-reported usage: ${usageIbm} TB (${((usageIbm / CAP_IBM) * 100).toFixed(1)}% of capacity)
- From script scan: ${formatTB(ibmTotal)} TB actually occupied, across ${ibmTopLevel.length} top-level folders (${ibmRows.length} rows scanned in total, including nested subfolders)

IBM FS5K STORAGE DATA (Capacity: ${CAP_DELL} TB):
- Web-reported usage: ${usageDell} TB (${((usageDell / CAP_DELL) * 100).toFixed(1)}% of capacity)
- From script scan: ${formatTB(dellTotal)} TB actually occupied, across ${dellTopLevel.length} top-level folders (${dellRows.length} rows scanned in total, including nested subfolders)

TOP STORAGE CONSUMERS FROM TABLES:

IBM Top Paths:
${[...ibmRows].sort((a, b) => (b.size_tb || 0) - (a.size_tb || 0)).slice(0, 10).map((r, i) => `${i + 1}. ${r.location}: ${formatTB(r.size_tb || 0)} TB${r.content ? ` (${r.content})` : ""}`).join("\n")}

IBM FS5K Top Paths:
${[...dellRows].sort((a, b) => (b.size_tb || 0) - (a.size_tb || 0)).slice(0, 10).map((r, i) => `${i + 1}. ${r.location}: ${formatTB(r.size_tb || 0)} TB${r.content ? ` (${r.content})` : ""}`).join("\n")}

INSTRUCTIONS:
Output EXACTLY these two sections, in this order, and nothing else. Both are required.

**Storage Data Summary**

- IBM Storage:
- Total capacity: <value> TB
- Web-reported usage: <value> TB (<value>% of capacity)
- Actual occupied space: <value> TB
- IBM FS5K Storage:
- Total capacity: <value> TB
- Web-reported usage: <value> TB (<value>% of capacity)
- Actual occupied space: <value> TB

**Top Consuming Paths**

- IBM Storage:
- <top 5 paths, each with its size in TB>
- IBM FS5K Storage:
- <top 5 paths, each with its size in TB>

RULES:
- Start directly with "**Storage Data Summary**". No preamble, no "Here is..." opening line, no closing remarks.
- Do NOT write a "Key Takeaways" section - it is added separately.
- Use ONLY the numbers given above. Do not calculate any new totals or percentages.
- The paths listed above are NESTED inside one another (/media contains /media/hr, which contains /media/hr/hr1/2026). NEVER add them together. The only correct occupied-space figures are the ones already given.
- No recommendations, no analysis of discrepancies, no potential issues, no commentary on differences between web-reported and scanned figures.
- No tables. Plain bullet lines only.
- Keep every line short.`;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    return fallback;
  }
}

function timestampParts() {
  const now = new Date();
  return {
    yyyy: now.getFullYear(),
    mm: String(now.getMonth() + 1).padStart(2, "0"),
    dd: String(now.getDate()).padStart(2, "0"),
    hh: String(now.getHours()).padStart(2, "0"),
    min: String(now.getMinutes()).padStart(2, "0"),
  };
}

// ---- Stale-data guard ----
// On Sep 30 2026 the Mac's push of the month-end scan failed (the Mac could not
// reach the VM), STAR kept the Sep 20 data, and this script happily emailed
// that as the month-end report. rows.json / usage.json already record when each
// side was last written, so check those before building anything.
function checkDataFreshness({ rows, usage, now = new Date(), maxAgeHours = MAX_DATA_AGE_HOURS }) {
  const inputs = [
    { label: "IBM folder scan", ts: rows && rows.IBMUpdated },
    { label: "IBM FS5K folder scan", ts: rows && rows.COMPUpdated },
    { label: "IBM web usage", ts: usage && usage.ibmUpdated },
    { label: "IBM FS5K web usage", ts: usage && usage.compUpdated },
  ];
  return inputs.map(({ label, ts }) => {
    const t = ts ? Date.parse(ts) : NaN;
    if (!Number.isFinite(t)) {
      // No timestamp means freshness can't be proven, so don't treat it as fresh.
      return { label, updatedAt: null, ageHours: null, fresh: false };
    }
    const ageHours = (now.getTime() - t) / 36e5;
    return { label, updatedAt: new Date(t).toISOString(), ageHours, fresh: ageHours <= maxAgeHours };
  });
}

function describeAge(c) {
  if (c.updatedAt == null) return `${c.label}: no update time recorded`;
  const age = c.ageHours >= 48 ? `${(c.ageHours / 24).toFixed(1)} days ago` : `${c.ageHours.toFixed(1)} hours ago`;
  return `${c.label}: last updated ${c.updatedAt} (${age})`;
}

function makeTransporter() {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,      // upgrade via STARTTLS
    requireTLS: true,
    family: 4,          // force IPv4 - this VM's IPv6 route to Google is broken
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });
}

async function sendHeldAlert({ stale, monthLabel }) {
  if (EMAIL_ALERT_TO.length === 0) {
    console.error("EMAIL_ALERT_TO is not set in .env - NO alert email sent. The report is held; set EMAIL_ALERT_TO so you are told when this happens.");
    return;
  }
  const to = EMAIL_ALERT_TO;
  const text = [
    `The STAR monthly report for ${monthLabel} was NOT sent.`,
    ``,
    `It was held because data it is built from is out of date (limit: ${MAX_DATA_AGE_HOURS} hours at the time it ran):`,
    ...stale.map((c) => `  - ${describeAge(c)}`),
    ``,
    `What to check:`,
    `  - Folder scan: on the Mac Studio, audit_storage ver2.sh pushes it - see logs/push.log and logs/cron_log.txt (README-AUTOMATION.md, Part 1).`,
    `  - Web usage: the daily fetch-usage.js job on the VM (README-AUTOMATION.md, Part 2).`,
    ``,
    `Once the data is refreshed, re-run it on the VM:`,
    `  cd /srv/mams-storage-audit/mams-automation && node scripts/monthly-report.js`,
    `Or send it anyway, with a warning at the top of the email:`,
    `  node scripts/monthly-report.js --force`,
  ].join("\n");
  await makeTransporter().sendMail({
    from: `"STAR Notifications" <${EMAIL_USER}>`,
    to: to.join(", "),
    subject: `STAR Monthly Report HELD - storage data is out of date (${monthLabel})`,
    text,
  });
  console.log(`Held-report alert sent to: ${to.join(", ")}`);
}

async function main({ force = FORCE, now = new Date() } = {}) {
  if (!EMAIL_USER || !EMAIL_PASS) {
    throw new Error("EMAIL_USER / EMAIL_PASS are not set. Copy .env.example to .env and fill them in.");
  }
  if (EMAIL_TO.length === 0) {
    throw new Error("EMAIL_TO is not set. Add at least one recipient in .env.");
  }

  console.log(`[${new Date().toISOString()}] Starting monthly report...`);

  const rows = readJson(path.join(DATA_DIR, "rows.json"), { IBM: [], COMP: [] });
  const usage = readJson(path.join(DATA_DIR, "usage.json"), { ibm: 0, comp: 0 });
  const sortPrefs = readJson(path.join(DATA_DIR, "sort-prefs.json"), {});

  const ibmRows = rows.IBM || [];
  const dellRows = rows.COMP || [];
  const usageIbm = Number(usage.ibm) || 0;
  const usageDell = Number(usage.comp) || 0;

  if (ibmRows.length === 0 && dellRows.length === 0) {
    console.warn("WARNING: both IBM and COMP have zero rows. Did the CSV import run this month? Continuing anyway.");
  }

  // ---- 0. Stale-data guard: runs BEFORE any file is written, so a held run
  // leaves nothing behind in reports/ (which feeds the app's Report History). ----
  const monthLabel = now.toLocaleString("en-US", { month: "long", year: "numeric" });
  const stale = checkDataFreshness({ rows, usage, now }).filter((c) => !c.fresh);
  let freshnessNotice = "";
  if (stale.length > 0) {
    console.error(`Data is out of date (limit ${MAX_DATA_AGE_HOURS}h):`);
    stale.forEach((c) => console.error(`  - ${describeAge(c)}`));
    if (!force) {
      console.error("Report HELD - not sending. Re-run with --force to send anyway.");
      await sendHeldAlert({ stale, monthLabel });
      return 2;
    }
    console.warn("--force given: sending with a data-freshness warning.");
    freshnessNotice = `**Data freshness warning**\n\n${stale.map((c) => `- ${describeAge(c)}`).join("\n")}\n\nFigures below may not reflect current storage.\n\n`;
  }

  // ---- 1. Build the Excel-compatible workbook (same trick the browser uses) ----
  const html = buildWorkbookHtml({ ibmRows, dellRows, usageIbm, usageDell, sortPrefs });
  const t = timestampParts();
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const xlsName = `star_monthly_report_${t.yyyy}-${t.mm}-${t.dd}_${t.hh}${t.min}.xls`;
  const xlsPath = path.join(REPORTS_DIR, xlsName);
  fs.writeFileSync(xlsPath, html, "utf8");
  console.log(`Wrote ${xlsPath}`);

  // ---- 2. Ask the same Ollama model for the same summary the "AI Summary" button asks for ----
  const prompt = buildAiPrompt({ ibmRows, dellRows, usageIbm, usageDell });
  let summary;
  try {
    const res = await fetch(`${API_URL}/api/ai/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) throw new Error(`AI endpoint returned ${res.status}`);
    const json = await res.json();
    summary = (json.response || "(empty response from AI)").trim();
  } catch (e) {
    console.error("AI summary generation failed, sending the report without it:", e.message);
    summary = `(AI summary unavailable this run: ${e.message})`;
  }
  summary = freshnessNotice + summary;
  summary += buildTakeaways(usageIbm, usageDell, rootTotal(ibmRows, "/Volumes/snibmprod"), rootTotal(dellRows, "/Volumes/snibmfs5kprod"), ibmRows, dellRows);
  // The formatted summary goes in the EMAIL BODY (below), not as an attachment -
  // HTML attachments are commonly blocked by corporate mail filters. A local copy
  // is still written to REPORTS_DIR for reference/archiving.
  const reportHtml = buildReportHtml({
    ibmUsage: usageIbm,
    dellUsage: usageDell,
    ibmRows,
    dellRows,
    summaryText: summary,
    monthLabel,
  });
  const summaryName = `star_monthly_report_${t.yyyy}-${t.mm}-${t.dd}_${t.hh}${t.min}.html`;
  const summaryPath = path.join(REPORTS_DIR, summaryName);
  fs.writeFileSync(summaryPath, reportHtml, "utf8");
  console.log(`Wrote ${summaryPath}`);

  // ---- 3. Email: formatted summary in the body, Excel attached ----
  const transporter = makeTransporter();

  await transporter.sendMail({
    from: `"STAR Notifications" <${EMAIL_USER}>`,
    to: EMAIL_TO.join(", "),
    // cc/bcc are only included when set, so an empty value in .env is harmless
    ...(EMAIL_CC.length ? { cc: EMAIL_CC.join(", ") } : {}),
    ...(EMAIL_BCC.length ? { bcc: EMAIL_BCC.join(", ") } : {}),
    subject: `STAR Monthly Report - ${monthLabel}`,
    // Plain-text alternative for clients that will not render HTML. The ** markers
    // are stripped so it reads cleanly rather than showing raw markdown.
    text: `STAR - Storage Tracking & Audit Reporting - ${monthLabel}\n\nThe Excel export is attached.\n\n${summary.replace(/\*\*/g, "")}`,
    html: reportHtml,
    attachments: [
      { filename: xlsName, path: xlsPath },
    ],
  });

  console.log(`Email sent to: ${EMAIL_TO.join(", ")}`);
  if (EMAIL_CC.length) console.log(`            cc: ${EMAIL_CC.join(", ")}`);
  if (EMAIL_BCC.length) console.log(`           bcc: ${EMAIL_BCC.join(", ")}`);
  console.log(`[${new Date().toISOString()}] Done.`);
  return 0;
}

// Exit codes: 0 = sent, 1 = error, 2 = held because data was stale.
if (require.main === module) {
  main()
    .then((code) => process.exit(code || 0))
    .catch((err) => {
      console.error("Monthly report FAILED:", err);
      process.exit(1);
    });
}

module.exports = { main, checkDataFreshness };
