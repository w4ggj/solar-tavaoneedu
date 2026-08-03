# SOLAR.TAVAONEEDUCATION.ORG — BUILD BRIEF

**Project:** Solar / space-weather tool + solar teaching, at `solar.tavaoneeducation.org`
**Owner:** Joseph Leone (W4GGJ) — TavaOne Education (FL nonprofit, FDACS CH84123)
**Stack:** Astro → Cloudflare Pages (site + `/api/*` Pages Functions) + `solar-cron` Worker (15-min scheduled fetch) + D1 (history) + KV (live cache). Same origin — no CORS.
**Handoff:** Read this file + `README.md` before writing code. Windows/PowerShell environment. Sync via GitHub.

> **Scope guardrail.** This subdomain is **solar and solar teaching ONLY** — the live dashboard, propagation explainers (`/learn`), grid map, charts, and share cards. The **licensing course stays on the main site** (`tavaoneeducation.org/course`, GitHub Pages) and is **not** part of this build. The two connect only by a reciprocal link (see §14).

> **Looks like the same site.** A visitor should feel they never left `tavaoneeducation.org` — same header, footer, nav, fonts, colors, spacing. Only the body changes. This is achieved by **replicating the main site's shell** from the `tavaone-education` repo (attached in the same Claude Code workspace) — see §14 and Phase 0.

---

## 1. Goal & positioning

A live space-weather tool for HF/VHF operators — and a teaching surface for propagation — that goes beyond the paste-in HamQSL banner every ham site already has. Differentiators:

