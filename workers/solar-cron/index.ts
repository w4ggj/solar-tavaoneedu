/**
 * solar-cron — Cloudflare Worker
 * Runs every 15 minutes, fetches NOAA SWPC data, writes to KV (live cache)
 * and D1 (history). Deployed separately from the Pages project.
 *
 * Phase 1 will implement the full fetch + parse + store logic.
 */

export interface Env {
  DB: D1Database;
  SOLAR_CACHE: KVNamespace;
}

// NOAA SWPC endpoints — all public, no auth required
const SWPC = {
  solarIndices: 'https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json',
  kIndex:       'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json',
  xrayFlux:     'https://services.swpc.noaa.gov/json/goes/primary/xray-fluxes-7-day.json',
  geoAlerts:    'https://services.swpc.noaa.gov/json/alerts.json',
} as const;

export default {
  async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // Phase 1: fetch all SWPC endpoints in parallel, parse, write to KV + D1
    console.log('solar-cron: scheduled run — Phase 1 not yet implemented');
  },
};
