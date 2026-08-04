export interface Env {
  SOLAR_CACHE: KVNamespace;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const cached = await context.env.SOLAR_CACHE.get('solarwind', 'json');

  if (cached) {
    return Response.json(cached, {
      headers: {
        'Cache-Control': 'public, max-age=60',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  return Response.json(
    { error: 'Solar wind data not yet available. The cron worker may not have run.' },
    { status: 503, headers: { 'Retry-After': '60' } }
  );
};
