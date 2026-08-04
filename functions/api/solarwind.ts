// RTSW 1-minute real-time feed — includes proton_density (confirmed via /api/swdiag)
// rtsw_wind_1m → [{"proton_speed":391.8,"proton_density":1.25,"time_tag":"..."}]
// rtsw_mag_1m  → [{"bt":2.95,"bz_gsm":-0.5,"time_tag":"..."}]
// Arrays sorted oldest-to-newest; last element is most recent.
const RTSW_WIND_URL = 'https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json';
const RTSW_MAG_URL  = 'https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json';

export interface Env {
  SOLAR_CACHE: KVNamespace;
}

interface RtswWindItem { proton_speed: number; proton_density: number; time_tag: string }
interface RtswMagItem  { bt: number; bz_gsm: number; time_tag: string }

async function fetchLive() {
  try {
    const [windRes, magRes] = await Promise.all([
      fetch(RTSW_WIND_URL, { headers: { Accept: 'application/json' } }),
      fetch(RTSW_MAG_URL,  { headers: { Accept: 'application/json' } }),
    ]);
    if (!windRes.ok && !magRes.ok) {
      console.error(`[solarwind] RTSW fetch failed: wind=${windRes.status}, mag=${magRes.status}`);
      return null;
    }
    const windArr = windRes.ok ? await windRes.json() as RtswWindItem[] : [];
    const magArr  = magRes.ok  ? await magRes.json()  as RtswMagItem[]  : [];
    // Last element is most recent
    const windItem = Array.isArray(windArr) && windArr.length > 0 ? windArr[windArr.length - 1] : null;
    const magItem  = Array.isArray(magArr)  && magArr.length  > 0 ? magArr[magArr.length - 1]   : null;

    const speed   = typeof windItem?.proton_speed === 'number' && isFinite(windItem.proton_speed) && windItem.proton_speed > 50
      ? Math.round(windItem.proton_speed) : null;
    const density = typeof windItem?.proton_density === 'number' && isFinite(windItem.proton_density) && windItem.proton_density >= 0
      ? Math.round(windItem.proton_density * 10) / 10 : null;
    const bz      = typeof magItem?.bz_gsm === 'number' && isFinite(magItem.bz_gsm) && Math.abs(magItem.bz_gsm) < 500
      ? Math.round(magItem.bz_gsm * 10) / 10 : null;
    const bt      = typeof magItem?.bt === 'number' && isFinite(magItem.bt) && magItem.bt >= 0
      ? Math.round(magItem.bt * 10) / 10 : null;
    const updated = (windItem?.time_tag ?? magItem?.time_tag ?? null) as string | null;

    if (speed === null && bz === null && bt === null && density === null) return null;

    return { bz, bt, speed, density, updated, series: { labels: [], bz: [], bt: [], speed: [], density: [] } };
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
