import React, { useEffect, useMemo, useRef, useState } from "react";
import { Download, Moon, Sun, Laptop, Trash2, Upload, LogOut, Sparkles, Settings, Eye, EyeOff, Star, MoreVertical, Check, Database, Mail, BarChart3, ArrowRight, Folder, FileText, Cpu, Cloud, Shield, Palette, Contrast, ChevronRight } from "lucide-react";
import Papa from "papaparse";
import * as XLSX from "xlsx";

// =============================
// Types & Globals
// =============================
declare global {
  interface Window {
    themeManager: {
      setLight: () => void;
      setDark: () => void;
      setSystem: () => void;
      getCurrent: () => string;
    };
  }
}

type Bucket = { label: string; prefix: string; exclude?: string[]; skipExact?: boolean };

// =============================
// Login Component
// =============================
function Login({ onLogin, branding }: { onLogin: (username: string, role: string) => void; branding: { appName: string; accentColor: string; tagline: string; logoDataUrl: string | null; logoIncludesText: boolean; appNameImageDataUrl: string | null; taglineImageDataUrl: string | null } }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // "Restore to Default" resets every custom image field to null - only
  // once any of them is actually set does the deliberately-larger sizing
  // apply. The plain default STAR wordmark/tagline (no custom images at
  // all) keeps its original, already-correct proportions.
  const isCustomBranding = !!(branding.logoDataUrl || branding.appNameImageDataUrl || branding.taglineImageDataUrl);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (username === "postmams" && password === "gma7mams") {
        onLogin(username, "admin");
        return;
      }

      const response = await fetch('/api/users/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();
      
      if (response.ok && data.valid) {
        onLogin(username, data.role || "user");
      } else {
        setError(data.error || "Invalid credentials.");
      }
    } catch (err) {
      console.error("Login error:", err);
      setError("Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-950">
      <form onSubmit={submit} className="w-96 rounded-2xl bg-white dark:bg-gray-900 p-8 shadow-lg flex flex-col gap-4">
        <div className="text-center mb-2">
          {branding.logoDataUrl ? (
            <img
              src={branding.logoDataUrl}
              alt={branding.appName}
              className={branding.logoIncludesText ? "mx-auto mb-1 max-h-40 w-full object-contain" : "mx-auto mb-3 h-20 object-contain"}
            />
          ) : (
            <Star size={52} className="mx-auto mb-3" style={{ color: branding.accentColor }} fill="currentColor" strokeLinejoin="round" />
          )}
          {/* Only the name is skipped when the logo already includes it - the
              tagline is independent and always shows when set, regardless of
              logoIncludesText (matches the header's same behavior). Each of
              name and tagline can independently be a designed image instead
              of plain text - the image takes over whenever it's set. */}
          {!branding.logoIncludesText && (
            branding.appNameImageDataUrl ? (
              <img src={branding.appNameImageDataUrl} alt={branding.appName} className="mx-auto h-10 object-contain" />
            ) : (
              <h2 className="text-4xl font-bold tracking-wide" style={{ color: branding.accentColor }}>{branding.appName}</h2>
            )
          )}
          {branding.taglineImageDataUrl ? (
            <img src={branding.taglineImageDataUrl} alt={branding.tagline} className="mx-auto mt-2 h-6 object-contain" />
          ) : (
            branding.tagline && (
              <p className={`text-gray-500 dark:text-gray-400 mt-2 whitespace-nowrap ${isCustomBranding ? "text-base" : "text-sm"}`}>{branding.tagline}</p>
            )
          )}
        </div>
        {error && <div className="rounded-md bg-red-50 dark:bg-red-900/30 p-3 text-sm text-red-800 dark:text-red-300">{error}</div>}
        <input type="text" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" required disabled={loading} />
        <div className="relative">
          <input type={showPassword ? "text" : "password"} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 pr-10" required disabled={loading} />
          <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300" disabled={loading}>
            {showPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
        </div>
        <button type="submit" disabled={loading} className="rounded-2xl bg-blue-600 text-white py-2.5 font-semibold hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed">
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}

// =============================
// Landing Page
// =============================
// Shown first when hitting the app's root URL, before the login form -
// onGetStarted just flips a piece of local state in the parent (no
// router in this app), swapping this out for <Login/>. Fetches from the
// public, no-auth /api/v1 endpoints so the hero and report list show
// genuinely live data rather than placeholder numbers.
function Landing({ onGetStarted, branding }: { onGetStarted: () => void; branding: { appName: string; accentColor: string; tagline: string; logoDataUrl: string | null; logoIncludesText: boolean; appNameImageDataUrl: string | null; taglineImageDataUrl: string | null } }) {
  const [usage, setUsage] = useState<{ ibm?: any; comp?: any } | null>(null);
  const [recentReports, setRecentReports] = useState<any[] | null>(null);

  useEffect(() => {
    fetch("/api/v1/usage").then((r) => (r.ok ? r.json() : null)).then(setUsage).catch(() => setUsage(null));
    fetch("/api/v1/reports").then((r) => (r.ok ? r.json() : [])).then((list) => setRecentReports(Array.isArray(list) ? list.slice(0, 4) : [])).catch(() => setRecentReports([]));
  }, []);

  const accent = branding.accentColor;
  const accentDark = darkenHex(accent, 0.35);
  const scrollTo = (id: string) => (e: React.MouseEvent) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); };

  const glanceFeatures = [
    { icon: BarChart3, title: "Live Storage Usage", description: "Track capacity and utilization across your storage volumes with daily refreshed data." },
    { icon: Folder, title: "Folder-Level Visibility", description: "Drill down from total capacity to individual folders and top storage paths." },
    { icon: FileText, title: "Automated Reporting", description: "Generate monthly Excel reports automatically and keep every report in one place." },
    { icon: Cpu, title: "AI-Powered Summary", description: "Turn storage numbers into a concise, plain-English summary automatically." },
  ];

  const flowSteps = [
    { icon: Database, label: "Scan", sub: "Scan storage volumes" },
    { icon: Cloud, label: "Ingest", sub: "Push data into STAR" },
    { icon: Cpu, label: "Analyze", sub: "Analyze & process" },
    { icon: Sparkles, label: "AI Summary", sub: "Generate AI summary" },
    { icon: FileText, label: "Excel Report", sub: "Create Excel report" },
    { icon: Mail, label: "Email", sub: "Send via email" },
  ];

  const trustBadges = [
    { icon: Shield, title: "Role-based access", description: "Separate everyday users from administrative functions." },
    { icon: Upload, title: "Controlled imports", description: "CSV imports and data-management actions are admin-only." },
    { icon: Palette, title: "Configurable branding", description: "Customize STAR's name, tagline, logo, and accent color." },
    { icon: Contrast, title: "Light & dark mode", description: "Use STAR comfortably in any environment." },
  ];

  const NavLogo = () => (
    branding.logoDataUrl && !branding.logoIncludesText ? (
      <img src={branding.logoDataUrl} alt={branding.appName} className="h-6 object-contain" />
    ) : (
      <Star size={20} style={{ color: accent }} fill="currentColor" strokeLinejoin="round" />
    )
  );

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {/* ===== Nav ===== */}
      <nav className="sticky top-0 z-20 border-b border-gray-200 bg-white/80 backdrop-blur dark:border-gray-800 dark:bg-gray-950/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2 font-bold tracking-wide">
            <NavLogo /> {!branding.logoIncludesText && <span>{branding.appName}</span>}
          </div>
          <div className="hidden items-center gap-6 text-sm font-medium text-gray-500 dark:text-gray-400 sm:flex">
            <a href="#overview" onClick={scrollTo("overview")} className="hover:text-gray-900 dark:hover:text-white">Overview</a>
            <a href="#features" onClick={scrollTo("features")} className="hover:text-gray-900 dark:hover:text-white">Features</a>
            <a href="#reports" onClick={scrollTo("reports")} className="hover:text-gray-900 dark:hover:text-white">Reports</a>
            <a href="#api" onClick={scrollTo("api")} className="hover:text-gray-900 dark:hover:text-white">API</a>
          </div>
          <button onClick={onGetStarted} className="rounded-full px-4 py-2 text-sm font-semibold text-white shadow-sm transition active:scale-[.98]" style={{ backgroundColor: accent }}>
            Open {branding.appName}
          </button>
        </div>
      </nav>

      {/* ===== Hero ===== */}
      <section id="overview" className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-2 lg:items-center">
        <div>
          {branding.tagline && <p className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: accent }}>{branding.tagline}</p>}
          {branding.logoDataUrl && branding.logoIncludesText ? (
            <img src={branding.logoDataUrl} alt={branding.appName} className="mb-4 max-h-28 object-contain" />
          ) : (
            <h1 className="mb-4 text-5xl font-extrabold tracking-tight">{branding.appName}</h1>
          )}
          <p className="mb-8 max-w-md text-lg text-gray-600 dark:text-gray-300">
            Monitor storage capacity, usage, and audit reports across your MAMS storage infrastructure.
          </p>
          <div className="flex flex-wrap gap-3">
            <button onClick={onGetStarted} className="inline-flex items-center gap-2 rounded-2xl px-6 py-3 font-semibold text-white shadow-sm transition active:scale-[.98]" style={{ backgroundColor: accent }}>
              Sign In <ArrowRight className="h-4 w-4" />
            </button>
            <a href="#features" onClick={scrollTo("features")} className="inline-flex items-center gap-2 rounded-2xl border border-gray-300 px-6 py-3 font-semibold hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800">
              See Features
            </a>
          </div>
        </div>

        {/* Live storage overview card */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-lg dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-4 flex items-center justify-between text-sm">
            <span className="font-semibold text-gray-900 dark:text-white">Storage Overview</span>
            {usage ? (
              <span className="flex items-center gap-1.5 text-gray-400"><span className="h-2 w-2 rounded-full bg-green-500" /> Live</span>
            ) : (
              <span className="text-gray-400">Loading…</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[{ key: "ibm", label: "IBM FS5K" }, { key: "comp", label: "COMP" }].map(({ key, label }) => {
              const v = usage?.[key];
              return (
                <div key={key} className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</div>
                  <div className="text-2xl font-bold" style={{ color: accent }}>{v ? `${v.percentFull?.toFixed(1)}%` : "—"}</div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    <div className="h-full rounded-full" style={{ width: `${v?.percentFull || 0}%`, backgroundColor: accent }} />
                  </div>
                  <div className="mt-2 text-xs text-gray-400">{v ? `${Math.round(v.usedTB)} TB / ${v.capacityTB} TB` : "no data yet"}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===== Feature grid ===== */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-3xl font-bold">Your storage at a glance</h2>
        <p className="mt-1 text-gray-500 dark:text-gray-400">Everything you need, in one place.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {glanceFeatures.map((f) => (
            <div key={f.title} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: `${accent}1a` }}>
                <f.icon className="h-5 w-5" style={{ color: accent }} />
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-white">{f.title}</h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Automation flow ===== */}
      <section className="border-y border-gray-200 bg-white py-16 dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto max-w-6xl px-6">
          <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: accent }}>Automation</p>
          <h2 className="mt-2 max-w-xl text-3xl font-bold">From storage scan to report — automatically.</h2>
          <p className="mt-2 max-w-xl text-gray-500 dark:text-gray-400">
            STAR turns raw storage scans into actionable storage reports without requiring someone to manually process the data every month.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
            {flowSteps.map((s, i) => (
              <div key={s.label} className="flex items-center gap-2">
                <div className="flex w-28 flex-col items-center text-center">
                  <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl" style={{ backgroundColor: `${accent}1a` }}>
                    <s.icon className="h-6 w-6" style={{ color: accent }} />
                  </div>
                  <div className="text-sm font-semibold">{s.label}</div>
                  <div className="text-xs text-gray-400">{s.sub}</div>
                </div>
                {i < flowSteps.length - 1 && <ChevronRight className="h-5 w-5 shrink-0 text-gray-300 dark:text-gray-700" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Three-column: automation / reports / API ===== */}
      <section id="reports" className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: accent }}>Automation</p>
            <h3 className="mt-2 text-xl font-bold">Built to run quietly in the background.</h3>
            <div className="mt-6 flex flex-col items-center gap-2">
              <div className="w-full rounded-lg border border-gray-200 px-3 py-2 text-center text-sm dark:border-gray-800">Daily Usage Refresh</div>
              <div className="h-4 w-px bg-gray-300 dark:bg-gray-700" />
              <div className="w-full rounded-lg px-3 py-2 text-center text-sm font-semibold text-white" style={{ backgroundColor: accent }}>{branding.appName}</div>
              <div className="h-4 w-px bg-gray-300 dark:bg-gray-700" />
              <div className="w-full rounded-lg border border-gray-200 px-3 py-2 text-center text-sm dark:border-gray-800">Month-End</div>
              <div className="flex w-full gap-2 text-xs text-gray-400">
                <div className="flex-1 rounded-lg border border-gray-200 p-2 text-center dark:border-gray-800">Storage Scan</div>
                <div className="flex-1 rounded-lg border border-gray-200 p-2 text-center dark:border-gray-800">Excel Report</div>
                <div className="flex-1 rounded-lg border border-gray-200 p-2 text-center dark:border-gray-800">Email</div>
              </div>
            </div>
            <p className="mt-4 text-xs text-gray-400">No manual consolidation. No monthly scramble.</p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: accent }}>Report History</p>
            <h3 className="mt-2 text-xl font-bold">Every report. One place.</h3>
            <div className="mt-4 space-y-2">
              {recentReports === null ? (
                <p className="text-sm text-gray-400">Loading…</p>
              ) : recentReports.length === 0 ? (
                <p className="text-sm text-gray-400">No reports generated yet.</p>
              ) : (
                recentReports.map((r) => (
                  <div key={r.filename} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-800">
                    <span className="text-gray-600 dark:text-gray-300">{r.date}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.source === "manual" ? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"}`}>
                      {r.source === "manual" ? "Manual" : "Automated"}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div id="api" className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: accent }}>Public API</p>
            <h3 className="mt-2 text-xl font-bold">Storage data other tools can use.</h3>
            <pre className="mt-4 overflow-x-auto rounded-lg bg-gray-900 p-3 text-xs text-green-300">
{`GET /api/v1/usage

{
  "ibm": { "usedTB": ${usage?.ibm ? Math.round(usage.ibm.usedTB) : 572}, "percent": ${usage?.ibm?.percentFull?.toFixed(1) || "86.5"} },
  "comp": { "usedTB": ${usage?.comp ? Math.round(usage.comp.usedTB) : 417}, "percent": ${usage?.comp?.percentFull?.toFixed(1) || "94.8"} }
}`}
            </pre>
            <p className="mt-3 text-xs text-gray-400">A read-only API makes {branding.appName}'s storage information available to other internal tools and workflows.</p>
            <a href="/api/v1/docs" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold" style={{ color: accent }}>Explore API Docs <ArrowRight className="h-3.5 w-3.5" /></a>
          </div>
        </div>
      </section>

      {/* ===== Trust badges ===== */}
      <section className="border-t border-gray-200 bg-white py-10 dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto grid max-w-6xl gap-6 px-6 sm:grid-cols-2 lg:grid-cols-4">
          {trustBadges.map((b) => (
            <div key={b.title} className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
                <b.icon className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              </div>
              <div>
                <div className="text-sm font-semibold">{b.title}</div>
                <div className="text-xs text-gray-400">{b.description}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ===== CTA banner ===== */}
      <section className="px-6 py-16 text-center text-white" style={{ background: `linear-gradient(to right, ${accent}, ${accentDark})` }}>
        <p className="text-xl font-semibold sm:text-2xl">Know your storage. Understand your usage.<br className="hidden sm:block" /> Report it automatically.</p>
        <button onClick={onGetStarted} className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-white px-6 py-3 font-semibold text-gray-900 shadow-sm transition active:scale-[.98]">
          Open {branding.appName} <ArrowRight className="h-4 w-4" />
        </button>
      </section>

      {/* ===== Footer ===== */}
      <footer className="border-t border-gray-200 bg-gray-50 py-8 dark:border-gray-800 dark:bg-gray-950">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-sm text-gray-400 sm:flex-row">
          <div className="flex items-center gap-2 font-semibold text-gray-600 dark:text-gray-300">
            <NavLogo /> {branding.appName}{branding.tagline ? ` — ${branding.tagline}` : ""}
          </div>
          <div>Internal MAMS infrastructure &middot; Storage &middot; Reporting &middot; Automation &middot; API</div>
        </div>
      </footer>
    </div>
  );
}

// =============================
// UI Primitives
// =============================
const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "outline" | "ghost"; size?: "sm" | "default" }> = ({ className = "", variant = "default", size = "default", ...props }) => (
  <button className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium shadow-sm transition active:scale-[.98] ${variant === "default" ? "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600" : "border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"} ${variant === "ghost" ? "border-0 hover:bg-gray-100 dark:hover:bg-gray-800" : ""} ${size === "sm" ? "px-3 py-1.5 text-xs" : ""} ${className}`} {...props} />
);

const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = "", ...props }) => (<div className={`rounded-2xl border border-gray-200 bg-white p-0 shadow-sm dark:border-gray-800 dark:bg-gray-900 ${className}`} {...props} />);
const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = "", ...props }) => (<div className={`flex items-center justify-between rounded-t-2xl bg-gray-50 px-4 py-3 dark:bg-gray-950 ${className}`} {...props} />);
const CardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = "", ...props }) => (<div className={`p-0 ${className}`} {...props} />);

// =============================
// Helper Functions
// =============================
const toNumber = (val: any) => { if (typeof val === "number" && Number.isFinite(val)) return val; if (val == null) return 0; let s = String(val).trim().replace(/\u00A0/g, ""); if (s === "") return 0; if (s.includes(",") && !s.includes(".")) s = s.replace(/,/g, "."); s = s.replace(/,/g, ""); const n = Number(s); return Number.isFinite(n) ? n : 0; };
const formatTB = (v: number) => (Math.round((v + Number.EPSILON) * 10000) / 10000).toFixed(4);

// The CSV is produced by several `du -sk <path>/*` passes at different depths,
// so summing EVERY row double-counts: /Volumes/snibmprod/media already contains
// /media/hr, which contains /media/hr/hr1/2026, etc. Only the direct children of
// the volume root are mutually exclusive, so only those add up to real occupied
// space. (Summing all rows gave 1,058 TB on a 660 TB volume.)
const rootChildren = (rows: any[], root: string) =>
  (rows || []).filter((r) => {
    const loc = String(r.location || "").replace(/\/+$/, "");
    if (!loc.startsWith(root + "/")) return false;
    const rest = loc.slice(root.length + 1);
    return rest.length > 0 && !rest.includes("/");
  });
const rootTotal = (rows: any[], root: string) =>
  rootChildren(rows, root).reduce((sum, r) => sum + (Number(r.size_tb) || 0), 0);

// Key Takeaways are generated in code, not by the model. The model was
// producing plausible-sounding but wrong arithmetic here (e.g. claiming
// occupied space "exceeded" web-reported usage when it was lower), and this
// report is emailed to people who take the figures at face value.
// ---- Shared report renderer ----
// Built for Outlook on Windows (Word engine): no flexbox, no grid, no
// border-radius, no max-width, and unreliable percentage widths - so this is
// fixed-pixel tables + inline styles + bgcolor attributes throughout.
const ACCENT = "#2f5da8", ACCENT2 = "#4f46e5";
const W = 780, COL = 380, BAR = 344;

// Darkens a #rrggbb hex color by the given fraction (0-1) - used to derive a
// second gradient stop from the admin-configured branding accent color,
// mirroring the original two-tone header (e.g. #2f5da8 -> #1f4294).
function darkenHex(hex: string, amount = 0.28): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function escHtml(s: any) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inlineBoldHtml(s: any) {
  return escHtml(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}
const FONT = "font-family:Arial,Helvetica,sans-serif;mso-line-height-rule:exactly;";
// Browsers drop background colors when printing unless told otherwise; without
// this the bars come out blank in a saved PDF.
const KEEPBG = "-webkit-print-color-adjust:exact;print-color-adjust:exact;";

function barHtml(pct: number, color: string, width?: number) {
  const w = width || BAR;
  const fill = Math.max(0, Math.min(w, Math.round((pct / 100) * w)));
  const rest = w - fill;
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="${w}" style="border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;${KEEPBG}"><tr>` +
    (fill > 0 ? `<td width="${fill}" height="10" bgcolor="${color}" style="width:${fill}px;height:10px;font-size:0;line-height:0;background-color:${color};${KEEPBG}">&nbsp;</td>` : "") +
    (rest > 0 ? `<td width="${rest}" height="10" bgcolor="#e5e7eb" style="width:${rest}px;height:10px;font-size:0;line-height:0;background-color:#e5e7eb;${KEEPBG}">&nbsp;</td>` : "") +
    `</tr></table>`;
}

function gaugeCell(label: string, used: number, total: number, color: string) {
  const pct = total > 0 ? (used / total) * 100 : 0;
  return `<td width="${COL}" valign="top" style="width:${COL}px;padding:0 5px;">
    <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="${COL - 10}" style="width:${COL - 10}px;border:1px solid #d7e0f2;border-collapse:collapse;page-break-inside:avoid;">
      <tr><td style="padding:14px;${FONT}">
        <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="${BAR}" style="width:${BAR}px;"><tr>
          <td style="${FONT}font-size:13px;line-height:16px;font-weight:bold;color:#5b6472;">${escHtml(String(label).toUpperCase())}</td>
          <td align="right" style="${FONT}font-size:13px;line-height:16px;color:#5b6472;white-space:nowrap;">${escHtml(used)} / ${escHtml(total)} TB</td>
        </tr></table>
        <p style="margin:8px 0 6px;${FONT}font-size:32px;line-height:34px;font-weight:bold;color:#111827;">${pct.toFixed(1)}<span style="font-size:15px;font-weight:normal;color:#5b6472;"> % used</span></p>
        ${barHtml(pct, color)}
        <p style="margin:7px 0 0;${FONT}font-size:13px;line-height:16px;color:#5b6472;">${Math.max(0, total - used).toFixed(0)} TB free</p>
      </td></tr>
    </table>
  </td>`;
}

function topPathsCell(title: string, rows: any[], color: string, tb2: (v:number)=>string) {
  const top = [...(rows || [])].sort((a, b) => (Number(b.size_tb) || 0) - (Number(a.size_tb) || 0)).slice(0, 5);
  const max = top.length ? Number(top[0].size_tb) || 0 : 0;
  const body = top.length === 0
    ? `<p style="margin:0;${FONT}font-size:14px;color:#9ca3af;font-style:italic;">No data available.</p>`
    : top.map((r) => {
        const v = Number(r.size_tb) || 0;
        const w = max > 0 ? (v / max) * 100 : 0;
        return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="${BAR}" style="width:${BAR}px;margin-bottom:11px;page-break-inside:avoid;">
          <tr>
            <td style="${FONT}font-size:13px;line-height:17px;color:#374151;">${escHtml(r.location)}</td>
            <td align="right" style="${FONT}font-size:13px;line-height:17px;font-weight:bold;color:#111827;white-space:nowrap;padding-left:10px;">${tb2(v)} TB</td>
          </tr>
          <tr><td colspan="2" style="padding-top:4px;">${barHtml(w, color)}</td></tr>
        </table>`;
      }).join("");
  return `<td width="${COL}" valign="top" style="width:${COL}px;padding:0 5px;">
    <p style="margin:0 0 10px;${FONT}font-size:13px;line-height:16px;font-weight:bold;color:#5b6472;">${escHtml(String(title).toUpperCase())}</p>
    ${body}
  </td>`;
}

function summaryTextToHtml(text: string) {
  let inGroup = false;
  const out: string[] = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^\*\*(.+?)\*\*:?$/);
    if (h) {
      inGroup = false;
      out.push(`<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="page-break-after:avoid;"><tr><td style="${FONT}font-size:17px;line-height:22px;font-weight:bold;color:#111827;border-bottom:1px solid #e5e7eb;padding:18px 0 7px;">${escHtml(h[1].replace(/:$/, ""))}</td></tr></table>`);
      continue;
    }
    const b = line.match(/^([-*+\u2022])\s+(.*)$/);
    if (b) {
      const content = b[2].trim();
      const bare = content.replace(/\*\*/g, "");
      if (/^[^:]{1,40}:$/.test(bare)) {
        inGroup = true;
        out.push(`<p style="margin:12px 0 4px;${FONT}font-size:15px;line-height:20px;font-weight:bold;color:#111827;page-break-after:avoid;">${escHtml(bare.replace(/:$/, ""))}</p>`);
        continue;
      }
      const nested = inGroup || b[1] === "+";
      out.push(`<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="margin:3px 0;page-break-inside:avoid;"><tr>
        <td width="${nested ? 34 : 16}" valign="top" style="width:${nested ? 34 : 16}px;padding-left:${nested ? 20 : 2}px;${FONT}font-size:15px;line-height:22px;color:${ACCENT};">${nested ? "&rsaquo;" : "&bull;"}</td>
        <td valign="top" style="${FONT}font-size:15px;line-height:22px;color:#374151;">${inlineBoldHtml(content)}</td>
      </tr></table>`);
      continue;
    }
    out.push(`<p style="margin:4px 0;${FONT}font-size:15px;line-height:22px;color:#374151;">${inlineBoldHtml(line)}</p>`);
  }
  return out.join("\n");
}

function buildReportHtml(o: any) {
  const tb2 = (v) => (Math.round((v + Number.EPSILON) * 100) / 100).toFixed(2);
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>STAR Monthly Report${o.monthLabel ? " - " + escHtml(o.monthLabel) : ""}</title>
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
    STAR Monthly Report${o.monthLabel ? ` &mdash; <span style="font-weight:normal;">${escHtml(o.monthLabel)}</span>` : ""}
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

const buildTakeaways = (
  ibmUsage: number, dellUsage: number,
  ibmTotal: number, dellTotal: number,
  ibmRows: any[], dellRows: any[]
) => {
  const capIbm = 660, capDell = 440;
  const tb2 = (v: number) => (Math.round((v + Number.EPSILON) * 100) / 100).toFixed(2);
  const topOf = (rows: any[], root: string) =>
    [...rootChildren(rows, root)].sort((a, b) => (Number(b.size_tb) || 0) - (Number(a.size_tb) || 0))[0];

  const pI = (ibmUsage / capIbm) * 100;
  const pD = (dellUsage / capDell) * 100;
  const freeIbm = Math.max(0, capIbm - ibmUsage);
  const freeDell = Math.max(0, capDell - dellUsage);
  const lines: string[] = [];

  lines.push(`- IBM is at ${pI.toFixed(1)}% of capacity, using ${ibmUsage} TB of its ${capIbm} TB with ${freeIbm.toFixed(0)} TB still free.`);

  // Comparison direction is computed, never assumed.
  const cmp = pD > pI ? `slightly higher at ${pD.toFixed(1)}%` : pD < pI ? `slightly lower at ${pD.toFixed(1)}%` : `at the same ${pD.toFixed(1)}%`;
  lines.push(`- IBM FS5K is ${cmp}, using ${dellUsage} TB of its ${capDell} TB with ${freeDell.toFixed(0)} TB free. The two have ${(freeIbm + freeDell).toFixed(0)} TB of free space combined.`);

  const gI = ibmUsage > 0 ? ((ibmUsage - ibmTotal) / ibmUsage) * 100 : 0;
  const gD = dellUsage > 0 ? ((dellUsage - dellTotal) / dellUsage) * 100 : 0;
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
};

// =============================
// AI Summary visual helpers
// =============================
const CapacityGauge: React.FC<{ label: string; used: number; total: number; bar: string }> = ({ label, used, total, bar }) => {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</span>
        <span className="shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400">{used} / {total} TB</span>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{pct.toFixed(1)}%</span>
        <span className="pb-1 text-xs text-gray-500 dark:text-gray-400">used</span>
      </div>
      <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
        <div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{Math.max(0, total - used).toFixed(0)} TB free</div>
    </div>
  );
};

const TopPaths: React.FC<{ title: string; rows: any[]; bar: string }> = ({ title, rows, bar }) => {
  const top = [...(rows || [])].sort((a, b) => (Number(b.size_tb) || 0) - (Number(a.size_tb) || 0)).slice(0, 5);
  const max = top.length ? (Number(top[0].size_tb) || 0) : 0;
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</h4>
      {top.length === 0 ? (
        <p className="text-xs italic text-gray-400">No data available.</p>
      ) : (
        <div className="space-y-2">
          {top.map((r, i) => {
            const v = Number(r.size_tb) || 0;
            const w = max > 0 ? (v / max) * 100 : 0;
            return (
              <div key={i}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs text-gray-700 dark:text-gray-300" title={r.location}>{r.location}</span>
                  <span className="shrink-0 text-xs font-medium tabular-nums text-gray-900 dark:text-gray-100">{formatTB(v)} TB</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.max(w, 1)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// Renders the model's markdown-ish output (bold, bullets, numbered lists)
// as real formatting instead of dumping raw ** asterisks on screen.
const inlineBold = (line: string, keyBase: string) =>
  line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={`${keyBase}-${i}`} className="font-semibold text-gray-900 dark:text-gray-100">{part.slice(2, -2)}</strong>
      : <span key={`${keyBase}-${i}`}>{part}</span>
  );

const RichSummary: React.FC<{ text: string }> = ({ text }) => {
  const out: React.ReactNode[] = [];
  // Models flatten hierarchy into a single bullet level, so rebuild it here:
  // a bullet that is just a short label ending in ":" ("IBM Storage:") is a
  // group header, and everything after it indents under it until the next
  // group header or section heading.
  let inGroup = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) { out.push(<div key={i} className="h-2" />); return; }
    const heading = line.match(/^\*\*(.+?)\*\*:?$/);
    if (heading) {
      inGroup = false;
      out.push(<h4 key={i} className="mt-3 border-b border-gray-200 pb-1 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:text-gray-100">{heading[1].replace(/:$/, "")}</h4>);
      return;
    }
    const numbered = line.match(/^(\d+)\.\s+(.*)$/);
    if (numbered) {
      out.push(
        <div key={i} className="flex gap-2 pl-2">
          <span className="shrink-0 text-xs font-semibold text-blue-600 dark:text-blue-400">{numbered[1]}.</span>
          <span className="text-sm text-gray-700 dark:text-gray-300">{inlineBold(numbered[2], `n${i}`)}</span>
        </div>
      );
      return;
    }
    // Models emit a mix of markers: "-"/"*"/"\u2022" for top-level points and
    // "+" for nested ones. Render "+" as an indented arrow rather than a
    // literal plus sign.
    const bullet = line.match(/^([-*+\u2022])\s+(.*)$/);
    if (bullet) {
      const content = bullet[2].trim();
      const bare = content.replace(/\*\*/g, "");
      // "IBM Storage:" / "Dell Storage:" style label -> group header, not a bullet
      if (/^[^:]{1,40}:$/.test(bare)) {
        inGroup = true;
        out.push(
          <div key={i} className="mt-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
            {bare.replace(/:$/, "")}
          </div>
        );
        return;
      }
      const nested = inGroup || bullet[1] === "+";
      out.push(
        <div key={i} className={`flex gap-2 ${nested ? "pl-6" : "pl-1"}`}>
          <span className="shrink-0 text-blue-600 dark:text-blue-400">{nested ? "\u203A" : "\u2022"}</span>
          <span className="text-sm text-gray-700 dark:text-gray-300">{inlineBold(content, `b${i}`)}</span>
        </div>
      );
      return;
    }
    out.push(<p key={i} className="text-sm text-gray-700 dark:text-gray-300">{inlineBold(line, `p${i}`)}</p>);
  });
  return <div className="space-y-1">{out}</div>;
};

function notify(msg: string, kind: "ok" | "warn" | "err" = "ok") {
  const id = "sar-toast-container";
  let wrap = document.getElementById(id);
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = id;
    wrap.style.position = "fixed";
    wrap.style.zIndex = "99999";
    wrap.style.right = "12px";
    wrap.style.bottom = "12px";
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column-reverse";
    wrap.style.gap = "8px";
    document.body.appendChild(wrap);
  }
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.padding = "8px 10px";
  el.style.borderRadius = "10px";
  el.style.boxShadow = "0 4px 12px rgba(0,0,0,.15)";
  el.style.fontSize = "12px";
  el.style.color = kind === "err" ? "#fff" : "#0f172a";
  el.style.background = kind === "ok" ? "#bbf7d0" : kind === "warn" ? "#fde68a" : "#ef4444";
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    el.style.transition = "all .25s";
    setTimeout(() => wrap && wrap.removeChild(el), 250);
  }, 1400);
}

const saveToLocalStorage = (key: string, data: any) => { try { localStorage.setItem(`mams-${key}`, JSON.stringify(data)); } catch (e) { console.warn("Failed to save to localStorage:", e); } };
const loadFromLocalStorage = (key: string) => { try { const data = localStorage.getItem(`mams-${key}`); return data ? JSON.parse(data) : null; } catch (e) { console.warn("Failed to load from localStorage:", e); return null; } };

// =============================
// Content tagging (System Files)
// =============================
function deriveContent(side: "IBM" | "COMP", loc: string) {
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

// =============================
// CSV / Excel parsing
// =============================
async function parseAny(file: File, opts: { storage: "IBM" | "COMP" }) {
  const name = (file?.name || "").toLowerCase();
  const BYTES_PER_GB = 1024 ** 3;

  const normalize = (v: any) => String(v ?? "").replace(/^\uFEFF/, "").replace(/\u00A0/g, " ").trim();

  const parseAOA = (rows: any[][]) => {
    let aoa = rows || [];
    const looksSingle = aoa.length > 0 && Array.isArray(aoa[0]) && aoa[0].length === 1 && typeof aoa[0][0] === "string";
    if (looksSingle) {
      const first = aoa[0][0];
      const delim = /;/.test(first) ? ";" : /\t/.test(first) ? "\t" : /\|/.test(first) ? "|" : ",";
      aoa = aoa.map((r) => String(r[0] || "").split(delim));
    }

    const out: any[] = [];
    for (const r of aoa) {
      if (!r || r.length < 2) continue;
      const cells = r.map((x: any) => normalize(x));
      if (cells.some((c) => /^total:?$/i.test(c))) break;
      const bytes = toNumber(r[0]);
      const loc = String(r[1] ?? "").trim();
      if (!Number.isFinite(bytes) || !loc || loc.toLowerCase() === "location") continue;
      const size_tb = bytes / BYTES_PER_GB;
      out.push({ location: loc, size_tb, content: deriveContent(opts.storage, loc) });
    }
    return out;
  };

  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
    return parseAOA(aoa);
  }

  const aoa = await new Promise<any[][]>((resolve, reject) => {
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (res: any) => resolve(res.data || []),
      error: reject,
    });
  });
  return parseAOA(aoa);
}