1. **Interpretation / teaching layer** — every metric mapped to what it means on the air, plain-English, with a POTA slant; `/learn` explainers cover the propagation concepts (and can be linked from the main site's course as a live example — §14).
2. **Grid-square personalization** — greyline timing + a location-specific KC2G MOF map for the operator's own grid (default EL87PT).
3. **Trend history** — D1-logged snapshots power trend charts (the thing paste-in banners can't do).
4. **Social feedback loop** — a one-click generator emits a conditions card + caption/hashtags.

Audience: POTA and newer operators, plus license students using it as a live propagation reference. Tone: knowledgeable, plainspoken. Visual identity: **identical to the main `tavaoneeducation.org` site** (shared shell), so it reads as the "solar section" of the same site. Mobile-first — people check this on a phone in a park.

---

## 2. Architecture

```
solar.tavaoneeducation.org  (Cloudflare Pages, Astro)
   ├── Shared shell: header / footer / nav / theme  ← replicated from tavaone-education (§14)
   ├── Dashboard (live conditions, verdict, band table)
   ├── /learn    (propagation explainers — the solar teaching layer)
   └── /api/*    (Pages Functions — SAME ORIGIN, bind D1 + KV)
          ├── GET /api/solar        → merged current conditions (from KV, 15-min TTL)
          ├── GET /api/history      → trend series from D1
          └── GET /api/grid?g=EL87pt → sun/greyline calc + KC2G map URL

   solar-cron  (Worker, Cron Trigger */15) → fetch feeds, write D1 snapshot, refresh KV
       (separate from Pages only because Pages Functions can't run cron; shares the same D1 + KV)
```

**Same origin, no CORS.** The site and its API are both on `solar.tavaoneeducation.org` — the frontend calls its own `/api/*` (Pages Functions), so every browser call is same-origin. The only separate piece is a tiny **`solar-cron` Worker** for the 15-minute scheduled fetch (Pages Functions can't cron); it binds the same D1 + KV the Functions read.

**Two sites, shared skin.** The main site (`tavaoneeducation.org`, GitHub Pages) and this solar app (Cloudflare Pages) are **different codebases on different hosts** — they cannot share a running file. To make solar look like the same site, we **replicate** the main site's header, footer, nav, and CSS/tokens into this app's shell (§14, Phase 0). The main site is untouched; nothing about it moves.

**No course here.** The licensing course stays at `tavaoneeducation.org/course` on the main site. This subdomain only *links* to/from it (§14). There is no `/course`, no quizzes, no certificate, and no `/api/complete` in this build.

### Cloudflare resources to create
- Pages project: `solar-tavaoneedu` (serves site + `/api/*` Pages Functions)
- Worker: `solar-cron` (Cron Trigger `*/15 * * * *`; scheduled fetch only)
- D1 database: `solar_history` (bound to BOTH the Pages project and `solar-cron`)
- KV namespace: `SOLAR_CACHE` (bound to both)
- DNS: the `tavaoneeducation.org` zone is **already on Cloudflare**. Attach `solar` as a custom domain **during Phase 0, after the Pages project's first deploy.**

> **DNS plan.** The zone is on Cloudflare; the main site's apex/www still point to GitHub Pages (unchanged). The custom domain **cannot** be attached until the Pages project exists (created at first deploy in Phase 0):
> 1. First Phase-0 deploy mints `solar-tavaoneedu.pages.dev`.
> 2. Attach `solar.tavaoneeducation.org` as a custom domain on the Pages project — one click, since the zone is on Cloudflare. The `solar` record is created automatically.
>
> **Leave the main site alone.** The apex + `www` records (GitHub Pages) and all email records (MX/TXT/DKIM/SPF/DMARC) stay exactly as they are; confirm the GitHub Pages apex/www are **DNS-only (grey cloud)** so GitHub keeps serving its own TLS. Nothing about `tavaoneeducation.org` moves.

---

## 3. Data sources (all free, all verified live 2026-08)

### Primary — HamQSL (N0NBH), one call, ham-formatted
`https://www.hamqsl.com/solarxml.php` — XML. Single fetch returns SFI, sunspot number, A/K index (+ K in nT), X-ray class, proton & electron flux, solar wind, signal-to-noise, aurora + normalization, **and** band conditions (Good/Fair/Poor) for 80-40 / 30-20 / 17-15 / 12-10 m day & night, plus VHF (E-skip, aurora, MUF). This is the backbone of the band table.
- They cache 15 min at source — **do not poll faster than every 15 min.** Credit N0NBH visibly.

### Authoritative / forecast / trend — NOAA SWPC (public domain)
| Data | Endpoint |
|---|---|
| 10.7cm flux, 30-day | `https://services.swpc.noaa.gov/products/10cm-flux-30-day.json` |
| Planetary K-index | `https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json` |
| K-index forecast | `https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json` |
| Solar wind speed | `https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json` |
| Solar wind mag field (Bz) | `https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json` |
| NOAA scales (R/S/G) | `https://services.swpc.noaa.gov/products/noaa-scales.json` |
| Alerts / watches / warnings | `https://services.swpc.noaa.gov/products/alerts.json` |
| Predicted A-index (Fredericksburg) | `https://services.swpc.noaa.gov/json/predicted_fredericksburg_a_index.json` |
| GOES X-ray flux (6h) | `https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json` |
| OVATION aurora (oval) | `https://services.swpc.noaa.gov/json/ovation_aurora_latest.json` |
| 3-day text forecast | `https://services.swpc.noaa.gov/text/3-day-forecast.txt` |
| 27-day outlook | `https://services.swpc.noaa.gov/text/27-day-outlook.txt` |

> **⚠️ Format note:** Per SWPC Service Change Notice 26-21 (early 2026), `10cm-flux-30-day.json`, `noaa-planetary-k-index.json`, `noaa-planetary-k-index-forecast.json`, and `kyoto-dst.json` moved from the legacy header-row-then-values array to **standard JSON objects with numeric (unquoted) values**. Target the current object format; don't copy old parsing examples from the web.

### Grid personalization — KC2G (Andrew, prop.kc2g.com)
- Per-grid Maximum Operating Frequency map (the headline grid feature):
  `https://prop.kc2g.com/api/moflof.svg?grid=el87pt&metric=mof_sp` (lowercase 6-char grid; swap `mof_sp`→`lof_sp` for LOF). Star marks the TX location; contours show highest usable freq from that point to everywhere. Updates every ~15 min.
- Generic MUF/foF2 maps also available as renders for the non-personalized view. Credit KC2G + GIRO.

### Optional visual
- NASA SDO latest solar imagery for a "face of the sun" panel (visual appeal; pick a stable current-image URL at build time).

### Fetch / caching rules
- Cron every 15 min: fetch all feeds server-side (avoids CORS + protects source servers), normalize into one JSON object, write to `SOLAR_CACHE` KV (key `current`, TTL ~20 min) and append a snapshot row to D1.
- `/api/solar` serves from KV only (fast, and shields sources from traffic spikes).
- **Fallback chain:** if HamQSL is unreachable, serve last-good KV + derive an approximate band outlook from NOAA SFI/K and flag "ham feed unavailable — showing NOAA-derived estimate." Never hard-fail the page.

---

## 4. D1 schema (`solar_history`)

```sql
CREATE TABLE snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,            -- ISO 8601 UTC
  sfi          REAL,
  sunspots     INTEGER,
  a_index      INTEGER,
  k_index      REAL,
  k_index_nt   REAL,
  xray         TEXT,                     -- e.g. "C1.0"
  proton_flux  REAL,
  electron_flux REAL,
  sw_speed     REAL,
  bz           REAL,
  signal_noise TEXT,                     -- e.g. "S0-S1"
  aurora       INTEGER,
  aurora_lat   REAL,
  -- band conditions (Good/Fair/Poor)
  bc_80_40_day TEXT, bc_80_40_night TEXT,
  bc_30_20_day TEXT, bc_30_20_night TEXT,
  bc_17_15_day TEXT, bc_17_15_night TEXT,
  bc_12_10_day TEXT, bc_12_10_night TEXT,
  raw_json     TEXT                      -- full normalized blob, safety net
);
CREATE INDEX idx_snapshots_ts ON snapshots(ts);
```
Retention: keep ~90 days rolling for charts; prune older on cron (or keep — D1 rows are tiny). Charts read a downsampled series so we're not shipping thousands of rows to the client.

---

## 5. Interpretation layer (the differentiator)

Every metric gets a color (green/amber/red) **and** a one-line human reading. Plus one **top-line verdict** synthesizing them.

| Metric | Green | Amber | Red | Plain reading |
|---|---|---|---|---|
| SFI | >120 | 90–120 | <90 | Higher = upper bands (10/12/15m) open |
| Sunspots | >80 | 30–80 | <30 | More spots = more ionization = higher bands |
| K-index | 0–2 | 3–4 | ≥5 | Lower = quieter geomagnetic field = better HF; ≥5 = storm, absorption, aurora |
| A-index | 0–7 | 8–15 | >15 | Daily geomagnetic; lower is better |
| X-ray | A/B | C | M/X | M/X = possible HF blackout on sunlit side (R-scale) |
| Proton flux | normal | elevated | high | High = polar-path degradation |
| Aurora | low | moderate | high | High = 6m/VHF aurora possible, HF high-lat degraded |

**Top-line verdict** examples (generated from the above):
- "Solid HF day — high bands should be open, geomagnetic field quiet. Good window for a 20m/15m POTA run."
- "Bands degraded — K-index 5, geomagnetic storm in progress. Expect noise and weak signals; low bands after dark are your best bet."

**POTA framing block:** "Best bands right now for your grid" derived from local time + band table + MOF; note greyline windows (enhanced low-band propagation at your sunrise/sunset).

### /learn explainer pages (education layer)
Short standalone pages, one per concept (SFI, K/A index, greyline, MUF/foF2, X-ray flares, reading the band table). These double as SEO surface and as source material for the nonprofit's beginner content. Keep each tight and plainspoken.

---

## 6. Grid-square personalization (v1)

**Grid resolution order** (each tier overrides the ones above it; the page never renders empty):
1. **IP-based grid on load** — a Pages Function reads Cloudflare's request geo (`request.cf.latitude` / `longitude`, available with no extra service), converts to Maidenhead, and the page opens on a real location near the visitor — **no prompt, no permission, instant.**
2. **"📍 Use my precise location" button** — opts into the browser **Geolocation API** (HTTPS, automatic on Pages) for GPS-accurate lat/lon → grid. Not fired automatically (avoids an abrupt first-visit prompt); only on click. On deny/dismiss, silently stay on the IP grid.
3. **Manual grid input** — type any Maidenhead grid (4 or 6 char, validated) to point the page anywhere, e.g. checking a park before heading out. Overrides auto-detection and is remembered in `localStorage`.
4. **Fallback `EL87PT`** — only if IP geo is unavailable, so there's always a valid default.

**Everything downstream keys off the resolved grid:**
- Maidenhead → lat/lon. Compute local sunrise/sunset + **greyline windows** (client-side sun-position math, no API).
- Embed KC2G per-grid MOF map: `https://prop.kc2g.com/api/moflof.svg?grid={grid}&metric=mof_sp`.
- Tailor the band recommendation to **local** day/night at the resolved grid, not server time.
- Show which tier is active ("📍 detected: EL87pt · change") so the visitor knows it's their location and can override.

---

## 7. Trend charts

- `GET /api/history?metric=sfi&days=30` → downsampled series from D1.
- Client renders with Chart.js (lightweight, no build step needed):
  - SFI, 30–90 day line
  - K-index, last 7 days (3-hr bars) + forecast overlay
  - Sunspot number trend
- These are the thing paste-in banners can't do — lean into them.

---

## 8. Social feedback loop (first-class feature)

**"Share today's conditions" panel** producing content in the text-overlay/music, no-voiceover format. Dual-purpose now that the tool is a nonprofit asset: TavaOne Education's own outreach **and** Joe's @grumpagrinch ham content. Rules baked in: max 5 hashtags, `#POTA` BANNED → always `#parksOnTheAir`.

**a) Conditions card image** — a clean, branded graphic rendered in two sizes:
- 1080×1920 (TikTok vertical)
- 1080×1080 (Facebook square)
- v1: render an HTML card and export client-side via `html2canvas` → PNG download. (v2 option: server-side SVG→PNG in the Worker for a stable share URL.)
- Card shows SFI / K / top 2 open bands / the one-line verdict / date / **TavaOne Education + solar.tavaoneeducation.org** (W4GGJ optional, selectable for the @grumpagrinch version).

**b) Auto-generated post copy** (copy-to-clipboard block):
- **Overlay text** (short, punchy, stacks on the card): e.g. `SOLAR FLUX 147` / `K-INDEX 1 — QUIET` / `20M WIDE OPEN`
- **Caption:** one-line plain-English verdict + a POTA nudge.
- **Hashtags** — default to the educational/beginner set; selectable. **Rules baked in: max 5 tags, `#POTA` is BANNED, always use `#parksOnTheAir`.**
  - Educational/beginner: `#hamradio #amateurradio #hamtok #learnontiktok #parksOnTheAir`
  - POTA: `#hamradio #hamtok #amateurradio #FT8 #parksOnTheAir`
  - Gear: `#hamradio #hamtok #amateurradio #QRP #parksOnTheAir`
  - FL-specific: `#hamradio #hamtok #Florida #amateurradio #parksOnTheAir`
- **Suggested title.**

**c) Weekly band report** (stretch): a route that summarizes the past 7 days from D1 into a short draft suitable for a The Shack blog post.

