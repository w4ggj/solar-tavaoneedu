export interface Env {
  DB: D1Database;
  SOLAR_CACHE: KVNamespace;
}

const SWPC = {
  solarFlux: 'https://services.swpc.noaa.gov/products/summary/10cm-flux.json',
  kpCurrent: 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json',
  kpHistory: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
  xrayFlux:  'https://services.swpc.noaa.gov/json/goes/primary/xray-fluxes-7-day.json',
  geoAlerts: 'https://services.swpc.noaa.gov/json/alerts.json',
} as const;

interface LiveData {
  updated: string;
  sfi: number | null;
  k_index: number | null;
  k_index_time: string | null;
  a_index: number | null;
  xray_class: string | null;
  xray_flux: number | null;
  xray_time: string | null;
  alerts: Array<{ issue_datetime: string; product_id: string; headline: string }>;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`SWPC ${res.status}: ${url}`);
      return null;
    }
    return res.json() as Promise<T>;
  } catch (e) {
    console.error(`SWPC fetch error: ${url}`, e);
    return null;
  }
}

function parseSfi(data: Record<string, string> | null): number | null {
  if (!data?.Flux) return null;
  const v = parseFloat(data.Flux);
  return isNaN(v) ? null : v;
}

function parseKp(rows: any[] | null): { kp: number | null; time: string | null } {
  if (!rows?.length) return { kp: null, time: null };
  const last = rows[rows.length - 1];
  // Prefer estimated_kp (real-time every minute), fall back to kp_index (official 3-hour)
  const raw = last.estimated_kp ?? last.kp_index ?? last.kp;
  const kp = parseFloat(raw);
  return {
    kp: isNaN(kp) ? null : Math.round(kp * 10) / 10,
    time: last.time_tag ?? null,
  };
}

function parseAp(rows: any[] | null): number | null {
  if (!rows?.length) return null;
  // First row may be column headers like ["time_tag","Kp","ap","D"]
  const first = rows[0];
  const start = (Array.isArray(first) && typeof first[0] === 'string' && isNaN(Number(first[2]))) ? 1 : 0;
  for (let i = rows.length - 1; i >= start; i--) {
    const row = rows[i];
    let ap: number;
    if (Array.isArray(row)) {
      ap = parseFloat(row[2]);
    } else {
      ap = parseFloat(row.ap ?? row.Ap ?? '-1');
    }
    if (!isNaN(ap) && ap >= 0) return ap;
  }
  return null;
}

function parseXray(rows: any[] | null): { xclass: string | null; flux: number | null; time: string | null } {
  if (!rows?.length) return { xclass: null, flux: null, time: null };
  // Walk backwards to find the most recent entry with a class label
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.current_class) {
      return {
        xclass: r.current_class,
        flux: r.flux ?? r.observed_flux ?? null,
        time: r.time_tag ?? null,
      };
    }
  }
  const last = rows[rows.length - 1];
  return { xclass: null, flux: last.flux ?? last.observed_flux ?? null, time: last.time_tag ?? null };
}

function parseAlerts(rows: any[] | null): LiveData['alerts'] {
  if (!Array.isArray(rows)) return [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return rows
    .filter(a => a.issue_datetime && new Date(a.issue_datetime).getTime() > cutoff)
    .slice(-5)
    .map(a => {
      const lines: string[] = (a.message ?? '').split('\n');
      const headline = lines.find((l: string) =>
        /SUMMARY:|WATCH:|WARNING:|ALERT:|EXTENDED/.test(l)
      ) ?? lines.slice(0, 2).join(' ');
      return {
        issue_datetime: a.issue_datetime,
        product_id: a.product_id ?? '',
        headline: headline.substring(0, 200).trim(),
      };
    });
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log('solar-cron: fetch start');

    const [fluxRaw, kpRaw, apRaw, xrayRaw, alertsRaw] = await Promise.all([
      fetchJson<Record<string, string>>(SWPC.solarFlux),
      fetchJson<any[]>(SWPC.kpCurrent),
      fetchJson<any[]>(SWPC.kpHistory),
      fetchJson<any[]>(SWPC.xrayFlux),
      fetchJson<any[]>(SWPC.geoAlerts),
    ]);

    const sfi = parseSfi(fluxRaw);
    const { kp, time: kpTime } = parseKp(kpRaw);
    const a_index = parseAp(apRaw);
    const { xclass, flux: xflux, time: xtime } = parseXray(xrayRaw);
    const alerts = parseAlerts(alertsRaw);

    const live: LiveData = {
      updated: new Date().toISOString(),
      sfi,
      k_index: kp,
      k_index_time: kpTime,
      a_index,
      xray_class: xclass,
      xray_flux: xflux,
      xray_time: xtime,
      alerts,
    };

    // TTL: 1 hour — survives a few missed cron runs before going stale
    await env.SOLAR_CACHE.put('live', JSON.stringify(live), { expirationTtl: 3600 });
    console.log(`solar-cron: KV updated — SFI=${sfi} Kp=${kp} Ap=${a_index} Xray=${xclass} alerts=${alerts.length}`);

    await env.DB.prepare(
      `INSERT INTO solar_history (recorded_at, sfi, a_index, k_index, xray_flux, xray_class)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(live.updated, sfi, a_index, kp, xflux, xclass)
      .run();

    console.log('solar-cron: D1 row inserted');
  },
};
