const PLASMA_URL   = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json';
const MAG_URL      = 'https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json';
const SW_SPEED_URL = 'https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json';
const SW_MAG_URL   = 'https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json';

export interface Env {
  SOLAR_CACHE: KVNamespace;
}

type Row = (string | number | null)[];

function latestPlasma(rows: Row[], si: number, di: number) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const speed   = parseFloat(String(row[si] ?? 'NaN'));
    const density = parseFloat(String(row[di] ?? 'NaN'));
    if (!isNaN(speed) && speed > 200 && speed < 1500 && !isNaN(density) && density >= 0) {
      return { speed, density, time: String(row[0] ?? '') };
    }
  }
  return null;
}

function latestMag(rows: Row[], bzi: number, bti: number) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const bz = parseFloat(String(row[bzi] ?? 'NaN'));
    if (!isNaN(bz) && bz > -500 && bz < 500) {
      const bt = bti >= 0 ? parseFloat(String(row[bti] ?? 'NaN')) : NaN;
      return { bz, bt: !isNaN(bt) && bt >= 0 ? bt : 0 };
    }
  }
  return null;
}

async function fetchLive() {
  const [plasmaRes, magRes] = await Promise.all([
    fetch(PLASMA_URL, { headers: { Accept: 'application/json' } }),
    fetch(MAG_URL,    { headers: { Accept: 'application/json' } }),
  ]);

  if (!plasmaRes.ok || !magRes.ok) {
    console.error(`[solarwind] NOAA fetch failed: plasma=${plasmaRes.status}, mag=${magRes.status}`);
    return null;
  }

  const plasma = await plasmaRes.json() as Row[];
  const mag    = await magRes.json() as Row[];

  if (!Array.isArray(plasma) || plasma.length < 2 || !Array.isArray(mag) || mag.length < 2) return null;

  const ph  = plasma[0] as string[];
  const mh  = mag[0]   as string[];
  const di  = ph.indexOf('density');
  const si  = ph.indexOf('speed');
  const bzi = mh.indexOf('bz_gsm');
  const bti = mh.indexOf('bt');

  if (di < 0 || si < 0 || bzi < 0) return null;

  const pLatest = latestPlasma(plasma.slice(1), si, di);
  const mLatest = latestMag(mag.slice(1), bzi, bti);

  if (!pLatest) return null;

  const magByTime = new Map<string, { bz: number; bt: number }>();
  for (const row of mag.slice(1)) {
    const t  = String(row[0] ?? '');
    const bz = parseFloat(String(row[bzi] ?? 'NaN'));
    const bt = bti >= 0 ? parseFloat(String(row[bti] ?? 'NaN')) : NaN;
    if (t && !isNaN(bz)) magByTime.set(t, { bz, bt: !isNaN(bt) ? bt : 0 });
  }

  const cutoffMs = Date.now() - 3_600_000;
  const seriesLabels:  string[]          = [];
  const seriesBz:      (number | null)[] = [];
  const seriesBt:      (number | null)[] = [];
  const seriesSpeed:   number[]          = [];
  const seriesDensity: number[]          = [];
  let lastMs = 0;

  for (const row of plasma.slice(1)) {
    const t    = String(row[0] ?? '');
    const ms   = new Date(t).getTime();
    if (isNaN(ms) || ms < cutoffMs) continue;
    if (ms - lastMs < 5 * 60_000) continue;
    const speed   = parseFloat(String(row[si] ?? 'NaN'));
    const density = parseFloat(String(row[di] ?? 'NaN'));
    if (isNaN(speed) || isNaN(density) || speed <= 0) continue;
    const magEntry = magByTime.get(t) ?? [...magByTime.entries()]
      .filter(([mt]) => Math.abs(new Date(mt).getTime() - ms) < 10 * 60_000)
      .sort(([a], [b]) => Math.abs(new Date(a).getTime() - ms) - Math.abs(new Date(b).getTime() - ms))[0]?.[1];
    seriesLabels.push(t);
    seriesBz.push(magEntry && !isNaN(magEntry.bz) ? Math.round(magEntry.bz * 10) / 10 : null);
    seriesBt.push(magEntry && !isNaN(magEntry.bt) ? Math.round(magEntry.bt * 10) / 10 : null);
    seriesSpeed.push(Math.round(speed));
    seriesDensity.push(Math.round(density * 10) / 10);
    lastMs = ms;
  }

  return {
    bz:      mLatest ? Math.round(mLatest.bz * 10) / 10 : null,
    bt:      mLatest ? Math.round(mLatest.bt * 10) / 10 : null,
    speed:   Math.round(pLatest.speed),
    density: Math.round(pLatest.density * 10) / 10,
    updated: pLatest.time,
    series: { labels: seriesLabels, bz: seriesBz, bt: seriesBt, speed: seriesSpeed, density: seriesDensity },
  };
}

async function fetchSummary() {
  try {
    const [speedRes, magRes] = await Promise.all([
      fetch(SW_SPEED_URL, { headers: { Accept: 'application/json' } }),
      fetch(SW_MAG_URL,   { headers: { Accept: 'application/json' } }),
    ]);
    if (!speedRes.ok && !magRes.ok) {
      console.error(`[solarwind] summary fetch failed: speed=${speedRes.status}, mag=${magRes.status}`);
      return null;
    }
    const speedData = speedRes.ok ? await speedRes.json() as Record<string, unknown> : null;
    const magData   = magRes.ok  ? await magRes.json()   as Record<string, unknown> : null;

    const speed   = typeof speedData?.WindSpeed === 'number' && isFinite(speedData.WindSpeed as number) && (speedData.WindSpeed as number) > 50
      ? Math.round(speedData.WindSpeed as number) : null;
    const density = typeof speedData?.Density   === 'number' && isFinite(speedData.Density as number) && (speedData.Density as number) >= 0
      ? Math.round((speedData.Density as number) * 10) / 10 : null;
    const bz      = typeof magData?.Bz === 'number' && isFinite(magData.Bz as number) && (magData.Bz as number) > -500 && (magData.Bz as number) < 500
      ? Math.round((magData.Bz as number) * 10) / 10 : null;
    const bt      = typeof magData?.Bt === 'number' && isFinite(magData.Bt as number) && (magData.Bt as number) >= 0
      ? Math.round((magData.Bt as number) * 10) / 10 : null;
    const updated = (speedData?.TimeStamp ?? magData?.TimeStamp ?? null) as string | null;

    if (speed === null && density === null && bz === null && bt === null) return null;

    return { bz, bt, speed, density, updated, series: { labels: [], bz: [], bt: [], speed: [], density: [] } };
  } catch (err) {
    console.error('[solarwind] fetchSummary threw:', err);
    return null;
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  // 1. Try row-based live NOAA fetch (real-time, includes chart series)
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

  // 2. Try summary endpoints (scalar values only, no chart series)
  try {
    const summary = await fetchSummary();
    if (summary) {
      return Response.json(summary, {
        headers: { 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' },
      });
    }
  } catch (err) {
    console.error('[solarwind] fetchSummary threw:', err);
  }

  // 3. Fall back to KV cache populated by the cron worker
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