// =============================
// Theme
// =============================
const LS_KEYS = { theme: "sar-theme" };
const getInitialTheme = () => { if (typeof window === "undefined") return "system"; const saved = localStorage.getItem(LS_KEYS.theme); return ["light", "dark", "system"].includes(String(saved)) ? (saved as any) : "system"; };

// =============================
// Bucketing rules
// =============================
function getBuckets(side: "IBM" | "Dell"): Bucket[] {
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

function pickBucketRows(rows: any[], bucket: Bucket) {
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

// =============================
// API Functions
// =============================
const API = "/api";

async function apiLoadRows(side: "IBM" | "COMP") {
  console.log(`📥 Loading ${side} rows from server...`);
  const r = await fetch(`${API}/rows?side=${side}`, { cache: "no-store", headers: { 'Cache-Control': 'no-cache' } });
  if (!r.ok) throw new Error(`Load ${side} failed: ${r.status}`);
  const data = await r.json();
  return data.map(row => row && typeof row === 'object' && row.location !== undefined ? row : row);
}

async function getAISummary(prompt: string) {
  const res = await fetch("/api/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-oss:20b", prompt: prompt, stream: false }),
  });
  if (!res.ok) throw new Error("AI request failed");
  const data = await res.json();
  return data.response;
}

async function apiSaveRows(side: "IBM" | "COMP", rows: any[]) {
  console.log(`💾 Saving ${rows.length} rows for ${side} to server...`);
  const r = await fetch(`${API}/rows`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ side, data: rows }) });
  if (!r.ok) throw new Error(`Save ${side} failed`);
  return r.json();
}

