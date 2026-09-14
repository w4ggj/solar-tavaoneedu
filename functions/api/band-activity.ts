export interface Env {
  DB: D1Database;
  SOLAR_CACHE: KVNamespace;
}

/** GET /api/band-activity — observed band activity from Mission Control's
 *  WSJT-X decode relay, as written by the solar-cron Worker every 15 min.
 *  Same shape and cache pattern as /api/solar: KV first (fast, 15-min-fresh),
 *  falling back to a 503 until the first cron run lands.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const cached = await context.env.SOLAR_CACHE.get('band-activity', 'json');

  if (cached) {
    return Response.json(cached, {
      headers: {
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  return Response.json(
    { error: 'No band-activity data available yet. The cron worker may not have run.' },
    {
      status: 503,
      headers: { 'Retry-After': '60' },
    }
  );
};
