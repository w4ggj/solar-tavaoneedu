const PROTON_URL = 'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json';

/**
 * GET /api/protons
 * Returns GOES integral proton flux for the >10 MeV channel — the standard
 * S-scale (solar radiation storm) threshold channel.
 * Response: { flux, scale, updated, series: { labels, flux } }
 * flux is in PFU (particle flux units = protons/cm²/s/sr)
 * S-scale: S1=10, S2=100, S3=1000, S4=10000, S5=100000 PFU
 */
export const onRequestGet: PagesFunction = async () => {
  try {
    const res = await fetch(PROTON_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) return Response.json({ error: 'upstream error' }, { status: 502 });

    const raw = (await res.json()) as Array<{
      time_tag: string;
      flux?: number;
      observed_flux?: number;
      corrected_flux?: number;
      energy?: string;
      satellite?: number;
    }>;

    if (!Array.isArray(raw) || !raw.length) {
      return Response.json({ error: 'no data' }, { status: 502 });
    }

    // Keep only the >10 MeV channel (primary S-scale channel)
    const ch10 = raw.filter(r =>
      !r.energy || r.energy === '>10 MeV' || r.energy === '>10'
    );
    const source = ch10.length > 5 ? ch10 : raw;

    // Downsample to one point every 15 minutes
    const kept: { t: string; flux: number }[] = [];
    let lastMs = 0;
    for (const pt of source) {
      const ms = new Date(pt.time_tag).getTime();
      if (isNaN(ms)) continue;
      if (ms - lastMs < 15 * 60_000) continue;
      const flux = pt.flux ?? pt.corrected_flux ?? pt.observed_flux ?? 0;
      if (flux < 0) continue;
      kept.push({ t: pt.time_tag, flux: Math.round(flux * 100) / 100 });
      lastMs = ms;
    }

    if (!kept.length) return Response.json({ error: 'no data' }, { status: 502 });

    const latest = kept[kept.length - 1];
    const f = latest.flux;

    // S-scale: S1≥10, S2≥100, S3≥1000, S4≥10000, S5≥100000 PFU
    const scale = f >= 100000 ? 5 : f >= 10000 ? 4 : f >= 1000 ? 3 : f >= 100 ? 2 : f >= 10 ? 1 : 0;

    return Response.json({
      flux:    latest.flux,
      scale,
      updated: latest.t,
      series: {
        labels: kept.map(r => r.t),
        flux:   kept.map(r => r.flux),
      },
    }, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch {
    return Response.json({ error: 'fetch failed' }, { status: 502 });
  }
};