async function apiLoadUsage() {
  try {
    const r = await fetch(`${API}/usage`, { cache: "no-store" });
    if (!r.ok) throw new Error("Load usage failed");
    const data = await r.json();
    return { ibm: data.ibm || 0, comp: data.comp || 0 };
  } catch (error) { console.error("apiLoadUsage error:", error); throw error; }
}

async function apiLoadBranding() {
  try {
    const r = await fetch(`${API}/branding`, { cache: "no-store" });
    if (!r.ok) throw new Error("Load branding failed");
    return await r.json();
  } catch (error) {
    console.warn("apiLoadBranding error, using defaults:", error);
    return { appName: "STAR", accentColor: "#2f5da8", tagline: "Storage Tracking & Audit Reporting", logoDataUrl: null, logoIncludesText: false, appNameImageDataUrl: null, taglineImageDataUrl: null };
  }
}

async function apiSaveBranding(branding: { appName: string; accentColor: string; tagline: string; logoDataUrl: string | null; logoIncludesText: boolean; appNameImageDataUrl: string | null; taglineImageDataUrl: string | null }) {
  const r = await fetch(`${API}/branding`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(branding) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Save branding failed");
  return data;
}

async function apiResetBranding() {
  const r = await fetch(`${API}/branding/reset`, { method: "POST" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Reset branding failed");
  return data;
}

async function apiLoadMeta() {
  const r = await fetch(`${API}/meta`, { cache: "no-store" });
  if (!r.ok) throw new Error("Load meta failed");
  return r.json() as Promise<{ ibmRowsUpdated: string | null; compRowsUpdated: string | null; ibmUsageUpdated: string | null; compUsageUpdated: string | null }>;
}

async function apiSaveUsage(partial: { ibm?: number | string; comp?: number | string }) {
  const payload: any = {};
  if (partial.ibm !== undefined) payload.ibm = Number(partial.ibm) || 0;
  if (partial.comp !== undefined) payload.comp = Number(partial.comp) || 0;
  const r = await fetch(`${API}/usage`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error("Save usage failed");
  return r.json();
}

async function apiLoadSortPrefs() {
  try {
    const r = await fetch(`${API}/sort-prefs`, { cache: "no-store" });
    if (!r.ok) throw new Error("Load sort prefs failed");
    return r.json();
  } catch (error) { console.error("apiLoadSortPrefs error:", error); throw error; }
}

async function apiSaveSortPrefs(side: "IBM" | "COMP", bucketKey: string, sortDesc: boolean) {
  const r = await fetch(`${API}/sort-prefs`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ side, bucketKey, sortDesc }) });
  if (!r.ok) throw new Error("Save sort pref failed");
  return r.json();
}

// =============================
// Main App Component
// =============================
export default function App() {
  const [showAI, setShowAI] = useState(false);
  const [aiOutput, setAiOutput] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [reportHistory, setReportHistory] = useState<{ filename: string; date: string; time: string; sizeBytes: number; source?: "automated" | "manual"; by?: string }[] | null>(null);
  const [reportHistoryLoading, setReportHistoryLoading] = useState(false);
  const [previewReport, setPreviewReport] = useState<{ filename: string; label: string } | null>(null);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user' });
  const [newUserShowPassword, setNewUserShowPassword] = useState(false);
  const [changePassword, setChangePassword] = useState({ username: '', newPassword: '' });
  const [changePasswordShowPassword, setChangePasswordShowPassword] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => localStorage.getItem("isAuth") === "true");
  // Landing page shows first on a fresh visit to the root URL, before the
  // login form - only relevant while unauthenticated (an already-logged-in
  // return visit goes straight to the app, never sees this).
  const [showLanding, setShowLanding] = useState(true);
  const [currentUser, setCurrentUser] = useState(() => localStorage.getItem("currentUser") || "postmams");
  const [userRole, setUserRole] = useState(() => localStorage.getItem("userRole") || "user");
  const [sortPrefs, setSortPrefs] = useState<Record<string, boolean>>({});
  const [ibmRows, setIbmRows] = useState<any[]>([]);
  const [dellRows, setDellRows] = useState<any[]>([]);
  const [theme, setTheme] = useState<"light" | "dark" | "system">(getInitialTheme());
  const [prefersDark, setPrefersDark] = useState(false);
  const [manualWebIBM, setManualWebIBM] = useState<string>("");
  const [manualWebDell, setManualWebDell] = useState<string>("");
  const [branding, setBranding] = useState({ appName: "STAR", accentColor: "#2f5da8", tagline: "Storage Tracking & Audit Reporting", logoDataUrl: null as string | null, logoIncludesText: false, appNameImageDataUrl: null as string | null, taglineImageDataUrl: null as string | null });
  const [brandingDraft, setBrandingDraft] = useState({ appName: "STAR", accentColor: "#2f5da8", tagline: "Storage Tracking & Audit Reporting", logoDataUrl: null as string | null, logoIncludesText: false, appNameImageDataUrl: null as string | null, taglineImageDataUrl: null as string | null });
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingResetting, setBrandingResetting] = useState(false);
  const ibmRef = useRef<HTMLInputElement | null>(null);
  const dellRef = useRef<HTMLInputElement | null>(null);
  const AUTO_LOGOUT_MINUTES = 10;

  const handleLogin = (username: string, role: string) => {
    setIsAuthenticated(true);
    setCurrentUser(username);
    setUserRole(role);
    localStorage.setItem("isAuth", "true");
    localStorage.setItem("currentUser", username);
    localStorage.setItem("userRole", role);
  };

  // ===== THEME FUNCTIONS =====
  // Just updates state + persistence - the effect below (which reacts to
  // both theme and prefersDark) is the single place that actually applies
  // the 'dark' class, so there's one source of truth instead of this
  // function and that effect potentially disagreeing.
  const changeTheme = (val: "light" | "dark" | "system") => {
    setTheme(val);
    localStorage.setItem(LS_KEYS.theme, val);
  };

  // ===== System Preference Listener =====
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    setPrefersDark(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // ===== APPLY THEME (single source of truth) =====
  // Runs on mount and on every theme/prefersDark change - covers the
  // 'system' case correctly (the old version of this effect only handled
  // literal 'dark'/'light', silently doing nothing for 'system' - since
  // 'system' is also the default for a first-ever visit with no saved
  // preference at all, that wasn't an edge case, it was the common one).
  useEffect(() => {
    const isDark = theme === "system" ? prefersDark : theme === "dark";
    document.documentElement.classList.toggle("dark", isDark);
    document.body.classList.toggle("dark", isDark);
  }, [theme, prefersDark]);

  // Keep the browser tab title in sync with the configured app name -
  // matters most when a logo replaces the visible app-name text (see
  // logoIncludesText), since the tab title is otherwise the only place
  // a custom name would show at all.
  useEffect(() => {
    document.title = branding.appName || "STAR";
  }, [branding.appName]);

  // Closes the header's "more actions" dropdown on an outside click.
  useEffect(() => {
    if (!showMoreMenu) return;
    const onClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [showMoreMenu]);

  // ===== Auto Logout =====
  useEffect(() => {
    if (!isAuthenticated) return;
    let timeout: number;
    const resetTimer = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        localStorage.removeItem("isAuth");
        localStorage.removeItem("currentUser");
        localStorage.removeItem("userRole");
        setIsAuthenticated(false);
        setCurrentUser("postmams");
        setUserRole("user");
        alert("You were logged out due to inactivity.");
      }, AUTO_LOGOUT_MINUTES * 60 * 1000);
    };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, resetTimer));
    resetTimer();
    return () => {
      events.forEach((e) => window.removeEventListener(e, resetTimer));
      window.clearTimeout(timeout);
    };
  }, [isAuthenticated]);

  // ===== Initial Load =====
  useEffect(() => {
    (async () => {
      console.log("🚀 Initializing app...");
      try {
        const [ibm, comp, usage, sortPrefsData] = await Promise.all([
          apiLoadRows("IBM").catch(e => { console.warn(e); return []; }),
          apiLoadRows("COMP").catch(e => { console.warn(e); return []; }),
          apiLoadUsage().catch(e => { console.warn(e); return null; }),
          apiLoadSortPrefs().catch(e => { console.warn(e); return {}; }),
        ]);
        apiLoadBranding().then((b) => { setBranding(b); setBrandingDraft(b); }).catch(() => {});
        
        if (sortPrefsData && typeof sortPrefsData === 'object') {
          setSortPrefs(sortPrefsData);
          saveToLocalStorage("sort-prefs", sortPrefsData);
        }
        
        if (Array.isArray(ibm) && ibm.length > 0) {
          setIbmRows(ibm);
          saveToLocalStorage("ibm-rows", ibm);
        } else {
          const localIbm = loadFromLocalStorage("ibm-rows");
          if (localIbm && Array.isArray(localIbm) && localIbm.length > 0) {
            setIbmRows(localIbm);
            try { await apiSaveRows("IBM", localIbm); } catch(e) {}
          }
        }
        
        if (Array.isArray(comp) && comp.length > 0) {
          setDellRows(comp);
          saveToLocalStorage("comp-rows", comp);
        } else {
          const localComp = loadFromLocalStorage("comp-rows");
          if (localComp && Array.isArray(localComp) && localComp.length > 0) {
            setDellRows(localComp);
            try { await apiSaveRows("COMP", localComp); } catch(e) {}
          }
        }
        
        let loadedIBM = "", loadedDell = "";
        if (usage && typeof usage === 'object') {
          loadedIBM = usage.ibm !== undefined ? String(usage.ibm) : "";
          loadedDell = usage.comp !== undefined ? String(usage.comp) : "";
        }
        if (!loadedIBM || !loadedDell) {
          const localUsage = loadFromLocalStorage("usage");
          if (localUsage) {
            if (!loadedIBM && localUsage.ibm !== undefined) loadedIBM = String(localUsage.ibm);
            if (!loadedDell && localUsage.comp !== undefined) loadedDell = String(localUsage.comp);
          }
        }
        setManualWebIBM(loadedIBM);
        setManualWebDell(loadedDell);
        if (loadedIBM || loadedDell) saveToLocalStorage("usage", { ibm: toNumber(loadedIBM), comp: toNumber(loadedDell) });
      } catch (e) {
        console.warn("⚠️ Using localStorage backup:", e);
        const localIbm = loadFromLocalStorage("ibm-rows");
        const localComp = loadFromLocalStorage("comp-rows");
        const localUsage = loadFromLocalStorage("usage");
        const localSortPrefs = loadFromLocalStorage("sort-prefs");
        if (localIbm && Array.isArray(localIbm)) setIbmRows(localIbm);
        if (localComp && Array.isArray(localComp)) setDellRows(localComp);
        if (localUsage) {
          setManualWebIBM(String(localUsage.ibm || ""));
          setManualWebDell(String(localUsage.comp || ""));
        }
        if (localSortPrefs) setSortPrefs(localSortPrefs);
        notify("Working offline - using local data", "warn");
      }
    })();
  }, []);

