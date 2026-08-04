// Actual field names confirmed via /api/swdiag:
// speed → [{"proton_speed":394,"time_tag":"..."}]
// mag   → [{"bt":3,"bz_gsm":0,"time_tag":"..."}]
const SW_SPEED_URL = 'https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json';
const SW_MAG_URL   = 'https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json';

export interface Env {
  SOLAR_CACHE: KVNamespace;
}

async function fetchLive() {
  try {
    const [speedRes, magRes] = await Promise.all([
      fetch(SW_SPEED_URL, { headers: { Accept: 'application/json' } }),
      fetch(SW_MAG_URL,   { headers: { Accept: 'application/json' } }),
    ]);
    if (!speedRes.ok && !magRes.ok) {
      console.error(`[solarwind] summary fetch failed: speed=${speedRes.status}, mag=${magRes.status}`);
      return null;
    }
    const speedArr = speedRes.ok ? await speedRes.json() as Array<Record<string, unknown>> : [];
    const magArr   = magRes.ok  ? await magRes.json()   as Array<Record<string, unknown>> : [];
    const speedItem = Array.isArray(speedArr) && speedArr.length > 0 ? speedArr[0] : null;
    const magItem   = Array.isArray(magArr)   && magArr.length   > 0 ? magArr[0]   : null;

    const speed = typeof speedItem?.proton_speed === 'number' && isFinite(speedItem.proton_speed as number) && (speedItem.proton_speed as number) > 50
      ? Math.round(speedItem.proton_speed as number) : null;
    const bz    = typeof magItem?.bz_gsm === 'number' && isFinite(magItem.bz_gsm as number) && Math.abs(magItem.bz_gsm as number) < 500
      ? Math.round((magItem.bz_gsm as number) * 10) / 10 : null;
    const bt    = typeof magItem?.bt === 'number' && isFinite(magItem.bt as number) && (magItem.bt as number) >= 0
      ? Math.round((magItem.bt as number) * 10) / 10 : null;
    const updated = (speedItem?.time_tag ?? magItem?.time_tag ?? null) as string | null;

    if (speed === null && bz === null && bt === null) return null;

    return { bz, bt, speed, density: null, updated, series: { labels: [], bz: [], bt: [], speed: [], density: [] } };
  } catch (err) {
    console.error('[solarwind] fetchLive threw:', err);
    return null;
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  // 1. Try live NOAA summary fetch (real-time, ~1 min resolution)
  try {
    const live = await fetchLive();
    if (live) {
      return Response.json(live, {
        headers: { 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' },
      });
    }
  } catch (err) {
    console.error('[solarwind] fetchLive threw:', err);
  }

  // 2. Fall back to KV cache populated by the cron worker
  try {
    const cached = await context.env.SOLAR_CACHE.get('solarwind', 'json');
    if (cached) {
      return Response.json(cached, {
        headers: { 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' },
      });
    }
  } catch { /* fall through */ }

  return Response.json(
    { error: 'Solar wind data unavailable' },
    { status: 503, headers: { 'Retry-After': '60' } }
  );
};
