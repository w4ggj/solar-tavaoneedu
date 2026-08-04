const WWV_URL = 'https://services.swpc.noaa.gov/products/wwv.json';

/** GET /api/wwv — proxies the latest NOAA WWV/WWVH geophysical alert bulletin */
export const onRequestGet: PagesFunction = async () => {
  try {
    const res = await fetch(WWV_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) return Response.json({ error: 'upstream error' }, { status: 502 });
    const data = (await res.json()) as unknown[];
    if (!Array.isArray(data) || !data.length) {
      return Response.json({ error: 'no data' }, { status: 502 });
    }
    return Response.json(data[data.length - 1], {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });
  } catch {
    return Response.json({ error: 'fetch failed' }, { status: 502 });
  }
};