// ===== Load Usage on Page Refresh =====
useEffect(() => {
  const loadUsage = async () => {
    try {
      const usage = await apiLoadUsage();
      console.log("🔄 Loading usage:", usage);
      setManualWebIBM(usage.ibm !== undefined && usage.ibm !== null ? String(usage.ibm) : "");
      setManualWebDell(usage.comp !== undefined && usage.comp !== null ? String(usage.comp) : "");
    } catch (error) {
      console.error("Failed to load usage:", error);
    }
  };
  loadUsage();
}, []);

  // ===== Base Styles =====
  useEffect(() => {
    const id = "sar-base-style";
    if (!document.getElementById(id)) {
      const style = document.createElement("style");
      style.id = id;
      style.textContent = '*,*::before,*::after{box-sizing:border-box;}html,body,#root{height:100%;}body{margin:0;font-family:ui-sans-serif,system-ui;}';
      document.head.appendChild(style);
    }
  }, []);

  // ===== Import CSV =====
  const importCSV = async (storageLabel: "IBM" | "COMP", file?: File | null) => {
    if (!file) return;
    try {
      const parsed = await parseAny(file, { storage: storageLabel });
      if (storageLabel === "IBM") {
        setIbmRows(parsed);
        saveToLocalStorage("ibm-rows", parsed);
        await apiSaveRows("IBM", parsed);
        notify(`IBM data (${parsed.length} rows) saved to server.`, "ok");
        if (ibmRef.current) ibmRef.current.value = "";
      } else {
        setDellRows(parsed);
        saveToLocalStorage("comp-rows", parsed);
        await apiSaveRows("COMP", parsed);
        notify(`FS5K data (${parsed.length} rows) saved to server.`, "ok");
        if (dellRef.current) dellRef.current.value = "";
      }
      // Reflect the new save time immediately rather than waiting for the next
      // periodic /api/meta poll (up to 5 minutes away) - same fix as the usage save.
      apiLoadMeta().then((m) => {
        if (storageLabel === "IBM") setIbmRowsUpdated(m.ibmRowsUpdated);
        else setCompRowsUpdated(m.compRowsUpdated);
      }).catch(() => {});
    } catch (e: any) {
      console.error("Import error:", e);
      notify(`Failed to import file: ${e?.message || e}`, "err");
    }
  };

  // ===== Save Sort Preference =====
  const saveSortPreference = async (side: "IBM" | "COMP", bucketKey: string, sortDesc: boolean) => {
    try {
      setSortPrefs(prev => ({ ...prev, [bucketKey]: sortDesc }));
      saveToLocalStorage("sort-prefs", { ...sortPrefs, [bucketKey]: sortDesc });
      await apiSaveSortPrefs(side, bucketKey, sortDesc);
    } catch (error) {
      notify("Sort preference saved locally only", "warn");
    }
  };

  // ===== Manual Usage =====
