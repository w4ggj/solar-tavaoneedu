/**
 * GET /api/stereo-img
 * Serves the NASA STEREO-A EUVI 195 Å beacon image.
 *
 * Strategy:
 *  1. Check KV for the last successfully fetched image (written by the cron
 *     worker every 15 min). If found, serve it immediately — this covers the
 *     common case where the NASA endpoints are blocking hotlinks.
 *  2. On KV miss, try fetching live from each NASA source in order.
 *  3. On live success, write to KV so the next request is a hit.
 *  4. If all sources fail and KV is empty, return 502.
 */

export interface Env {
  SOLAR_CACHE: KVNamespace;
}

const STEREO_SOURCES = [
  'https://stereo-ssc.nascom.nasa.gov/beacon/latest_256_A_195.jpg',
  'https://stereo.gsfc.nasa.gov/img/latest/latest_A_195_256.jpg',
  'https://stereo-ssc.nascom.nasa.gov/browse/latest/latest_256_A_195.jpg',
];

function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  // 1. Try KV cache first
  const cached = await ctx.env.SOLAR_CACHE.getWithMetadata<{ fetched: string; source: string }>('stereo-a-195');
  if (cached.value) {
    const buf = b64ToBuffer(cached.value);
    return new Response(buf, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=900',
        'Access-Control-Allow-Origin': '*',
        'X-Source': 'kv-cache',
        'X-Fetched': cached.metadata?.fetched ?? '',
      },
    });
  }

  // 2. KV miss — try live sources
  for (const url of STEREO_SOURCES) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'TavaOneSolar/1.0 (+https://solar.tavaoneeducation.org)',
          'Accept': 'image/jpeg,image/*',
          'Referer': 'https://stereo-ssc.nascom.nasa.gov/',
        },
      });
      if (!res.ok) continue;

      const buf = await res.arrayBuffer();
      if (buf.byteLength < 1000) continue;

      // 3. Write to KV for next request
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      ctx.waitUntil(
        ctx.env.SOLAR_CACHE.put('stereo-a-195', b64, {
          expirationTtl: 86400,
          metadata: { fetched: new Date().toISOString(), source: url },
        })
      );

      return new Response(buf, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=900',
          'Access-Control-Allow-Origin': '*',
          'X-Source': url,
        },
      });
    } catch {
      // try next source
    }
  }

  // 4. All sources failed
  return new Response('STEREO-A image unavailable', { status: 502 });
};