---

## 9. Design

- **Inherit the shared shell** (§14A): header, footer, nav, fonts, colors, spacing come from the main site's replicated theme — the solar pages must look like the same site, just a different body. Don't invent a separate visual identity; match `tavaoneeducation.org`. Mobile-first, single-column on phone.
- Above the fold: **top-line verdict** (big, color-coded) → key numbers (SFI, SN, A, K) → band table (day/night × band group, color chips) → grid MOF map.
- Below: trend charts, aurora oval / SDO image, share panel, links to /learn.
- Auto-refresh the live section every 15 min (matches cache TTL); show "updated HH:MM UTC" + source credits.

---

## 10. Attribution / etiquette (required)

- Visible credit: **N0NBH (hamqsl.com)**, **NOAA SWPC** (public domain), **KC2G / GIRO / INGV**.
- Respect the 15-min cache; never hammer HamQSL or KC2G. All third-party fetches server-side + cached.

---

## 11. Build phases

- **Phase 0 — Scaffold + shared shell:** repo, Astro Pages project (with `/api/*` Pages Functions), `solar-cron` Worker, D1, KV, bindings, `README.md`. **Replicate the main site's shell** — read header/footer/nav + CSS/tokens from the attached `tavaone-education` repo and port them into `src/layouts/Shell.astro` so solar renders inside the same skin (§14A). **First deploy creates the Pages project** (`.pages.dev` URL); **then** attach the `solar.tavaoneeducation.org` custom domain (see §2 DNS plan — attach is the *last* step; the zone is already on Cloudflare).
- **Phase 1 — Pipeline:** `solar-cron` fetch + normalize + KV cache + D1 snapshot; `/api/solar` Pages Function; fallback chain.
- **Phase 2 — Dashboard:** live conditions, verdict, band table, auto-refresh, source credits — inside the shared shell.
- **Phase 3 — Teaching layer + /learn:** thresholds, readings, verdict generator, propagation explainer pages (with reciprocal links to the main site's course, §14B).
- **Phase 4 — Grid:** grid resolution (IP auto-detect via Pages Function → optional precise-location button → manual override → EL87PT fallback), Maidenhead math, greyline, KC2G MOF embed, local-time band rec.
- **Phase 5 — Charts:** `/api/history` + Chart.js.
- **Phase 6 — Social:** card export + auto copy/hashtags.
- **Phase 7 — Polish:** SEO/meta, mobile QA; verify the shell matches the main site; confirm the reciprocal links work both directions.

> **Not in this build:** the licensing course, quizzes, and completion certificate — those stay on the main site (`tavaoneeducation.org/course`). The only change needed in the `tavaone-education` repo is a link from the propagation lessons to this solar tool (§14B).

---

## 12. Scaffold (PowerShell)

```powershell
# Workspace has BOTH repos attached: solar-tavaoneedu (this) + tavaone-education (read-only, for the shell).
# From your repos root, e.g. C:\GitHub Repositories
npm create astro@latest solar-tavaoneedu -- --template minimal --no-install --yes
cd solar-tavaoneedu
npm install
npx astro add cloudflare --yes           # Pages adapter; enables /functions (Pages Functions)
npm install chart.js html2canvas

# Shared shell: copy header/footer/nav + CSS/tokens from ..\tavaone-education into src/layouts/Shell.astro (§14A)
# API lives in Pages Functions:  functions/api/*.ts  (same origin, binds D1 + KV)

# Separate cron Worker (Pages Functions can't run cron)
mkdir cron; cd cron
npm create cloudflare@latest solar-cron -- --type=hello-world --no-deploy
# then, from repo root:
#   wrangler d1 create solar_history
#   wrangler kv namespace create SOLAR_CACHE
#   bind D1 (DB) + KV (SOLAR_CACHE) to BOTH the Pages project and solar-cron
#   solar-cron/wrangler.toml: [triggers] crons = ["*/15 * * * *"]
```

## 13. Open items (sensible defaults chosen — tweak if desired)
- Card render: **client-side html2canvas** for v1 (server-side share URL = v2). 
- Refresh/cron cadence: **15 min** (matches HamQSL source cache).
- History retention: **90 days** rolling.
- Default social hashtag set: **educational/beginner** (selectable).

---

## 14. Relationship to the main site (`tavaoneeducation.org`)

The main site is **GitHub Pages** (`w4ggj/tavaone-education`), running the License Census, `/study`, and the licensing **`/course`**. It stays **exactly as designed** — nothing about it moves, rebuilds, or is restyled by this project. Solar connects to it in two ways only: a **shared visual shell** and a **reciprocal link**.

### A. Shared shell — make solar look like the same site
Goal: a visitor feels they never left `tavaoneeducation.org`; they're just in the "solar section." Same header, footer, nav, fonts, colors, spacing — **only the body changes.**

Because the two are different codebases on different hosts, this is done by **replication, not runtime import**:
- Claude Code has the **`tavaone-education` repo attached in the same workspace** — read the actual header/footer/nav markup and the CSS (or design tokens/variables) from it.
- Port that shell into the solar Astro app as a shared layout (e.g. `src/layouts/Shell.astro` + the copied CSS/tokens). The solar pages render inside it; only the body differs.
- Keep the nav working across the hop: the solar header links back to the main site's `/`, `/course`, `/study`, etc., so it reads as one continuous site.
- **Anti-drift note:** copy CSS variables/tokens verbatim where they exist, so a future theme change on the main site is a quick re-sync rather than a guess. (A shared submodule/package is a later option if drift becomes annoying — not needed for v1.)

### B. Reciprocal link — solar as a live example for the course
- The main site's **propagation lessons link out** to this tool as a real-world example ("here's today's live SFI / band conditions"). That's a hyperlink from the course to `solar.tavaoneeducation.org` (or a specific `/learn` page).
- Solar's `/learn` explainers can **link back** to the course ("want your license? take the course"). Also just a hyperlink.
- **No shared code, no shared data, no CORS** — the course does not fetch solar's API; it links to it.

### C. What "solar teaching" means here (in scope)
The `/learn` explainers on this subdomain teach the propagation/space-weather concepts behind the live data (what SFI/K/MUF/greyline mean on the air). They're reference explainers, not a graded course. For context, these are the same concepts the license exams cover — heaviest on **General G3** — which is exactly why the course links here as a live example:

| Concept (solar `/learn`) | Exam topic it supports |
|---|---|
| Solar flux & sunspots; A/K index & geomagnetic activity | General G3A |
| MUF / LUF and band choice | General G3B |
| Ionospheric layers, greyline, NVIS | General G3C |

The graded lessons, question pools, quizzes, and completion certificate are **the course's job on the main site**, not this build.

---

*No app code is written until this plan is approved.*
