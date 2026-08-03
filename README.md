# solar.tavaoneeducation.org

Live space-weather tool + propagation teaching for amateur radio — the **solar section** of `tavaoneeducation.org`. It wears the main site's skin (shared header/footer/theme) so it reads as the same site; only the body changes.

> **Claude Code — start here:** read **`BUILD_BRIEF.md`** first (the full spec / what to build), then this README (how to run, build, deploy). Windows / PowerShell. Cross-machine sync via GitHub. No app code until the plan in BUILD_BRIEF is approved.
>
> **Two repos in this workspace:** `solar-tavaoneedu` (this — what you build) and `tavaone-education` (the main site, **read-only** — the source of the shared header/footer/CSS). See "Shared shell" below.

---

## Scope (important)
This subdomain is **solar and solar teaching only** — dashboard, propagation explainers (`/learn`), grid map, charts, share cards. The **licensing course stays on the main site** at `tavaoneeducation.org/course` and is **not** built here. Solar and the course connect only by a reciprocal hyperlink (BUILD_BRIEF §14).

## What it is
- **Live dashboard:** SFI / SN / A / K, X-ray class, solar wind, HamQSL band conditions, aurora, and a **grid-specific KC2G MOF map**.
- **Teaching layer (`/learn`):** propagation explainers, plain-English "what does this mean on the air," that the main site's course can link to as a live example.
- **Trend charts** from D1-logged snapshots (the thing paste-in banners can't do).
- **Share-card generator** for social.

## Architecture
Astro → Cloudflare **Pages** (site + **`/api/*` Pages Functions**, same origin) + a small **`solar-cron` Worker** (15-min scheduled fetch) + **D1** (history) + **KV** (live cache). Same origin, **no CORS**. Full detail in `BUILD_BRIEF.md` §2.

## Shared shell (make it look like the same site)
The main site (`tavaone-education`, GitHub Pages) and this app (Cloudflare Pages) are different codebases on different hosts — they can't share a running file. So **replicate**, don't import:
- Read the actual header/footer/nav markup and CSS (or design tokens/variables) from the attached **`tavaone-education`** repo.
- Port them into `src/layouts/Shell.astro` + copied CSS/tokens; every solar page renders inside it.
- Solar's header links back to the main site (`/`, `/course`, `/study`); the main site's propagation lessons link into solar. Nav feels continuous.
- Copy CSS variables/tokens **verbatim** where they exist, so a future theme change is a quick re-sync, not a guess.

## Repo layout
```
solar-tavaoneedu/
├─ BUILD_BRIEF.md          # full spec — READ FIRST
├─ README.md               # this file
├─ src/
│  ├─ layouts/Shell.astro  # shared shell replicated from tavaone-education
│  └─ pages/
│     ├─ index.astro       #   dashboard
│     └─ learn/            #   propagation explainers (solar teaching)
├─ functions/api/          # Pages Functions — SAME ORIGIN, bind D1 + KV
│  ├─ solar.ts             #   GET /api/solar   (from KV)
│  ├─ history.ts           #   GET /api/history (from D1)
│  └─ grid.ts              #   GET /api/grid
├─ schema.sql              # D1 table: snapshots (BUILD_BRIEF §4)
├─ astro.config.mjs
└─ cron/                   # solar-cron Worker (scheduled fetch only)
   ├─ src/index.ts         #   scheduled() → fetch feeds → D1 + KV
   └─ wrangler.toml
```
> **No CORS:** the API is Pages Functions on the same origin as the site, so the browser never makes a cross-origin call. The main site just links to solar — no data crosses.

## Prerequisites
- Node LTS + npm
- Wrangler (`npm i -g wrangler`, or use `npx wrangler`)
- Cloudflare account with Pages, Workers, D1, KV
- `wrangler login`

## First-time setup (PowerShell)
```powershell
git clone https://github.com/w4ggj/solar-tavaoneedu.git
cd solar-tavaoneedu
npm install
npm run dev                                   # local Astro + Pages Functions (wrangler pages dev)

# Cloudflare resources (from repo root)
wrangler d1 create solar_history              # paste database_id into cron/wrangler.toml + Pages bindings
wrangler kv namespace create SOLAR_CACHE      # paste id into cron/wrangler.toml + Pages bindings
wrangler d1 execute solar_history --file=.\schema.sql

# cron Worker
cd cron
npm install
wrangler dev                                  # test the scheduled fetch locally
```
> Bind **`DB`** (D1 `solar_history`) and **`SOLAR_CACHE`** (KV) to **both** the Pages project (dashboard → Settings → Functions → bindings) **and** `solar-cron`.

## cron/wrangler.toml
```toml
name = "solar-cron"
main = "src/index.ts"
compatibility_date = "2026-06-01"

[[d1_databases]]
binding = "DB"
database_name = "solar_history"
database_id = "PASTE_AFTER_CREATE"

[[kv_namespaces]]
binding = "SOLAR_CACHE"
id = "PASTE_AFTER_CREATE"

[triggers]
crons = ["*/15 * * * *"]
```

## Deploy
- **Cron Worker:** from `cron/`, `wrangler deploy`. Confirm the schedule under the Worker's **Triggers**.
- **Pages (site + Functions):** connect the GitHub repo in the Cloudflare dashboard:
  - Build command: `npm run build`
  - Output directory: `dist`
  - Add the D1 + KV **Function bindings** in project settings.
  - Auto-deploys on push to `main`; `functions/api/*` deploy with it.

## Custom domain (do this LAST)
DNS for `tavaoneeducation.org` is already on Cloudflare. The custom domain still can't be attached until the Pages project exists: **first Pages deploy** mints `solar-tavaoneedu.pages.dev`, **then** attach `solar.tavaoneeducation.org` (one click). The main site's apex/www + email records stay untouched; leave the GitHub Pages apex on grey-cloud (DNS-only).

## Data sources (server-side + cached only)
HamQSL `solarxml.php` (primary, band conditions), NOAA SWPC JSON (forecast / trend / alerts), KC2G per-grid MOF map. Full endpoint list and the **NOAA 2026 JSON format note** are in `BUILD_BRIEF.md` §3. Never call these APIs from the browser — `solar-cron` fetches and caches (KV) to protect the sources; credit N0NBH / NOAA / KC2G visibly.

## Conventions
- Read `BUILD_BRIEF.md` before coding.
- PowerShell for all commands.
- **Match the main site's shell** (replicated from `tavaone-education`); don't invent a separate look.
- Solar and solar teaching only — no course/quizzes/certificate here (those live on the main site).
- All third-party fetches are server-side (`solar-cron`) and cached; the browser only ever hits our own same-origin `/api/*`.
- Attribution to N0NBH / NOAA SWPC / KC2G is required and visible.

## Status
Build phases 0–8 are in `BUILD_BRIEF.md` §11. **Current: Phase 0 (scaffold).**
