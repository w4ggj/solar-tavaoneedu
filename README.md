# TavaOne Solar

Solar and space-weather dashboard for amateur radio at [solar.tavaoneeducation.org](https://solar.tavaoneeducation.org).

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Astro (static) → Cloudflare Pages |
| API | Cloudflare Pages Functions (`/functions/api/*`) |
| Scheduled fetch | `workers/solar-cron` — Cloudflare Worker, 15-min cron |
| History | Cloudflare D1 (SQLite) |
| Live cache | Cloudflare KV |

## Local dev

```powershell
# Install deps
npm install

# Astro dev server (no API — stubs only)
npm run dev

# Preview Pages Functions with real bindings
npx wrangler pages dev ./dist --d1=DB --kv=SOLAR_CACHE
```

## Build

```powershell
npm run build
```

Output: `./dist`

## Deploy

Cloudflare Pages is connected to this repo. Push to `main` triggers a production deploy automatically.

For the solar-cron worker (separate deploy):

```powershell
cd workers/solar-cron
npx wrangler deploy
```

## First-time Cloudflare setup

1. Create D1 database:
   ```powershell
   npx wrangler d1 create solar-history
   ```
2. Create KV namespace:
   ```powershell
   npx wrangler kv:namespace create SOLAR_CACHE
   ```
3. Update the `database_id` and `id` values in `wrangler.toml` and `workers/solar-cron/wrangler.toml`
4. Connect this GitHub repo to a new Cloudflare Pages project in the dashboard
   - Build command: `npm run build`
   - Build output dir: `dist`
5. Add `solar.tavaoneeducation.org` CNAME → Pages project in Cloudflare DNS

## Project structure

```
solar-tavaoneedu/
├── src/
│   ├── layouts/Shell.astro     # header + nav + footer (the shell)
│   ├── styles/global.css       # design tokens — matches tavaoneeducation.org
│   └── pages/
│       ├── index.astro         # dashboard
│       ├── learn/index.astro   # propagation explainers
│       └── grid/index.astro    # Maidenhead grid map
├── functions/api/              # Cloudflare Pages Functions (/api/*)
│   ├── solar.ts                # GET /api/solar — live data from KV
│   └── history.ts              # GET /api/history — D1 time-series
├── workers/solar-cron/         # Separate Cloudflare Worker
│   ├── index.ts                # 15-min cron — NOAA SWPC → KV + D1
│   └── wrangler.toml
├── public/                     # Static assets
├── astro.config.mjs
├── wrangler.toml               # Pages config (D1 + KV bindings)
└── package.json
```
