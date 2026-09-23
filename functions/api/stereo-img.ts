/**
 * GET /api/stereo-img
 * Proxies the NASA STEREO-A EUVI 195 Å beacon image.
 * stereo-ssc.nascom.nasa.gov blocks browser hotlinking (403) but
 * allows server-side fetches, so we relay it here.
 */
export const onRequestGet: PagesFunction = async () => {
  const url = 'https://stereo-ssc.nascom.nasa.gov/beacon/latest_256_A_195.jpg';

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'TavaOneSolar/1.0 (solar.tavaoneeducation.org)',
        'Referer': 'https://stereo-ssc.nascom.nasa.gov/',
      },
    });

    if (!res.ok) {
      return new Response('upstream error', { status: 502 });
    }

    const img = await res.arrayBuffer();

    return new Response(img, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=900',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return new Response('fetch failed', { status: 502 });
  }
};
