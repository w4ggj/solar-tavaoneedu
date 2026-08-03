export interface Env {
  DB: D1Database;
}

/** GET /api/history?hours=24 — returns SFI/K-index time-series from D1 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { searchParams } = new URL(context.request.url);
  const hours = Math.min(168, Math.max(1, parseInt(searchParams.get('hours') ?? '24', 10) || 24));
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  try {
    const result = await context.env.DB.prepare(
      `SELECT recorded_at, sfi, k_index, a_index, xray_class
       FROM solar_history
       WHERE recorded_at > ?
       ORDER BY recorded_at ASC
       LIMIT 700`
    )
      .bind(cutoff)
      .all();

    return Response.json(result.results, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch (e) {
    return Response.json({ error: 'Database error' }, { status: 500 });
  }
};
