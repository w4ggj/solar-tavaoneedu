export interface Env {
  DB: D1Database;
  VAPID_PUBLIC_KEY?: string;
}

/**
 * GET  /api/push-subscribe  → { publicKey }
 * POST /api/push-subscribe  → save subscription  (body: { endpoint, p256dh, auth, kpThreshold })
 * DELETE /api/push-subscribe → remove subscription (body: { endpoint })
 */
export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const method = request.method.toUpperCase();

  if (method === 'GET') {
    const key = env.VAPID_PUBLIC_KEY ?? '';
    return Response.json({ publicKey: key });
  }

  if (method === 'POST') {
    let body: any;
    try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }

    const { endpoint, p256dh, auth, kpThreshold = 4 } = body ?? {};
    if (!endpoint || !p256dh || !auth) {
      return Response.json({ error: 'missing fields' }, { status: 400 });
    }
    if (typeof endpoint !== 'string' || !endpoint.startsWith('http')) {
      return Response.json({ error: 'invalid endpoint' }, { status: 400 });
    }

    try {
      await env.DB.prepare(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, kp_threshold)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           kp_threshold = excluded.kp_threshold`
      ).bind(endpoint, String(p256dh), String(auth), Number(kpThreshold)).run();
      return Response.json({ ok: true });
    } catch {
      return Response.json({ error: 'db error' }, { status: 500 });
    }
  }

  if (method === 'DELETE') {
    let body: any;
    try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
    const { endpoint } = body ?? {};
    if (!endpoint) return Response.json({ error: 'missing endpoint' }, { status: 400 });
    try {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
      return Response.json({ ok: true });
    } catch {
      return Response.json({ error: 'db error' }, { status: 500 });
    }
  }

  return Response.json({ error: 'method not allowed' }, { status: 405 });
};
