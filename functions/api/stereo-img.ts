/**
 * GET /api/stereo-img
 * Proxies the NASA STEREO-A EUVI 195 Å beacon image.
 * Tries multiple sources in order — the primary NASA endpoint blocks
 * browser hotlinking but some mirror URLs allow server-side fetches.
 */

const SOURCES = [
  // Primary NASA STEREO-SSC beacon
  'https://stereo-ssc.nascom.nasa.gov/beacon/latest_256_A_195.jpg',
  // NASA GSFC STEREO gallery
  'https://stereo.gsfc.nasa.gov/img/latest/latest_A_195_256.jpg',
  // Alternative path format on STEREO-SSC
  'https://stereo-ssc.nascom.nasa.gov/browse/latest/latest_256_A_195.jpg',
];

export const onRequestGet: PagesFunction = async () => {
  for (const url of SOURCES) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'TavaOneSolar/1.0 (+https://solar.tavaoneeducation.org)',
          'Accept': 'image/jpeg,image/*',
          'Referer': 'https://stereo-ssc.nascom.nasa.gov/',
        },
        cf: { cacheTtl: 900, cacheEverything: true },
      } as RequestInit);

      if (res.ok) {
        const img = await res.arrayBuffer();
        return new Response(img, {
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=900',
            'Access-Control-Allow-Origin': '*',
            'X-Source': url,
          },
        });
      }
    } catch {
      // try next source
    }
  }

  return new Response('STEREO-A image unavailable from all sources', { status: 502 });
};
