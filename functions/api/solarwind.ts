const PLASMA_URL = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-7-day.json';
const MAG_URL    = 'https://services.swpc.noaa.gov/products/solar-wind/mag-7-day.json';

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

    const ph = plasma[0];
    const mh = mag[0];
    const di  = ph.indexOf('density');
    const si  = ph.indexOf('speed');
    const bzi = mh.indexOf('bz_gsm');
    const bti = mh.indexOf('bt');

    if (di < 0 || si < 0 || bzi < 0) {
      return Response.json({ error: 'schema changed' }, { status: 502 });
    }

    // Latest values: take the last non-sentinel row from each file independently.
    // Don't require time alignment — plasma and mag timestamps can drift a few minutes.
    const lastPlasma = plasma[plasma.length - 1];
    const lastMag    = mag[mag.length - 1];

    const latestSpeed   = parseFloat(String(lastPlasma[si]  ?? 'NaN'));
    const latestDensity = parseFloat(String(lastPlasma[di]  ?? 'NaN'));
    const latestBz      = parseFloat(String(lastMag[bzi]    ?? 'NaN'));
    const latestBt      = bti >= 0 ? parseFloat(String(lastMag[bti] ?? 'NaN')) : NaN;
    const latestTime    = String(lastPlasma[0] ?? '');

    // Build mag lookup for series chart
    const magByTime = new Map<string, { bz: number; bt: number }>();
    for (const row of mag.slice(1)) {
      const t  = String(row[0] ?? '');
      const bz = parseFloat(String(row[bzi] ?? 'NaN'));
      const bt = bti >= 0 ? parseFloat(String(row[bti] ?? 'NaN')) : NaN;
      if (t && !isNaN(bz)) magByTime.set(t, { bz, bt });
    }

    // Downsample to ~5-min intervals for the last hour for the chart series.
    // If no mag match within ±10 min, still include plasma point (bz/bt = null).
    const cutoffMs = Date.now() - 3_600_000;
    const seriesLabels:  string[]           = [];
    const seriesBz:      (number | null)[]  = [];
    const seriesBt:      (number | null)[]  = [];
    const seriesSpeed:   number[]           = [];
    const seriesDensity: number[]           = [];
    let lastMs = 0;

    for (const row of plasma.slice(1)) {
      const t    = String(row[0] ?? '');
      const ms   = new Date(t).getTime();
      if (isNaN(ms) || ms < cutoffMs) continue;
      if (ms - lastMs < 5 * 60_000) continue;

      const speed   = parseFloat(String(row[si] ?? 'NaN'));
      const density = parseFloat(String(row[di] ?? 'NaN'));
      if (isNaN(speed) || isNaN(density)) continue;

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

    return Response.json({
      bz:      !isNaN(latestBz)      ? Math.round(latestBz      * 10) / 10 : null,
      bt:      !isNaN(latestBt)      ? Math.round(latestBt      * 10) / 10 : null,
      speed:   !isNaN(latestSpeed)   ? Math.round(latestSpeed)            : null,
      density: !isNaN(latestDensity) ? Math.round(latestDensity * 10) / 10 : null,
      updated: latestTime,
      series: {
        labels:  seriesLabels,
        bz:      seriesBz,
        bt:      seriesBt,
        speed:   seriesSpeed,
        density: seriesDensity,
      },
    }, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
  } catch {
    return Response.json({ error: 'fetch failed' }, { status: 502 });
  }
};
