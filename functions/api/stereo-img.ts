/**
 * GET /api/stereo-img
 * Serves the NASA STEREO-A EUVI 195 Å beacon image.
 *
 * Sources tried in order:
 *  1. KV cache — last good image stored by cron worker (fast path)
 *  2. NASA STEREO-SSC beacon (several URL patterns)
 *  3. Helioviewer API screenshot — public API designed for embedding,
 *     most reliable fallback since it serves from their own CDN
 */

export interface Env {
  SOLAR_CACHE: KVNamespace;
}

const NASA_SOURCES = [
  'https://stereo-ssc.nascom.nasa.gov/beacon/latest_256_A_195.jpg',
  'https://stereo-ssc.nascom.nasa.gov/beacon/latest_512_A_195.jpg',
  'https://stereo.gsfc.nasa.gov/img/latest/latest_A_195_256.jpg',
  'https://stereo.gsfc.nasa.gov/img/latest/latest_A_195_512.jpg',
];

async function fetchHelioviewer(): Promise<ArrayBuffer | null> {
  // Helioviewer public API — sourceId 14 = STEREO-A EUVI 195 Å
  // takeScreenshot returns a JPEG rendered from the latest available image
  const params = new URLSearchParams({
    imageScale: '2.4',
    layers: JSON.stringify([{ sourceId: 14, visible: true, opacity: 100 }]),
    events: '[]',
    eventLabels: 'false',
    scale: 'false',
    scaleType: 'earth',
    scaleX: '-1',
    scaleY: '-1',
    date: new Date().toISOString().slice(0, 19) + 'Z',
    x0: '0',
    y0: '0',
    width: '512',
    height: '512',
    display: 'true',
    watermark: 'false',
  });
  try {
    const res = await fetch(`https://api.helioviewer.org/v2/takeScreenshot/?${params}`, {
      headers: { 'User-Agent': 'TavaOneSolar/1.0 (+https://solar.tavaoneeducation.org)' },
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return buf.byteLength > 1000 ? buf : null;
  } catch {
    return null;
  }
}

function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  // 1. KV cache — fastest, survives NASA outages
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

  // 2. Try NASA sources directly
  for (const url of NASA_SOURCES) {
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
      writeToKv(ctx, buf, url);
      return imageResponse(buf, url);
    } catch { /* try next */ }
  }

  // 3. Helioviewer API — public, designed for embedding
  const hvBuf = await fetchHelioviewer();
  if (hvBuf) {
    writeToKv(ctx, hvBuf, 'helioviewer-api');
    return imageResponse(hvBuf, 'helioviewer-api');
  }

  return new Response('STEREO-A image unavailable', { status: 502 });
};

function imageResponse(buf: ArrayBuffer, source: string): Response {
  return new Response(buf, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=900',
      'Access-Control-Allow-Origin': '*',
      'X-Source': source,
    },
  });
}

function writeToKv(ctx: EventContext<Env, string, unknown>, buf: ArrayBuffer, source: string): void {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  ctx.waitUntil(
    ctx.env.SOLAR_CACHE.put('stereo-a-195', b64, {
      expirationTtl: 86400,
      metadata: { fetched: new Date().toISOString(), source },
    })
  );
}
