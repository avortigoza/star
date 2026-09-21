# STAR — Storage Tracking & Audit Reporting

STAR is an internal web app for tracking storage usage and capacity across
MAMS infrastructure — currently the **IBM FS5K** and **second storage array
("COMP")** volumes. It shows live usage/capacity dashboards, breaks storage
down by folder, generates monthly Excel reports with an AI-written summary,
and emails them out automatically.

Originally built for manual CSV imports and on-demand exports; the daily
usage refresh, the monthly scan, and the emailed report now all run
unattended — see [Automation](#automation) below.

## Features

- **Live usage dashboards** for both storage volumes — TB used, capacity,
  percent full, refreshed daily
- **Per-folder storage breakdown** tables, sortable, with drill-down "Top
  Paths" views
- **CSV import** (admin-only) for manually feeding in a fresh storage scan
- **Excel export** — one click in the browser, or automatically every
  month-end
- **AI-generated summary** of the current storage picture (via a local
  Ollama instance)
- **Report History** — every generated report, automated or manual, in one
  list, each tagged with its source and (for manual downloads) who
  generated it
- **Admin-configurable branding** — app name, tagline, accent color, and
  logo/wordmark/tagline images, with a one-click restore to default
- **User accounts** with admin/user roles; admin-gated actions (import,
  clear data, settings, user management)
- **Light/dark/system theme**
- **Public read-only REST API** (`/api/v1`) with interactive Swagger docs
  for other tools to build against

## Tech Stack

- **Frontend:** React 18 + TypeScript, Tailwind CSS, built with Vite
- **Backend:** Node.js + Express, serving both the API and the built
  frontend from one process
- **Storage:** flat JSON files on disk (no database) — `data/rows.json`,
  `data/usage.json`, `data/branding.json`, `data/users.json`, etc.
- **Deployment:** Docker (single container, multi-stage build)
- **Automation:** plain Node scripts + cron, running on the VM and on a
  Mac that has the actual storage volumes mounted

## Project Structure

```
.
├── src/                      React frontend (App.tsx is the whole UI)
├── server.js                 Express backend — API + static file serving
├── openapi.js                OpenAPI 3.0 spec for the public /api/v1 API
├── public/                   Favicon and other static assets
├── data/                     Runtime data (gitignored, Docker volume)
├── Dockerfile                Multi-stage build (Vite build → slim runtime)
├── docker-compose.yml        Single-service deployment config
├── Makefile                  Docker/backup shortcuts (see below)
└── mams-automation/          Unattended scan + report automation
    ├── README-AUTOMATION.md  Full detail on every scheduled job
    ├── scripts/
    │   ├── fetch-usage.js       Daily: SSHes into the storage host, pushes fresh usage numbers
    │   ├── monthly-report.js    Month-end: builds + emails the Excel report
    │   └── push-to-mams.js      Pushes a CSV's data into the running app via its API
    ├── audit_storage ver2.sh    Month-end: scans the volumes, writes CSVs, calls push-to-mams.js
    └── reports/                 Generated .xls files land here (Docker volume)
```

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Node.js 20+ (only needed if running outside Docker, or for the
  automation scripts in `mams-automation/`)

### 1. Clone and configure

```bash
git clone <this-repo-url>
cd star
```

Open `docker-compose.yml` and check the `OLLAMA_HOST` value points at a
real, reachable Ollama instance if you want the AI Summary feature to
work. Everything else in there can be left as-is for a standard deploy.

### 2. Build and run

```bash
docker compose up -d --build
```

The app will be available on **port 5179**. Both `data/` and
`mams-automation/reports/` are mounted as Docker volumes — this matters:
without them, all app data and generated reports are lost on every
rebuild, and Report History silently shows nothing (a real bug that bit
this project once — see the commit history if curious).

### 3. First login

A default admin account is created automatically the first time the app
starts (check `server.js`'s `USERS_FILE` initialization for the exact
credentials, or ask whoever last deployed it). **Change this password
immediately** after first login, or create a proper admin account and
remove the default one, via Settings → user management.

### Updating a running deployment

```bash
git pull origin main
docker compose up -d --build
```

The `Makefile` also has shortcuts for common operations — `make logs`,
`make status`, `make backup`, `make restore`, `make shell`, and a few
faster (but riskier — they skip the full Docker rebuild) update paths
like `make quick-update` and `make cp-server`. Run `make help` for the
full list. Prefer the plain `docker compose up -d --build` path above for
anything going to production; the Makefile's fast-path commands are
better suited to quick local iteration.

## Automation

Three scheduled jobs, running unattended across two machines (the VM
running this app, and a Mac Studio with the actual storage volumes
mounted):

| When | Runs on | Job | Does |
|---|---|---|---|
| Midnight, last day of month | Mac Studio | `audit_storage ver2.sh` | Scans both volumes, writes CSVs, pushes them into the app |
| 8:00 AM daily | VM | `fetch-usage.js` | SSHes into the Mac Studio for `df -k`, pushes fresh usage numbers |
| 10:00 AM, last day of month | VM | `monthly-report.js` | Builds the Excel report + AI summary, emails it out |

Setting any of this up (cron entries, SSH key auth, the `.env` file
`monthly-report.js` needs for Gmail SMTP) is genuinely fiddly and has a
list of specific gotchas that have already been hit once each — all of
it is documented in **[`mams-automation/README-AUTOMATION.md`](mams-automation/README-AUTOMATION.md)**,
which is the source of truth for this part of the system. Read that
before touching any of the cron jobs.

## Configuration

**Branding** (app name, tagline, accent color, logo) is configured
entirely in-app: Settings → Branding (admin only). No redeploy needed —
it's stored in `data/branding.json` and takes effect immediately.

**Environment variables** (set in `docker-compose.yml`):

| Variable | Used for | Default |
|---|---|---|
| `PORT` | Port the app listens on | `5179` |
| `NODE_ENV` | Standard Node environment flag | `production` |
| `OLLAMA_HOST` | Ollama instance for the AI Summary feature | *(hardcoded in `server.js` currently — see [Known Limitations](#known-limitations))* |
| `OLLAMA_MODEL` | Which model to request from Ollama | `gpt-oss:20b` |

Email credentials for the monthly report (`EMAIL_USER`, `EMAIL_PASS`,
`EMAIL_TO`) are **not** set here — they live in a separate, gitignored
`.env` file inside `mams-automation/`. See
`mams-automation/.env.example` and the automation README.

## API

### Internal API

`server.js` exposes a larger internal API (`/api/users`, `/api/rows`,
`/api/branding`, `/api/reports/*`, etc.) that the React frontend uses
directly. This is **not** a stable contract — it can change shape or grow
new write endpoints without notice. Don't build external tooling against
it; use the public API below instead.

### Public API (`/api/v1`)

A small, deliberately stable, **read-only** API meant for other tools to
build against:

- `GET /api/v1/usage` — usage/capacity summary for both volumes
- `GET /api/v1/rows` / `GET /api/v1/rows/:side` — per-folder storage rows
- `GET /api/v1/reports` — list of every generated report
- `GET /api/v1/reports/:filename/download` — download one report

**Interactive documentation:** `GET /api/v1/docs` (Swagger UI — browse
every endpoint and try real requests from the browser)
**Raw spec:** `GET /api/v1/openapi.json`

## Known Limitations

- **`OLLAMA_HOST`/`OLLAMA_MODEL` env vars aren't actually read** —
  `server.js`'s AI Summary endpoint currently has the Ollama URL
  hardcoded rather than reading `process.env.OLLAMA_HOST`. The env vars
  in `docker-compose.yml` are effectively unused right now; fixing this
  is a small, contained change if it becomes a problem.
- **The internal `"comp"` identifier** (API parameter, JSON data key,
  `COMP.csv` filename) refers to whatever the *second* storage volume
  currently is — it's stayed as `"comp"` across at least one hardware
  swap (Dell Compellent → IBM FS5K) specifically to avoid breaking the
  public API contract and historical stored data. User-facing text has
  been updated to say "FS5K"; the internal key has not, on purpose. See
  `mams-automation/README-AUTOMATION.md` if this needs to change again.
- **No automated tests.** Verification is currently manual (and, during
  development, via direct `curl`/live-server checks against a local
  instance before every deploy).
