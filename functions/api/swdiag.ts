export interface Env {
  SOLAR_CACHE: KVNamespace;
}

const TESTS = [
  'https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json',
  'https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json',
  'https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json',
  'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json',
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