const onChangeUsageIBM = async (val: string) => {
  const num = toNumber(val);
  console.log("💾 Saving IBM to server:", num);
  setManualWebIBM(val);
  try { 
    await apiSaveUsage({ ibm: num });
    notify("Saved to server.", "ok");
    // Reflect the new save time immediately rather than waiting for the next
    // periodic /api/meta poll (up to 5 minutes away).
    apiLoadMeta().then((m) => setIbmUsageUpdated(m.ibmUsageUpdated)).catch(() => {});
  } catch (error) { 
    console.error("Save failed:", error);
    notify("Failed to save.", "err");
  }
};

const onChangeUsageDell = async (val: string) => {
  const num = toNumber(val);
  console.log("💾 Saving IBM FS5K to server:", num);
  setManualWebDell(val);  // ← Fixed
  try { 
    await apiSaveUsage({ comp: num });
    notify("Saved to server.", "ok");
    apiLoadMeta().then((m) => setCompUsageUpdated(m.compUsageUpdated)).catch(() => {});
  } catch (error) { 
    console.error("Save failed:", error);
    notify("Failed to save.", "err");
  }
};

  // ===== Clear Data =====
  const clearData = async () => {
    if (!confirm("Are you sure you want to clear ALL data? This will delete:\n• IBM CSV data\n• IBM FS5K CSV data\n• Usage values\n• Sort preferences\n\nThis action cannot be undone.")) return;
    try {
      setIbmRows([]); setDellRows([]); setManualWebIBM(""); setManualWebDell(""); setSortPrefs({});
      saveToLocalStorage("ibm-rows", []); saveToLocalStorage("comp-rows", []); saveToLocalStorage("usage", { ibm: 0, comp: 0 }); saveToLocalStorage("sort-prefs", {});
      const response = await fetch("/api/clear-all", { method: "POST", headers: { "Content-Type": "application/json" } });
      if (!response.ok) throw new Error("Server error");
      notify("✅ All data cleared from server! Page will refresh.", "ok");
      setTimeout(() => window.location.reload(), 1000);
    } catch (error: any) {
      notify(`⚠️ Cleared local data. Server error: ${error.message}`, "warn");
      setTimeout(() => window.location.reload(), 1500);
    }
  };

  // ===== Export Excel =====
  // Shared rendering + upload/validation logic for every branding image
  // field (Logo, App Name image, Tagline image) - a plain function called
  // inline (never used as a JSX tag like <ImageUploadField/>), so it's not
  // its own component and can't trigger React's remount-on-re-render
  // behavior that defining a new component function inside a render body
  // would cause; it just closes over notify/brandingDraft normally.
  const brandingImageField = (opts: { label: string; value: string | null; onChange: (dataUrl: string | null) => void }) => (
    <div>
      <label className="mb-1 block text-sm font-medium">{opts.label}</label>
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-gray-300 dark:border-gray-700">
          {opts.value ? (
            <img src={opts.value} alt={`${opts.label} preview`} className="max-h-14 max-w-14 object-contain" />
          ) : (
            <Star size={24} className="text-gray-300 dark:text-gray-700" />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 2_000_000) {
                notify(`${opts.label} is too large - please use an image under ~2MB.`, "err");
                e.target.value = "";
                return;
              }
              const reader = new FileReader();
              reader.onload = () => opts.onChange(String(reader.result));
              reader.readAsDataURL(file);
            }}
            className="text-sm"
          />
          {opts.value && (
            <button type="button" onClick={() => opts.onChange(null)} className="self-start text-xs text-red-600 hover:underline dark:text-red-400">
              Remove {opts.label.toLowerCase()}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const exportExcel = () => {
    try {
      const capIbm = 660, capDell = 440;
      const usageIbm = Number(manualWebIBM) || 0;
      const usageDell = Number(manualWebDell) || 0;

      const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const pctTxt = (v: number) => (Number.isFinite(v) ? (v * 100).toFixed(1) + "%" : "—%");

      const makeBucketTable = (label: string, rows: any[], storageKey: string) => {
        const sortDesc = sortPrefs[storageKey] || false;
        const sortedRows = sortDesc ? [...rows].sort((a, b) => (Number(b.size_tb) || 0) - (Number(a.size_tb) || 0)) : rows;
        const body = sortedRows.length === 0 ? `</td><td class="nodata" colspan="3">No Data Available.</td></tr>` : sortedRows.map((r: any, i: number) => `<tr class="${i % 2 ? "row-alt" : "row"}"><td class="cell-left nowrap">${esc(r.location)}</td><td class="cell-center">${esc(r.content ?? "")}</td><td class="cell-center">${esc(formatTB(Number(r.size_tb) || 0))}</td></tr>`).join("");
        const total = sortedRows.reduce((a: number, r: any) => a + (Number(r.size_tb) || 0), 0);
        return `<table class="card"><thead><tr><th class="bucket-hdr" colspan="3">${esc(label)}</th></tr><tr class="head"><th class="th-center">LOCATION</th><th class="th-center">CONTENT</th><th class="th-center">SIZE (TB)</th></tr></thead><tbody>${body}</tbody><tfoot><tr class="total"><td class="th-left">TOTAL:</td><td></td><td class="th-center">${esc(formatTB(total))}</td></tr></tfoot></table>`;
      };

      const ibmBuckets = getBuckets("IBM");
      const dellBuckets = getBuckets("Dell");

      const buildSide = (title: string, viaWebUsage: number, cap: number, buckets: Bucket[], rows: any[]) => {
        const viaWeb = `<table class="webcard"><tr><td class="webtitle nowrap"><b>${esc(title)} (Via Web)</b></td><td class="webusage-label nowrap" align="center"><b>USAGE (TB):</b></td><td class="webusage-value nowrap" align="center">${esc(viaWebUsage || 0)}</td><td class="webusage-pct nowrap" align="center">${esc(pctTxt(cap ? viaWebUsage / cap : 0))}</td></tr></table>`;
        const tables = buckets.map(b => makeBucketTable(b.label, pickBucketRows(rows, b), `sar-sort:${title}:${b.label}`)).join(`<div class="gap"></div>`);
        return `<div class="column">${viaWeb}<div class="gap"></div>${tables}</div>`;
      };

      const left = buildSide("Post Prod HR Storage IBM", usageIbm, capIbm, ibmBuckets, ibmRows);
      const right = buildSide("Post Prod HR Storage IBM FS5K", usageDell, capDell, dellBuckets, dellRows);

      const css = `body { font-family: Arial, sans-serif; font-size: 12px; } .page { width: 100%; } .column { vertical-align: top; width: 50%; } .gap { height: 10px; } .webcard { border-collapse: collapse; width: 100%; background: #2f5da8; color: #fff; } .webcard td { padding: 6px 8px; } .webtitle { font-weight: 700; font-size: 12px; } .webusage-label { font-weight: 700; font-size: 12px; text-align: center; } .webusage-value { background: #ffffff; color: #1f4294; text-align: center; padding: 2px 6px; font-weight: 600; } .webusage-pct { font-weight: 700; font-size: 12px; text-align: center; } .card { border-collapse: collapse; width: 100%; border: 1px solid #c7d2e9; border-radius: 12px; } .bucket-hdr { background: #2f5da8; color: #fff; font-weight: 700; text-align: left; padding: 6px 8px; } .head th { background: #e8f0fe; color: #1f4294; font-weight: 700; } th, td { border: 1px solid #e1e8f8; padding: 6px 8px; } .row { background: #ffffff; } .row-alt { background: #f6f9ff; } .total td { background: #e8f0fe; color: #1f4294; font-weight: 700; } .nowrap { white-space: nowrap; } .th-center, .cell-center { text-align: center; } .nodata { text-align: center; font-style: italic; color: #6b7280; }`;

      const html = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8" /><style>${css}</style><title>STAR - Storage Tracking &amp; Audit Reporting</title></head><body><table class="page"><tr><td colspan="2"><div style="font-weight:700; font-size:16px; color:#1f4294;">STAR - Storage Tracking &amp; Audit Reporting</div></td></tr><tr><td class="column">${left}</td><td class="column">${right}</td></tr></table></body></html>`;

      const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const now = new Date();
      const yyyy = now.getFullYear(), mm = String(now.getMonth() + 1).padStart(2, "0"), dd = String(now.getDate()).padStart(2, "0"), hh = String(now.getHours()).padStart(2, "0"), min = String(now.getMinutes()).padStart(2, "0");
      a.download = `star_monthly_report_${yyyy}-${mm}-${dd}_${hh}${min}.xls`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);

      // Also save a copy server-side - best-effort, and deliberately doesn't
      // block or affect the browser download above in any way (the person
      // already has their file regardless of whether this succeeds). Shows
      // up in Report History tagged "manual" alongside the automated
      // monthly reports, so there's one place to find every export.
      fetch("/api/reports/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, by: currentUser }),
      })
        .then((r) => r.json().catch(() => ({})))
        .then((data) => {
          if (data?.success) {
            refreshReportHistory();
          } else {
            console.warn("Saving to Report History failed:", data?.error);
          }
        })
        .catch((e) => console.warn("Saving to Report History failed:", e));
    } catch (e: any) {
      console.error("Download failed:", e);
      alert("Download failed: " + (e?.message || e));
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("isAuth");
    localStorage.removeItem("currentUser");
    localStorage.removeItem("userRole");
    setIsAuthenticated(false);
    setCurrentUser("postmams");
    setUserRole("user");
  };

  const ibmBuckets = getBuckets("IBM");
  const dellBuckets = getBuckets("Dell");
  const effectiveDark = theme === "system" ? prefersDark : theme === "dark";

  const [ibmRowsUpdated, setIbmRowsUpdated] = useState<string | null>(null);
  const [compRowsUpdated, setCompRowsUpdated] = useState<string | null>(null);
  const [ibmUsageUpdated, setIbmUsageUpdated] = useState<string | null>(null);
  const [compUsageUpdated, setCompUsageUpdated] = useState<string | null>(null);

  const refreshReportHistory = () => {
    setReportHistoryLoading(true);
    return fetch("/api/reports/history", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setReportHistory(Array.isArray(list) ? list : []))
      .catch(() => setReportHistory([]))
      .finally(() => setReportHistoryLoading(false));
  };

  useEffect(() => {
    if (!showSettings) return;
    refreshReportHistory();
  }, [showSettings]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    const load = () => {
      apiLoadMeta()
        .then((m) => {
          if (cancelled) return;
          setIbmRowsUpdated(m.ibmRowsUpdated);
          setCompRowsUpdated(m.compRowsUpdated);
          setIbmUsageUpdated(m.ibmUsageUpdated);
          setCompUsageUpdated(m.compUsageUpdated);
        })
        .catch((e) => console.warn("apiLoadMeta failed:", e));
    };
    load();
    // Refresh periodically so the strip reflects a scan/usage-fetch that
    // completes while the app is left open, without needing a page reload.
    const id = setInterval(load, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isAuthenticated]);

  // Formats an ISO timestamp as "Aug. 4, 7:00 AM" and flags it stale past
  // staleHours - the daily jobs are expected within a day, so anything older
  // than that most likely means a cron run silently failed.
  const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const formatUpdated = (iso: string | null, staleHours: number) => {
    if (!iso) return { text: "never", stale: true };
    const d = new Date(iso);
    if (isNaN(d.getTime())) return { text: "unknown", stale: true };
    const ageHours = (Date.now() - d.getTime()) / 36e5;
    let hours = d.getHours();
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const text = `${MONTH_ABBR[d.getMonth()]}. ${d.getDate()}, ${hours}:${minutes} ${ampm}`;
    return { text, stale: ageHours > staleHours };
  };

  return (
    <>
      {!isAuthenticated ? (
        showLanding ? (
          <Landing onGetStarted={() => setShowLanding(false)} branding={branding} />
        ) : (
          <Login onLogin={handleLogin} branding={branding} />
        )
      ) : (
        <div className={`min-h-screen ${effectiveDark ? "dark" : ""} bg-gray-100 text-gray-900 dark:bg-gray-950 dark:text-gray-100`}>
          <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/80 backdrop-blur dark:border-gray-800 dark:bg-gray-900/80">
            <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                {/* No logo in the header by design - just the name/tagline, kept
                    compact for the toolbar row. The logo still shows on the
                    login screen. Since there's no logo here to be redundant
                    with, the app name always shows regardless of
                    logoIncludesText (that flag only matters where the logo
                    itself is actually displayed). */}
                {branding.appNameImageDataUrl ? (
                  <img src={branding.appNameImageDataUrl} alt={branding.appName} className="h-6 object-contain" />
                ) : (
                  <h1 className="text-2xl font-bold tracking-wide" style={{ color: branding.accentColor }}>{branding.appName}</h1>
                )}
                {(branding.taglineImageDataUrl || branding.tagline) && (
                  <>
                    {/* Divider + tagline hide on narrower screens so they never crowd the toolbar buttons */}
                    <span className="hidden xl:inline ml-1 -mr-1 h-5 w-px bg-gray-300 dark:bg-gray-700" />
                    {branding.taglineImageDataUrl ? (
                      <img src={branding.taglineImageDataUrl} alt={branding.tagline} className="hidden xl:inline h-6 object-contain" />
                    ) : (
                      <span className="hidden xl:inline text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">{branding.tagline}</span>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input ref={ibmRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { if (userRole === "admin") importCSV("IBM", e.target.files?.[0]); else notify("Only admins can import data.", "err"); if (ibmRef.current) ibmRef.current.value = ""; }} />
                <Button variant="outline" onClick={() => { if (userRole === "admin") ibmRef.current?.click(); else notify("Only admins can import data.", "err"); }}><Upload className="h-4 w-4" /> Import IBM CSV</Button>
                
                <input ref={dellRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { if (userRole === "admin") importCSV("COMP", e.target.files?.[0]); else notify("Only admins can import data.", "err"); if (dellRef.current) dellRef.current.value = ""; }} />
                <Button variant="outline" onClick={() => { if (userRole === "admin") dellRef.current?.click(); else notify("Only admins can import data.", "err"); }}><Upload className="h-4 w-4" /> Import FS5K CSV</Button>
                
                <Button onClick={exportExcel}><Download className="h-4 w-4" /> Download Excel</Button>

                <Button onClick={async () => { setAiLoading(true); setAiOutput(null); setShowAI(true); try {
                  const ibmTopLevel = rootChildren(ibmRows, "/Volumes/snibmprod");
                  const dellTopLevel = rootChildren(dellRows, "/Volumes/snibmfs5kprod");
                  const ibmTotal = rootTotal(ibmRows, "/Volumes/snibmprod");
                  const dellTotal = rootTotal(dellRows, "/Volumes/snibmfs5kprod");
                  const ibmUsage = Number(manualWebIBM) || 0;
                  const dellUsage = Number(manualWebDell) || 0;
                  const prompt = `Summarize the storage data from these tables in a clear, concise way:

IBM STORAGE DATA (Capacity: 660 TB):
- Web-reported usage: ${ibmUsage} TB (${((ibmUsage / 660) * 100).toFixed(1)}% of capacity)
- From script scan: ${formatTB(ibmTotal)} TB actually occupied, across ${ibmTopLevel.length} top-level folders (${ibmRows.length} rows scanned in total, including nested subfolders)

IBM FS5K STORAGE DATA (Capacity: 440 TB):
- Web-reported usage: ${dellUsage} TB (${((dellUsage / 440) * 100).toFixed(1)}% of capacity)
- From script scan: ${formatTB(dellTotal)} TB actually occupied, across ${dellTopLevel.length} top-level folders (${dellRows.length} rows scanned in total, including nested subfolders)

TOP STORAGE CONSUMERS FROM TABLES:

IBM Top Paths:
${ibmRows
  .sort((a, b) => (b.size_tb || 0) - (a.size_tb || 0))
  .slice(0, 10)
  .map((r, i) => `${i + 1}. ${r.location}: ${formatTB(r.size_tb || 0)} TB${r.content ? ` (${r.content})` : ''}`)
  .join('\n')}

IBM FS5K Top Paths:
${dellRows
  .sort((a, b) => (b.size_tb || 0) - (a.size_tb || 0))
  .slice(0, 10)
  .map((r, i) => `${i + 1}. ${r.location}: ${formatTB(r.size_tb || 0)} TB${r.content ? ` (${r.content})` : ''}`)
  .join('\n')}

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

                  const result = await getAISummary(prompt);
                  setAiOutput(result.trim() + buildTakeaways(ibmUsage, dellUsage, ibmTotal, dellTotal, ibmRows, dellRows));
                } catch (e: any) { setAiOutput(`Error: ${e.message}`); } finally { setAiLoading(false); } }} disabled={aiLoading}>
                  <Sparkles className="h-4 w-4" /> {aiLoading ? "Generating..." : "AI Summary"}
                </Button>
                
                <div className="relative" ref={moreMenuRef}>
                  <Button variant="outline" onClick={() => setShowMoreMenu((v) => !v)}><MoreVertical className="h-4 w-4" /></Button>
                  {showMoreMenu && (
                    <div className="absolute right-0 top-full z-20 mt-2 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
                      <button type="button" onClick={() => { changeTheme('light'); setShowMoreMenu(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800">
                        <Sun className="h-4 w-4" /> Light {theme === 'light' && <Check className="ml-auto h-3.5 w-3.5" />}
                      </button>
                      <button type="button" onClick={() => { changeTheme('dark'); setShowMoreMenu(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800">
                        <Moon className="h-4 w-4" /> Dark {theme === 'dark' && <Check className="ml-auto h-3.5 w-3.5" />}
                      </button>
                      <button type="button" onClick={() => { changeTheme('system'); setShowMoreMenu(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800">
                        <Laptop className="h-4 w-4" /> System {theme === 'system' && <Check className="ml-auto h-3.5 w-3.5" />}
                      </button>
                      <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
                      <button type="button" onClick={() => { setShowMoreMenu(false); if (userRole === "admin") setShowSettings(true); else notify("Only admins can access settings.", "err"); }} className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800">
                        <Settings className="h-4 w-4" /> Settings
                      </button>
                      <button type="button" onClick={() => { setShowMoreMenu(false); if (userRole === "admin") clearData(); else notify("Only admins can clear data.", "err"); }} className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800">
                        <Trash2 className="h-4 w-4" /> Clear
                      </button>
                      <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
                      <button type="button" onClick={() => { setShowMoreMenu(false); handleLogout(); }} className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800">
                        <LogOut className="h-4 w-4" /> Logout
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </header>

{showAI && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
      <div className="flex items-center justify-between px-4 py-2.5" style={{ background: `linear-gradient(to right, ${branding.accentColor}, ${darkenHex(branding.accentColor)})` }}>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Sparkles className="h-4 w-4" /> STAR Monthly Report
        </h2>
        <button onClick={() => setShowAI(false)} className="rounded-md px-2 py-1 text-sm text-white/80 transition hover:bg-white/20 hover:text-white">
          &#10005;
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {aiLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Sparkles className="h-8 w-8 animate-pulse text-blue-600" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Generating summary&hellip;</p>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <CapacityGauge label="Post Prod HR Storage IBM" used={Number(manualWebIBM) || 0} total={660} bar="bg-blue-600" />
              <CapacityGauge label="Post Prod HR Storage IBM FS5K" used={Number(manualWebDell) || 0} total={440} bar="bg-indigo-500" />
            </div>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <TopPaths title="IBM &mdash; Top 5 Paths" rows={ibmRows} bar="bg-blue-600" />
              <TopPaths title="IBM FS5K &mdash; Top 5 Paths" rows={dellRows} bar="bg-indigo-500" />
            </div>

            <div className="mt-6 border-t border-gray-200 pt-4 dark:border-gray-800">
              {aiOutput ? (
                aiOutput.startsWith("Error:") ? (
                  <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{aiOutput}</p>
                ) : (
                  <RichSummary text={aiOutput} />
                )
              ) : (
                <p className="text-sm italic text-gray-500 dark:text-gray-400">No summary yet. Click &ldquo;AI Summary&rdquo; to generate one.</p>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3 dark:border-gray-800 dark:bg-gray-950">
        {aiOutput && !aiOutput.startsWith("Error:") && (
          <Button
            variant="outline"
            onClick={() => {
              // Opens the rendered report in a new window and triggers the browser's
              // own print dialog, where "Save as PDF" is built in. No PDF library
              // needed, and the output matches what is on screen.
              const html = buildReportHtml({
                ibmUsage: Number(manualWebIBM) || 0,
                dellUsage: Number(manualWebDell) || 0,
                ibmRows,
                dellRows,
                summaryText: aiOutput,
                monthLabel: new Date().toLocaleString("en-US", { month: "long", year: "numeric" }),
              });
              const w = window.open("", "_blank");
              if (!w) {
                notify("Please allow pop-ups to save the report as PDF.", "err");
                return;
              }
              w.document.write(html);
              w.document.close();
              w.focus();
              // Give the new window a moment to lay out before printing.
              setTimeout(() => w.print(), 400);
            }}
          >
            <Download className="h-4 w-4" /> Save as PDF
          </Button>
        )}
        <Button onClick={() => setShowAI(false)}>Close</Button>
      </div>
    </div>
  </div>
)}

          {showSettings && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="w-full max-w-4xl rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900 max-h-[90vh] overflow-hidden flex flex-col">
                <div className="mb-4 flex items-center justify-between"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><Settings className="h-5 w-5" style={{ color: branding.accentColor }} />Settings</h2><div className="text-sm text-gray-600 dark:text-gray-400 mt-1">Logged in as: <span className="font-medium" style={{ color: branding.accentColor }}>{currentUser}</span> ({userRole})</div></div><button onClick={() => setShowSettings(false)} className="rounded-md px-2 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800">✕</button></div>
                <div className="flex-1 overflow-y-auto">
                  <div className="space-y-6">
                    {userRole === "admin" && (
                      <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                        <div className="mb-3 flex items-center justify-between">
                          <h3 className="font-semibold text-gray-900 dark:text-white">Branding</h3>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={async () => {
                                if (!window.confirm("Restore branding to the default STAR logo, name, and color? This can't be undone.")) return;
                                setBrandingResetting(true);
                                try {
                                  const reset = await apiResetBranding();
                                  setBranding(reset);
                                  setBrandingDraft(reset);
                                  notify("Branding restored to default.", "ok");
                                } catch (e: any) {
                                  notify(e?.message || "Failed to reset branding.", "err");
                                } finally {
                                  setBrandingResetting(false);
                                }
                              }}
                              className="text-gray-600 dark:text-gray-400"
                            >
                              {brandingResetting ? "Restoring..." : "Restore to Default"}
                            </Button>
                            {(brandingDraft.appName !== branding.appName || brandingDraft.tagline !== branding.tagline || brandingDraft.accentColor !== branding.accentColor || brandingDraft.logoDataUrl !== branding.logoDataUrl || brandingDraft.logoIncludesText !== branding.logoIncludesText || brandingDraft.appNameImageDataUrl !== branding.appNameImageDataUrl || brandingDraft.taglineImageDataUrl !== branding.taglineImageDataUrl) && (
                              <Button type="button" variant="outline" onClick={() => setBrandingDraft(branding)}>Cancel</Button>
                            )}
                            <Button
                              onClick={async () => {
                                setBrandingSaving(true);
                                try {
                                  const saved = await apiSaveBranding(brandingDraft);
                                  setBranding(saved);
                                  setBrandingDraft(saved);
                                  notify("Branding updated.", "ok");
                                } catch (e: any) {
                                  notify(e?.message || "Failed to save branding.", "err");
                                } finally {
                                  setBrandingSaving(false);
                                }
                              }}
                            >
                              {brandingSaving ? "Saving..." : "Save Branding"}
                            </Button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="mb-1 block text-sm font-medium">App Name</label>
                            <input
                              type="text"
                              value={brandingDraft.appName}
                              onChange={(e) => setBrandingDraft({ ...brandingDraft, appName: e.target.value })}
                              maxLength={60}
                              className="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800"
                              placeholder="STAR"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-sm font-medium">Tagline</label>
                            <input
                              type="text"
                              value={brandingDraft.tagline}
                              onChange={(e) => setBrandingDraft({ ...brandingDraft, tagline: e.target.value })}
                              maxLength={100}
                              className="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800"
                              placeholder="Storage Tracking & Audit Reporting"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-sm font-medium">Accent Color</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={/^#[0-9a-fA-F]{6}$/.test(brandingDraft.accentColor) ? brandingDraft.accentColor : "#2f5da8"}
                                onChange={(e) => setBrandingDraft({ ...brandingDraft, accentColor: e.target.value })}
                                className="h-10 w-14 cursor-pointer rounded border border-gray-300 dark:border-gray-700"
                              />
                              <input
                                type="text"
                                value={brandingDraft.accentColor}
                                onChange={(e) => setBrandingDraft({ ...brandingDraft, accentColor: e.target.value })}
                                className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-800"
                                placeholder="#2f5da8"
                              />
                            </div>
                          </div>
                          <div className="md:col-span-2">
                            {brandingImageField({
                              label: "Logo",
                              value: brandingDraft.logoDataUrl,
                              onChange: (v) => setBrandingDraft({ ...brandingDraft, logoDataUrl: v }),
                            })}
                            {brandingDraft.logoDataUrl && (
                              <label className="mt-2 flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={brandingDraft.logoIncludesText}
                                  onChange={(e) => setBrandingDraft({ ...brandingDraft, logoIncludesText: e.target.checked })}
                                  className="rounded border-gray-300 dark:border-gray-700"
                                />
                                My logo already includes the app name
                              </label>
                            )}
                            {brandingDraft.logoDataUrl && brandingDraft.logoIncludesText && (
                              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">The App Name field above will still be used for the browser tab title, but won't be shown next to the logo. The Tagline (text or image, below) is unaffected and still shows next to it either way.</p>
                            )}
                          </div>
                          {!brandingDraft.logoIncludesText && (
                            <div className="md:col-span-2">
                              {brandingImageField({
                                label: "App Name Image",
                                value: brandingDraft.appNameImageDataUrl,
                                onChange: (v) => setBrandingDraft({ ...brandingDraft, appNameImageDataUrl: v }),
                              })}
                            </div>
                          )}
                          <div className="md:col-span-2">
                            {brandingImageField({
                              label: "Tagline Image",
                              value: brandingDraft.taglineImageDataUrl,
                              onChange: (v) => setBrandingDraft({ ...brandingDraft, taglineImageDataUrl: v }),
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                      <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold text-gray-900 dark:text-white">Create New User</h3><Button onClick={async () => { if (!newUser.username || !newUser.password) { notify("Please fill all fields", "warn"); return; } try { const response = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newUser) }); const data = await response.json(); if (response.ok) { notify(data.message || `User ${newUser.username} created`, "ok"); setNewUser({ username: '', password: '', role: 'user' }); setNewUserShowPassword(false); } else { notify(data.error || "Failed to create user", "err"); } } catch (error: any) { notify("Error: " + (error.message || "Network error"), "err"); } }}>Create User</Button></div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div><label className="mb-1 block text-sm font-medium">Username</label><input type="text" value={newUser.username} onChange={(e) => setNewUser({...newUser, username: e.target.value})} className="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800" placeholder="Enter username" /></div>
                        <div><label className="mb-1 block text-sm font-medium">Password</label><div className="relative"><input type={newUserShowPassword ? "text" : "password"} value={newUser.password} onChange={(e) => setNewUser({...newUser, password: e.target.value})} className="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800 pr-10" placeholder="Enter password" /><button type="button" onClick={() => setNewUserShowPassword(!newUserShowPassword)} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300">{newUserShowPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</button></div></div>
<div>
  <label className="mb-1 block text-sm font-medium">Role</label>
  <div className="relative">
    <select 
      value={newUser.role} 
      onChange={(e) => setNewUser({...newUser, role: e.target.value})} 
      className="w-full rounded-md border border-gray-300 px-3 py-2 pr-8 bg-white dark:bg-gray-800 appearance-none"
    >
      <option value="user">User</option>
      <option value="admin">Admin</option>
    </select>
    <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
      <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  </div>
</div>
</div>
</div>
 
                    <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                      <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold text-gray-900 dark:text-white">Change Password</h3><Button onClick={async () => { if (!changePassword.username || !changePassword.newPassword) { notify("Please fill all fields", "warn"); return; } try { const response = await fetch('/api/users/password', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changePassword) }); const data = await response.json(); if (response.ok) { notify(data.message || `Password changed for ${changePassword.username}`, "ok"); setChangePassword({ username: '', newPassword: '' }); setChangePasswordShowPassword(false); } else { notify(data.error || "Failed to change password", "err"); } } catch (error: any) { notify("Error: " + (error.message || "Network error"), "err"); } }}>Change Password</Button></div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div><label className="mb-1 block text-sm font-medium">Username</label><input type="text" value={changePassword.username} onChange={(e) => setChangePassword({...changePassword, username: e.target.value})} className="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800" placeholder="Enter username" /></div>
                        <div><label className="mb-1 block text-sm font-medium">New Password</label><div className="relative"><input type={changePasswordShowPassword ? "text" : "password"} value={changePassword.newPassword} onChange={(e) => setChangePassword({...changePassword, newPassword: e.target.value})} className="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800 pr-10" placeholder="Enter new password" /><button type="button" onClick={() => setChangePasswordShowPassword(!changePasswordShowPassword)} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300">{changePasswordShowPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</button></div></div>
                      </div>
                    </div>
                    <UserListSection />

                    <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                      <h3 className="mb-3 font-semibold text-gray-900 dark:text-white">Report History</h3>
                      {reportHistoryLoading ? (
                        <p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
                      ) : !reportHistory || reportHistory.length === 0 ? (
                        <p className="text-sm text-gray-500 dark:text-gray-400">No reports yet. One is saved here automatically at the end of each month, and every time someone downloads a report manually.</p>
                      ) : (
                        <div className="space-y-2">
                          {reportHistory.map((r) => {
                            const [y, m, d] = r.date.split("-");
                            const label = new Date(Number(y), Number(m) - 1, Number(d)).toLocaleString("en-US", { month: "long", year: "numeric" });
                            const sizeKb = (r.sizeBytes / 1024).toFixed(0);
                            const isManual = r.source === "manual";
                            return (
                              <div key={r.filename} className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 dark:border-gray-700">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</span>
                                    <span
                                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${isManual ? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"}`}
                                      title={isManual ? "Downloaded manually from the app" : "Generated automatically by the month-end job"}
                                    >
                                      {isManual ? `Manual${r.by ? ` \u2014 ${r.by}` : ""}` : "Automated"}
                                    </span>
                                  </div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400">Generated {r.date} at {r.time} &middot; {sizeKb} KB</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setPreviewReport({ filename: r.filename, label })}
                                    className="flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                                  >
                                    <Eye className="h-3.5 w-3.5" /> Preview
                                  </button>
                                  <a
                                    href={`/api/reports/download?file=${encodeURIComponent(r.filename)}`}
                                    className="flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                                  >
                                    <Download className="h-3.5 w-3.5" /> Download
                                  </a>
                                  {userRole === "admin" && (
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        if (!window.confirm(`Delete the ${label} report? This cannot be undone.`)) return;
                                        try {
                                          const resp = await fetch(`/api/reports/delete?file=${encodeURIComponent(r.filename)}`, { method: "DELETE" });
                                          if (!resp.ok) throw new Error((await resp.json().catch(() => ({})))?.error || "Delete failed");
                                          setReportHistory((prev) => (prev || []).filter((x) => x.filename !== r.filename));
                                          notify("Report deleted.", "ok");
                                        } catch (e: any) {
                                          notify(e?.message || "Failed to delete report.", "err");
                                        }
                                      }}
                                      className="flex items-center gap-1 rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" /> Delete
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-6 flex justify-end gap-2 pt-4 border-t border-gray-200 dark:border-gray-700"><Button variant="outline" onClick={() => setShowSettings(false)}>Close</Button></div>
              </div>
            </div>
          )}

          {/* Report preview: the saved "Excel" exports are actually HTML tables
              with an .xls extension, so they render directly in an iframe with
              no parsing needed. Served inline by /api/reports/preview. The
              iframe is sandboxed - the file is app-generated, but it is still
              file content being rendered, so scripts stay disabled. */}
          {previewReport && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
              <div className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
                <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-800">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{previewReport.label} Report</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{previewReport.filename}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={`/api/reports/download?file=${encodeURIComponent(previewReport.filename)}`}
                      className="flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                    >
                      <Download className="h-3.5 w-3.5" /> Download
                    </a>
                    <button
                      onClick={() => setPreviewReport(null)}
                      className="rounded-md px-2 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <iframe
                  title={`${previewReport.label} report preview`}
                  src={`/api/reports/preview?file=${encodeURIComponent(previewReport.filename)}`}
                  sandbox=""
                  className="flex-1 w-full bg-white"
                />
              </div>
            </div>
          )}

          <main className="mx-auto max-w-screen-2xl p-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <PanelWithBuckets title="Post Prod HR Storage IBM" rows={ibmRows} buckets={ibmBuckets} manualUsage={manualWebIBM} setManualUsage={onChangeUsageIBM} userRole={userRole} side="IBM" sortPrefs={sortPrefs} saveSortPreference={saveSortPreference} updatedInfo={formatUpdated(ibmUsageUpdated, 36)} scriptUpdatedInfo={formatUpdated(ibmRowsUpdated, 36)} />
              <PanelWithBuckets title="Post Prod HR Storage IBM FS5K" rows={dellRows} buckets={dellBuckets} manualUsage={manualWebDell} setManualUsage={onChangeUsageDell} userRole={userRole} side="COMP" sortPrefs={sortPrefs} saveSortPreference={saveSortPreference} updatedInfo={formatUpdated(compUsageUpdated, 36)} scriptUpdatedInfo={formatUpdated(compRowsUpdated, 36)} />
            </div>
          </main>
        </div>
      )}
    </>
  );
}

// =============================
// UI pieces
// =============================
function PanelWithBuckets({ title, rows, buckets, manualUsage, setManualUsage, userRole, side, sortPrefs, saveSortPreference, updatedInfo, scriptUpdatedInfo }: {
  title: string; rows: any[]; buckets: Bucket[]; manualUsage: string; setManualUsage: (v: string) => void; userRole: string; side: "IBM" | "COMP"; sortPrefs: Record<string, boolean>; saveSortPreference: (side: "IBM" | "COMP", bucketKey: string, sortDesc: boolean) => void;
  updatedInfo?: { text: string; stale: boolean };
  scriptUpdatedInfo?: { text: string; stale: boolean };
}) {
  const cap = side === "IBM" ? 660 : 440;
  const manualNum = toNumber(manualUsage);
  const pct = Number.isFinite(manualNum) && manualNum > 0 ? (manualNum / cap) * 100 : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-2xl px-5 py-3 bg-[#2f5da8] text-white shadow-sm">
        <div className="flex items-center justify-between gap-2 flex-nowrap">
          <div className="text-sm font-semibold whitespace-nowrap">{`${title} (Via Web)`}</div>
          <div className="flex items-center gap-1 flex-nowrap whitespace-nowrap">
            <span className="text-sm font-semibold tracking-wide">USAGE (TB):</span>
            <input type="number" step="any" inputMode="decimal" value={manualUsage} onChange={(e) => { if (userRole === "admin") setManualUsage(e.target.value); }} onBlur={(e) => { if (userRole === "admin") setManualUsage(e.target.value); else notify("Only admins can modify usage data.", "err"); }} placeholder="—" className={`w-10 rounded-md px-1 py-0.5 text-center text-sm shadow-sm outline-none ring-0 focus:ring-2 appearance-none ${userRole === "admin" ? "bg-white text-[#1f4294] focus:ring-white/70" : "bg-gray-300 text-gray-500 cursor-not-allowed"}`} disabled={userRole !== "admin"} />
            <span className="text-sm font-semibold tabular-nums whitespace-nowrap">{pct != null ? `${pct.toFixed(1)}%` : "—%"}</span>
          </div>
        </div>
      </div>
      <Card><CardHeader><div className="flex w-full items-center justify-between gap-2 flex-wrap"><div className="text-sm font-semibold text-gray-700 dark:text-gray-300">{`${title} (Via Script)`}</div><div className="flex items-center gap-3 text-[11px] whitespace-nowrap">{updatedInfo && (<span className={updatedInfo.stale ? "text-amber-600 dark:text-amber-400" : "text-gray-400 dark:text-gray-500"}>{updatedInfo.stale && "\u26a0 "}Web: <span className={updatedInfo.stale ? "font-medium" : "font-medium text-gray-600 dark:text-gray-300"}>{updatedInfo.text}</span></span>)}{scriptUpdatedInfo && updatedInfo && (<span className="h-3 w-px bg-gray-300 dark:bg-gray-700" />)}{scriptUpdatedInfo && (<span className={scriptUpdatedInfo.stale ? "text-amber-600 dark:text-amber-400" : "text-gray-400 dark:text-gray-500"}>{scriptUpdatedInfo.stale && "\u26a0 "}Script: <span className={scriptUpdatedInfo.stale ? "font-medium" : "font-medium text-gray-600 dark:text-gray-300"}>{scriptUpdatedInfo.text}</span></span>)}</div></div></CardHeader><CardContent><div className="space-y-4">{buckets.map((b) => (<BucketBox key={b.label} label={b.label} rows={pickBucketRows(rows, b)} storageKey={`sar-sort:${title}:${b.label}`} side={side} sortPrefs={sortPrefs} saveSortPreference={saveSortPreference} />))}</div></CardContent></Card>
    </div>
  );
}

function BucketBox({ label, rows, storageKey, side, sortPrefs, saveSortPreference }: {
  label: string; rows: any[]; storageKey: string; side: "IBM" | "COMP"; sortPrefs: Record<string, boolean>; saveSortPreference: (side: "IBM" | "COMP", bucketKey: string, sortDesc: boolean) => void;
}) {
  const [sortDesc, setSortDesc] = useState<boolean>(() => sortPrefs[storageKey] || false);
  useEffect(() => { setSortDesc(sortPrefs[storageKey] || false); }, [sortPrefs, storageKey]);
  const handleSortToggle = () => { const newSortDesc = !sortDesc; setSortDesc(newSortDesc); saveSortPreference(side, storageKey, newSortDesc); };
  const total = useMemo(() => rows.reduce((a, r) => a + (Number(r.size_tb) || 0), 0), [rows]);
  const displayRows = useMemo(() => { if (!sortDesc) return rows; const copy = [...rows]; copy.sort((a, b) => (Number(b.size_tb) || 0) - (Number(a.size_tb) || 0)); return copy; }, [rows, sortDesc]);
  
  return (
    <div className="rounded-xl border border-[#c7d2e9] dark:border-gray-800 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between bg-[#2f5da8] px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-white">
        <span>{label}</span>
      </div>
      <table className="w-full table-auto text-sm">
        <thead>
          <tr className="bg-[#e8f0fe] text-left font-semibold text-xs uppercase tracking-wide text-[#1f4294]">
            <th className="w-1/2 border-b border-[#c7d2e9] px-4 py-2">Location</th>
            <th className="w-1/4 border-b border-[#c7d2e9] px-4 py-2">Content</th>
            
            <th className="w-1/4 border-b border-[#c7d2e9] px-4 py-2 relative">
  <div className="absolute inset-y-0 right-3 flex flex-row-reverse items-center gap-2">
    <span>Size (TB)</span>
    <button
      type="button"
      onClick={handleSortToggle}
      className="p-1 text-blue-700 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-200"
    >
      <span className="flex flex-col items-center leading-none">
        <span className={`w-0 h-0 border-l-4 border-r-4 border-l-transparent border-r-transparent border-b-[6px] ${sortDesc ? "opacity-30" : "opacity-100"}`} style={{ borderBottomColor: "currentColor" }} />
        <span className={`mt-0.5 w-0 h-0 border-l-4 border-r-4 border-l-transparent border-r-transparent border-t-[6px] ${sortDesc ? "opacity-100" : "opacity-30"}`} style={{ borderTopColor: "currentColor" }} />
      </span>
    </button>
  </div>
</th>

          </tr>
        </thead>
        <tbody>
          {displayRows.length === 0 ? (
            <tr>
              <td colSpan={3} className="border-b border-[#e1e8f8] px-4 py-2.5 text-center italic text-gray-500 dark:text-gray-400">
                No Data Available.
              </td>
            </tr>
          ) : (
            displayRows.map((r, i) => (
              <tr key={i} className={i % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-[#f6f9ff] dark:bg-gray-950"}>
                <td className="border-b border-[#e1e8f8] px-4 py-2 font-medium text-blue-800 dark:text-blue-300 whitespace-nowrap">{r.location}</td>
                <td className="border-b border-[#e1e8f8] px-4 py-2">{r.content ?? ""}</td>
                <td className="border-b border-[#e1e8f8] px-4 py-2 text-right tabular-nums">{formatTB(Number(r.size_tb) || 0)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="bg-[#e8f0fe] font-semibold text-[#1f4294] text-sm">
            <td className="px-4 py-2">TOTAL:</td>
            <td className="px-4 py-2"></td>
            <td className="px-4 py-2 text-right tabular-nums">{formatTB(Number(total) || 0)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function UserListSection() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/users');
      if (response.ok) {
        const data = await response.json();
        setUsers(data);
      } else {
        setError("Failed to load users");
      }
    } catch (err: any) {
      setError("Network error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const deleteUser = async (username: string) => {
    if (!confirm(`Delete user "${username}"?`)) return;
    try {
      const response = await fetch(`/api/users/${username}`, { method: 'DELETE' });
      const data = await response.json();
      if (response.ok) {
        notify(data.message || `User ${username} deleted`, "ok");
        loadUsers();
      } else {
        notify(data.error || "Delete failed", "err");
      }
    } catch (err: any) {
      notify("Error: " + err.message, "err");
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  if (loading) return <div className="p-4 text-center">Loading users...</div>;
  if (error) return <div className="p-4 text-center text-red-500">{error}</div>;
  if (users.length === 0) return <div className="p-4 text-center">No users found</div>;

  return (
    <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-white">Existing Users</h3>
        <Button variant="outline" size="sm" onClick={loadUsers} disabled={loading}>
          Refresh
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="px-4 py-2 text-left">Username</th>
              <th className="px-4 py-2 text-left">Role</th>
              <th className="px-4 py-2 text-left">Created</th>
              <th className="px-4 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.username} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                <td className="px-4 py-2 font-medium">{user.username}</td>
                <td className="px-4 py-2">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    user.role === 'admin' 
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' 
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                  }`}>
                    {user.role}
                  </span>
                </td>
                <td className="px-4 py-2 text-gray-500">
                  {user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
                </td>
                <td className="px-4 py-2">
                  {user.username !== 'postmams' && (
                    <button 
                      className="text-red-600 hover:text-red-800 dark:text-red-400 text-sm font-medium"
                      onClick={() => deleteUser(user.username)}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
