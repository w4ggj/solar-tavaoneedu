export interface Env {
  SOLAR_CACHE: KVNamespace;
}

const TESTS = [
  'https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json',
  'https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json',
  'https://services.swpc.noaa.gov/json/ace/ace_swepam_1h.json',
  'https://services.swpc.noaa.gov/json/ace/ace_mag_1h.json',
  'https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json',
  'https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json',
];

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const results = await Promise.all(TESTS.map(async (url) => {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const text = await res.text();
      return {
        url,
        status: res.status,
        ok: res.ok,
        contentType: res.headers.get('content-type') ?? '',
        preview: text.slice(0, 300),
      };
    } catch (e: unknown) {
      return { url, status: 0, ok: false, contentType: '', preview: '', error: String(e) };
    }
  }));

  const kvRaw = await context.env.SOLAR_CACHE.get('solarwind', 'text');
  const kv = kvRaw ? JSON.parse(kvRaw) : null;

  return Response.json(
    { results, kv },
    { headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } }
  );
};
