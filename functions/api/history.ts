export interface Env {
  DB: D1Database;
}

/** GET /api/history?days=7 — returns SFI/A/K history from D1 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { searchParams } = new URL(context.request.url);
  const days = Math.min(parseInt(searchParams.get('days') ?? '7', 10), 90);

  // Phase 1: implement D1 query
  return Response.json(
    { error: 'History endpoint not yet implemented.', days },
    { status: 501 }
  );
};
