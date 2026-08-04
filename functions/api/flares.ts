const FLARES_URL = 'https://services.swpc.noaa.gov/json/goes/primary/xray-flares-7-day.json';

/**
 * GET /api/flares
 * Returns the most recent solar flare events from GOES X-ray monitoring.
 * Filters to last 7 days, returns up to 20 most recent flares.
 * Response: { flares: Array<{ begin, peak, end, class, region }> }
 */
export const onRequestGet: PagesFunction = async () => {
  try {
    const res = await fetch(FLARES_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) return Response.json({ error: 'upstream error' }, { status: 502 });

    const raw = (await res.json()) as Array<{
      begin_time?: string;
      max_time?: string;
      end_time?: string;
      class?: string;
      noaa_scale?: string | null;
      region?: string | null;
      event_type?: string;
    }>;

    if (!Array.isArray(raw)) return Response.json({ flares: [] });

    // Sort newest-first, take last 20
    const sorted = [...raw]
      .filter(f => f.begin_time && f.class)
      .sort((a, b) => new Date(b.begin_time!).getTime() - new Date(a.begin_time!).getTime())
      .slice(0, 20);

    const flares = sorted.map(f => ({
      begin:  f.begin_time ?? '',
      peak:   f.max_time ?? null,
      end:    f.end_time ?? null,
      cls:    f.class ?? '?',
      region: f.region ?? null,
    }));

    return Response.json({ flares }, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch {
    return Response.json({ error: 'fetch failed' }, { status: 502 });
  }
};
