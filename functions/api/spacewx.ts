import type { EventContext } from '@cloudflare/workers-types';

interface ScaleEntry {
  Scale: string;
  Text?: string;
  MinorProb?: string;
  MajorProb?: string;
  Prob?: string;
}

interface NoaaScalesDay {
  DateStamp?: string;
  R?: ScaleEntry;
  S?: ScaleEntry;
  G?: ScaleEntry;
}

type NoaaScales = Record<string, NoaaScalesDay>;

const G_SCALE_TO_KP: Record<number, number> = { 0: 2, 1: 5, 2: 6, 3: 7, 4: 8, 5: 9 };
const DAY_LABELS: Record<string, string> = { '0': 'Today', '1': 'Tomorrow', '2': 'Day+2' };

export async function onRequest(ctx: EventContext<Record<string, unknown>, string, Record<string, unknown>>) {
  const CACHE_TTL = 3600;

  try {
    const res = await fetch('https://services.swpc.noaa.gov/products/noaa-scales.json', {
      headers: { 'User-Agent': 'solar-tavaoneedu/1.0' },
    });
    if (!res.ok) throw new Error(`NOAA ${res.status}`);
    const raw: NoaaScales = await res.json();

    const days = ['0', '1', '2'].map(key => {
      const d = raw[key] ?? {};
      const rScale = parseInt(d.R?.Scale ?? '0', 10);
      const sScale = parseInt(d.S?.Scale ?? '0', 10);
      const gScale = parseInt(d.G?.Scale ?? '0', 10);
      return {
        label: DAY_LABELS[key],
        date: d.DateStamp ?? '',
        rScale,
        rMinor: parseInt(d.R?.MinorProb ?? '0', 10),
        rMajor: parseInt(d.R?.MajorProb ?? '0', 10),
        sScale,
        sProb: parseInt(d.S?.Prob ?? '0', 10),
        gScale,
        gProb: parseInt(d.G?.Prob ?? '0', 10),
        kpMax: G_SCALE_TO_KP[gScale] ?? 2,
      };
    });

    return new Response(JSON.stringify({ days }), {
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
