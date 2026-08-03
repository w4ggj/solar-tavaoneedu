export interface Env {
  DB: D1Database;
  SOLAR_CACHE: KVNamespace;
}

/** GET /api/solar — returns latest solar data from KV cache */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const cached = await context.env.SOLAR_CACHE.get('live', 'json');

  if (cached) {
    return Response.json(cached, {
      headers: {
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  return Response.json(
    { error: 'No solar data available yet. The cron worker may not have run.' },
    {
      status: 503,
      headers: { 'Retry-After': '60' },
    }
  );
};
