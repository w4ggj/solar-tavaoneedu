import type { EventContext } from '@cloudflare/workers-types';

interface NoaaRegion {
  Region?: number;
  Latitude?: string;
  Longitude?: string;
  Mag_Type?: string;
  Spot_Count?: number;
  Area?: number;
  Prob_C?: number;
  Prob_M?: number;
  Prob_X?: number;
  Flare_Rate?: string;
  Updated_UTC?: string;
}

export async function onRequest(ctx: EventContext<Record<string, unknown>, string, Record<string, unknown>>) {
  const CACHE_TTL = 1800;

  try {
    const res = await fetch('https://services.swpc.noaa.gov/json/solar_regions.json', {
      headers: { 'User-Agent': 'solar-tavaoneedu/1.0' },
    });
    if (!res.ok) throw new Error(`NOAA ${res.status}`);
    const raw: NoaaRegion[] = await res.json();

    // Sort by flare potential: ProbM×1 + ProbX×10 (M events matter more than C)
    const scored = raw
      .filter(r => r.Region)
      .map(r => ({
        number: r.Region!,
        lat: r.Latitude ?? '?',
        lon: r.Longitude ?? '?',
        magClass: r.Mag_Type ?? 'Alpha',
        spots: r.Spot_Count ?? 0,
        probC: r.Prob_C ?? 0,
        probM: r.Prob_M ?? 0,
        probX: r.Prob_X ?? 0,
        score: (r.Prob_M ?? 0) + (r.Prob_X ?? 0) * 10,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map(({ score: _score, ...r }) => r);

    const updated = raw[0]?.Updated_UTC ?? new Date().toISOString();

    return new Response(JSON.stringify({ regions: scored, updated }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_TTL}`,
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
