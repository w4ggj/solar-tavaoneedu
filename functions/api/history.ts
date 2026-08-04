export interface Env {
  DB: D1Database;
}

const KFORECAST_URL =
  'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';

/** GET /api/history
 *
 * New metric mode:
 *   ?metric=sfi&days=30      → {labels, values}  daily SFI averages
 *   ?metric=kindex&days=7    → {labels, values}  3-hour Kp bucket averages
 *   ?metric=sunspots&days=30 → {labels, values}  daily sunspot averages
 *   ?metric=kforecast        → raw NOAA forecast array (proxied)
 *
 * Legacy sparkline mode (no metric param):
 *   ?hours=24                → raw rows array (recorded_at, sfi, k_index, a_index, xray_class)
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { searchParams } = new URL(context.request.url);
  const metric = searchParams.get('metric');

  // ── Legacy mode: sparklines ──────────────────────────────────────────────
  if (!metric) {
    const hours = Math.min(168, Math.max(1, parseInt(searchParams.get('hours') ?? '24', 10) || 24));
    const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();
    try {
      const result = await context.env.DB.prepare(
        `SELECT recorded_at, sfi, k_index, a_index, xray_class
         FROM solar_history WHERE recorded_at > ?
         ORDER BY recorded_at ASC LIMIT 700`
      ).bind(cutoff).all();
      return Response.json(result.results, { headers: { 'Cache-Control': 'public, max-age=300' } });
    } catch {
      return Response.json({ error: 'database error' }, { status: 500 });
    }
  }

  // ── K-index forecast proxy ───────────────────────────────────────────────
  if (metric === 'kforecast') {
    try {
      const res = await fetch(KFORECAST_URL, { headers: { Accept: 'application/json' } });
      if (!res.ok) return Response.json({ error: 'upstream error' }, { status: 502 });
      return Response.json(await res.json(), { headers: { 'Cache-Control': 'public, max-age=900' } });
    } catch {
      return Response.json({ error: 'fetch failed' }, { status: 502 });
    }
  }

  // ── Metric mode: downsampled D1 series ──────────────────────────────────
  const days = Math.min(90, Math.max(1, parseInt(searchParams.get('days') ?? '30', 10) || 30));
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

  let query: string;
  if (metric === 'kindex') {
    // 3-hour bucket averages (56 buckets max for 7 days)
    query = `
      SELECT
        strftime('%Y-%m-%dT', recorded_at) ||
        printf('%02d', (CAST(strftime('%H', recorded_at) AS INTEGER) / 3) * 3) ||
        ':00:00Z' AS bucket,
        ROUND(AVG(k_index), 1) AS value
      FROM solar_history
      WHERE recorded_at > ? AND k_index IS NOT NULL
      GROUP BY bucket
      ORDER BY bucket ASC
      LIMIT 60
    `;
  } else if (metric === 'aindex') {
    query = `
      SELECT strftime('%Y-%m-%d', recorded_at) AS bucket, ROUND(AVG(a_index), 0) AS value
      FROM solar_history
      WHERE recorded_at > ? AND a_index IS NOT NULL
      GROUP BY bucket
      ORDER BY bucket ASC
      LIMIT 90
    `;
  } else if (metric === 'sunspots') {
    query = `
      SELECT strftime('%Y-%m-%d', recorded_at) AS bucket, ROUND(AVG(sunspots), 0) AS value
      FROM solar_history
      WHERE recorded_at > ? AND sunspots IS NOT NULL
      GROUP BY bucket
      ORDER BY bucket ASC
      LIMIT 90
    `;
  } else {
    // sfi (default)
    query = `
      SELECT strftime('%Y-%m-%d', recorded_at) AS bucket, ROUND(AVG(sfi), 1) AS value
      FROM solar_history
      WHERE recorded_at > ? AND sfi IS NOT NULL
      GROUP BY bucket
      ORDER BY bucket ASC
      LIMIT 90
    `;
  }

  try {
    const result = await context.env.DB.prepare(query).bind(cutoff).all();
    const rows = result.results as Array<{ bucket: string; value: number }>;
    return Response.json(
      { labels: rows.map(r => r.bucket), values: rows.map(r => r.value) },
      { headers: { 'Cache-Control': 'public, max-age=600' } }
    );
  } catch {
    return Response.json({ error: 'database error' }, { status: 500 });
  }
};
