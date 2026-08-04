const PLASMA_URL = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-7-day.json';
const MAG_URL    = 'https://services.swpc.noaa.gov/products/solar-wind/mag-7-day.json';

/**
 * GET /api/solarwind
 * Returns DSCOVR real-time solar wind: Bz, speed, proton density.
 * Downsampled to 1 reading per 5 minutes over the last hour.
 * Response: { bz, speed, density, updated, series: { labels, bz, speed, density } }
 */
export const onRequestGet: PagesFunction = async () => {
  try {
    const [plasmaRes, magRes] = await Promise.all([
      fetch(PLASMA_URL, { headers: { Accept: 'application/json' } }),
      fetch(MAG_URL,    { headers: { Accept: 'application/json' } }),
    ]);

    if (!plasmaRes.ok || !magRes.ok) {
      return Response.json({ error: 'upstream error' }, { status: 502 });
    }

    const plasma = await plasmaRes.json() as string[][];
    const mag    = await magRes.json() as string[][];

    if (!Array.isArray(plasma) || plasma.length < 2 || !Array.isArray(mag) || mag.length < 2) {
      return Response.json({ error: 'no data' }, { status: 502 });
    }

    // First row is the header
    const ph = plasma[0];
    const mh = mag[0];
    const di  = ph.indexOf('density');
    const si  = ph.indexOf('speed');
    const bzi = mh.indexOf('bz_gsm');
    const bti = mh.indexOf('bt');

    if (di < 0 || si < 0 || bzi < 0) {
      return Response.json({ error: 'schema changed' }, { status: 502 });
    }

    // Build time-indexed mag map for quick lookup
    const magByTime = new Map<string, { bz: number; bt: number }>();
    for (const row of mag.slice(1)) {
      const t  = String(row[0] ?? '');
      const bz = parseFloat(String(row[bzi] ?? 'NaN'));
      const bt = bti >= 0 ? parseFloat(String(row[bti] ?? 'NaN')) : NaN;
      if (t && !isNaN(bz)) magByTime.set(t, { bz, bt });
    }

    // Downsample plasma to ~5-min intervals over last hour, join with mag
    const cutoffMs = Date.now() - 3_600_000;
    const kept: { t: string; bz: number; bt: number; speed: number; density: number }[] = [];
    let lastMs = 0;

    for (const row of plasma.slice(1)) {
      const t    = String(row[0] ?? '');
      const ms   = new Date(t).getTime();
      if (isNaN(ms) || ms < cutoffMs) continue;
      if (ms - lastMs < 5 * 60_000) continue;

      const speed   = parseFloat(String(row[si] ?? 'NaN'));
      const density = parseFloat(String(row[di] ?? 'NaN'));
      if (isNaN(speed) || isNaN(density)) continue;

      // Find mag reading closest in time (within ±2 min)
      const magEntry = magByTime.get(t) ?? [...magByTime.entries()]
        .filter(([mt]) => Math.abs(new Date(mt).getTime() - ms) < 2 * 60_000)
        .sort(([a], [b]) => Math.abs(new Date(a).getTime() - ms) - Math.abs(new Date(b).getTime() - ms))[0]?.[1];

      if (!magEntry) continue;

      kept.push({
        t,
        bz:      Math.round(magEntry.bz * 10) / 10,
        bt:      isNaN(magEntry.bt) ? 0 : Math.round(magEntry.bt * 10) / 10,
        speed:   Math.round(speed),
        density: Math.round(density * 10) / 10,
      });
      lastMs = ms;
    }

    if (!kept.length) {
      return Response.json({ error: 'no recent data' }, { status: 502 });
    }

    const latest = kept[kept.length - 1];

    return Response.json({
      bz:      latest.bz,
      bt:      latest.bt,
      speed:   latest.speed,
      density: latest.density,
      updated: latest.t,
      series: {
        labels:  kept.map(r => r.t),
        bz:      kept.map(r => r.bz),
        bt:      kept.map(r => r.bt),
        speed:   kept.map(r => r.speed),
        density: kept.map(r => r.density),
      },
    }, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
  } catch {
    return Response.json({ error: 'fetch failed' }, { status: 502 });
  }
};
