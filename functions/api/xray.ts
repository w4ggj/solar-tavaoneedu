const XRAY_URL = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json';

/**
 * GET /api/xray
 * Proxies the NOAA GOES 6-hour X-ray flux data, downsampled to 1 reading
 * every 5 minutes to keep the payload small (~72 points per 6 hours).
 * Returns { labels: string[], values: number[] } where values are W/m² × 1e7.
 */
export const onRequestGet: PagesFunction = async () => {
  try {
    const res = await fetch(XRAY_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) return Response.json({ error: 'upstream error' }, { status: 502 });
    const raw = (await res.json()) as Array<{
      time_tag: string;
      flux: number;
      energy?: string;
    }>;
    if (!Array.isArray(raw) || !raw.length) {
      return Response.json({ error: 'no data' }, { status: 502 });
    }

    // GOES reports two energy bands (0.05-0.4 nm and 0.1-0.8 nm).
    // We want the long-channel (0.1-0.8 nm) which is the standard X-ray class band.
    const longChannel = raw.filter(r =>
      !r.energy || r.energy === '0.1-0.8nm' || r.energy === '0.1-0.8'
    );
    const source = longChannel.length > 10 ? longChannel : raw;

    // Downsample: keep one point every 5 minutes
    const kept: typeof source = [];
    let lastMs = 0;
    for (const pt of source) {
      const ms = new Date(pt.time_tag).getTime();
      if (isNaN(ms)) continue;
      if (ms - lastMs >= 5 * 60_000) {
        kept.push(pt);
        lastMs = ms;
      }
    }

    // Scale flux to W/m² × 1e7 (so a C1.0 flare = 1.0, M1.0 = 10.0, X1.0 = 100.0)
    const labels = kept.map(r => r.time_tag);
    const values = kept.map(r => Math.max(0, Math.round((r.flux ?? 0) * 1e8) / 10));

    return Response.json({ labels, values }, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch {
    return Response.json({ error: 'fetch failed' }, { status: 502 });
  }
};
