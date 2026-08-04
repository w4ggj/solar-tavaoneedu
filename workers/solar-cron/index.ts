export interface Env {
  DB: D1Database;
  SOLAR_CACHE: KVNamespace;
}

const SWPC = {
  flux10cm:    'https://services.swpc.noaa.gov/products/10cm-flux-30-day.json',
  solarCycle:  'https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json',
  kpCurrent:   'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json',
  kpHistory:   'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
  xrayFlux7d:  'https://services.swpc.noaa.gov/json/goes/primary/xrays-7-day.json',
  xrayFlux3d:  'https://services.swpc.noaa.gov/json/goes/primary/xrays-3-day.json',
  xrayFlux1d:  'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json',
  geoAlerts:   'https://services.swpc.noaa.gov/products/alerts.json',
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
    if (!res.ok) { console.error(`SWPC ${res.status}: ${url}`); return null; }
    return res.json() as Promise<T>;
  } catch (e) {
    console.error(`SWPC fetch error: ${url}`, e);
    return null;
  }
}

/** Daily 10.7 cm flux (30-day series) — most recent non-null entry */
function parseSfi10cm(rows: any[] | null): number | null {
  if (!Array.isArray(rows) || !rows.length) return null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const entry = rows[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const v = parseFloat(entry['flux'] ?? entry['observed_flux'] ?? entry['f10.7'] ?? '-1');
    if (!isNaN(v) && v > 0) return v;
  }
  return null;
}

/** Monthly solar cycle indices — fallback SFI source when daily endpoint fails */
function parseSfi(rows: any[] | null): number | null {
  if (!Array.isArray(rows) || !rows.length) return null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const entry = rows[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const v = parseFloat(
      entry['observed_swpc_solar_flux'] ?? entry['solar_flux'] ?? entry['flux'] ?? '-1'
    );
    if (!isNaN(v) && v > 0) return v;
  }
  return null;
}

function parseSsn(rows: any[] | null): number | null {
  if (!Array.isArray(rows) || !rows.length) return null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const entry = rows[i];
    const v = parseFloat(entry['ssn'] ?? entry['smoothed_ssn'] ?? '-1');
    if (!isNaN(v) && v >= 0) return Math.round(v);
  }
  return null;
}

/** 1-minute Kp stream — last entry is most recent */
function parseKp(rows: any[] | null): { kp: number | null; time: string | null } {
  if (!rows?.length) return { kp: null, time: null };
  const last = rows[rows.length - 1];
  // estimated_kp is real-time (1-min); kp_index is the official 3-hour value
  const raw = last.estimated_kp ?? last.kp_index ?? last.kp;
  const kp = parseFloat(raw);
  return { kp: isNaN(kp) ? null : Math.round(kp * 10) / 10, time: last.time_tag ?? null };
}

// Standard Kp → equivalent 3-hour ap lookup table
const KP_AP: [number, number][] = [
  [0, 0], [0.33, 2], [0.67, 3], [1, 4], [1.33, 5], [1.67, 6],
  [2, 7], [2.33, 9], [2.67, 12], [3, 15], [3.33, 18], [3.67, 22],
  [4, 27], [4.33, 32], [4.67, 39], [5, 48], [5.33, 56], [5.67, 67],
  [6, 80], [6.33, 94], [6.67, 111], [7, 132], [7.33, 154], [7.67, 179],
  [8, 207], [8.33, 236], [8.67, 300], [9, 400],
];

function kpToAp(kp: number): number {
  let best = KP_AP[0];
  let bestDiff = Math.abs(kp - best[0]);
  for (const entry of KP_AP) {
    const diff = Math.abs(kp - entry[0]);
    if (diff < bestDiff) { best = entry; bestDiff = diff; }
  }
  return best[1];
}

function fluxToClass(flux: number): string {
  if (flux >= 1e-4) return 'X' + (flux / 1e-4).toFixed(1);
  if (flux >= 1e-5) return 'M' + (flux / 1e-5).toFixed(1);
  if (flux >= 1e-6) return 'C' + (flux / 1e-6).toFixed(1);
  if (flux >= 1e-7) return 'B' + (flux / 1e-7).toFixed(1);
  return 'A' + (flux / 1e-8).toFixed(1);
}

/** GOES X-ray — walk backwards through entire dataset, long-band (0.1-0.8 nm) only */
function parseXray(rows: any[] | null, label = ''): { xclass: string | null; flux: number | null; time: string | null } {
  if (!Array.isArray(rows) || !rows.length) return { xclass: null, flux: null, time: null };

  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;

    // Band filter: skip entries clearly identified as short-band (0.05–0.4 nm / XRS-B)
    const bandRaw = r.energy ?? r.band ?? r.wavelength;
    if (bandRaw != null) {
      const band = String(bandRaw).toLowerCase();
      const isShort = band.includes('0.05') || band.includes('0.4nm') || band.includes('0.4 nm') ||
                      band === 'short' || band.startsWith('short') || band === 'b' || band === 'xrs-b';
      if (isShort) continue;
    }

    // Flux: try every known/observed NOAA field name; handle number or string
    const rawFlux = r.observed_flux ?? r.flux ?? r.current_int_xrlong ?? r.flux_observed ??
                    r.xrlong ?? r.xrslong ?? r.long_flux ?? null;
    if (rawFlux == null) continue;
    const flux = typeof rawFlux === 'number' ? rawFlux : parseFloat(String(rawFlux));
    if (!isFinite(flux) || flux <= 0) continue;
    // Sanity range: A0.1 background (1e-9) to extreme X-flares (~1e-2)
    if (flux < 1e-9 || flux > 1e-2) continue;

    // X-ray class: use labeled class if present, else derive from flux
    const cls: string = r.current_class ?? r.xray_class ?? '';
    const xclass = /^[A-Z]\d/.test(cls) ? cls : fluxToClass(flux);
    return { xclass, flux, time: r.time_tag ?? null };
  }

  // Diagnostic: log a sample of raw rows so we can see what fields NOAA actually sends
  const sample = rows.filter(r => r && typeof r === 'object' && !Array.isArray(r)).slice(-3);
  console.log(`solar-cron: parseXray(${label}) no match in ${rows.length} rows. sample=${JSON.stringify(sample)}`);
  return { xclass: null, flux: null, time: null };
}

function parseAlerts(rows: any[] | null): LiveData['alerts'] {
  if (!Array.isArray(rows)) return [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return rows
    .filter(a => a.issue_datetime && new Date(a.issue_datetime).getTime() > cutoff)
    .slice(-5)
    .map(a => {
      const lines: string[] = (a.message ?? '').split('\n');
      const headline = lines.find((l: string) => /SUMMARY:|WATCH:|WARNING:|ALERT:|EXTENDED/.test(l))
        ?? lines.slice(0, 2).join(' ');
      return {
        issue_datetime: a.issue_datetime,
        product_id: a.product_id ?? '',
        headline: headline.substring(0, 200).trim(),
      };
    });
}

/** Backfill 30-day Kp/Ap history so the A-index chart has data immediately */
async function backfillKpHistory(env: Env, kpHistRaw: any[] | null): Promise<void> {
  if (!Array.isArray(kpHistRaw) || kpHistRaw.length < 2) return;

  // Guard: only run while few a_index rows exist
  const { results } = await env.DB.prepare(
    'SELECT COUNT(*) AS cnt FROM solar_history WHERE a_index IS NOT NULL'
  ).all();
  if (((results[0] as any)?.cnt ?? 0) >= 40) return;

  const headers = kpHistRaw[0];
  if (!Array.isArray(headers)) return;
  const ti = headers.findIndex((h: string) => /time.?tag/i.test(String(h)));
  const ki = headers.findIndex((h: string) => /^kp$/i.test(String(h)));
  if (ti < 0 || ki < 0) return;

  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  const stmts: D1PreparedStatement[] = [];

  for (const row of kpHistRaw.slice(1)) {
    if (!Array.isArray(row)) continue;
    const tag = String(row[ti] ?? '');
    if (!tag || tag < cutoff) continue;
    const kpVal = parseFloat(String(row[ki] ?? '-1'));
    if (isNaN(kpVal) || kpVal < 0) continue;
    const apVal = kpToAp(kpVal);
    stmts.push(env.DB.prepare(
      `INSERT INTO solar_history (recorded_at, sfi, a_index, k_index, xray_flux, xray_class, sunspots)
       SELECT ?, NULL, ?, ?, NULL, NULL, NULL
       WHERE NOT EXISTS (
         SELECT 1 FROM solar_history
         WHERE recorded_at > datetime(?, '-90 minutes')
           AND recorded_at < datetime(?, '+90 minutes')
       )`
    ).bind(tag, apVal, Math.round(kpVal * 10) / 10, tag, tag));
  }

  if (!stmts.length) return;
  for (let i = 0; i < stmts.length; i += 100) {
    await env.DB.batch(stmts.slice(i, i + 100));
  }
  console.log(`solar-cron: backfilled ${stmts.length} Kp/Ap history rows`);
}

/** Backfill historical SFI/SSN into D1 on first run using already-fetched NOAA data */
async function backfillHistory(
  env: Env,
  flux10Raw: any[] | null,
  cycleRaw: any[] | null,
): Promise<void> {
  const { results } = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM solar_history').all();
  if (((results[0] as any)?.cnt ?? 0) >= 48) return; // skip if >12 h of data already present

  const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  const stmts: D1PreparedStatement[] = [];

  // Daily SFI from 10cm-flux-30-day (handles both object and array-of-arrays formats)
  if (Array.isArray(flux10Raw)) {
    for (const e of flux10Raw) {
      let tag: string | null = null;
      let fluxStr: string | null = null;
      if (Array.isArray(e)) {
        tag = String(e[0]); fluxStr = String(e[1] ?? '');
      } else if (e && typeof e === 'object') {
        tag = e['time-tag'] ?? e.time_tag ?? e.date ?? null;
        fluxStr = String(e.flux ?? e.observed_flux ?? e['observed-flux'] ?? e['f10.7'] ?? '');
      }
      if (!tag || tag === 'time-tag') continue;
      const dateStr = String(tag).slice(0, 10);
      if (dateStr < cutoff) continue;
      const ts = dateStr + 'T12:00:00Z';
      const sfiVal = parseFloat(fluxStr ?? '-1');
      if (isNaN(sfiVal) || sfiVal <= 0) continue;
      stmts.push(env.DB.prepare(
        `INSERT INTO solar_history (recorded_at, sfi, a_index, k_index, xray_flux, xray_class, sunspots)
         SELECT ?, ?, NULL, NULL, NULL, NULL, NULL
         WHERE NOT EXISTS (SELECT 1 FROM solar_history WHERE DATE(recorded_at) = DATE(?))`
      ).bind(ts, sfiVal, ts));
    }
  }

  // Monthly SFI + SSN from solar-cycle indices (fills 60/90-day range)
  if (Array.isArray(cycleRaw)) {
    for (const e of cycleRaw) {
      if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
      const tag = e['time-tag'] ?? e.time_tag;
      if (!tag || typeof tag !== 'string') continue;
      const dateStr = tag.slice(0, 7); // "2025-07"
      if (dateStr < cutoff.slice(0, 7)) continue;
      const ts = dateStr + '-01T12:00:00Z';
      const sfiVal = parseFloat(e.observed_swpc_solar_flux ?? e.solar_flux ?? e.flux ?? '-1');
      const ssnVal = parseFloat(e.observed_ssn ?? e.ssn ?? e.smoothed_ssn ?? '-1');
      if (isNaN(sfiVal) || sfiVal <= 0) continue;
      stmts.push(env.DB.prepare(
        `INSERT INTO solar_history (recorded_at, sfi, a_index, k_index, xray_flux, xray_class, sunspots)
         SELECT ?, ?, NULL, NULL, NULL, NULL, ?
         WHERE NOT EXISTS (SELECT 1 FROM solar_history WHERE DATE(recorded_at) = DATE(?))`
      ).bind(ts, sfiVal, (!isNaN(ssnVal) && ssnVal >= 0) ? Math.round(ssnVal) : null, ts));
    }
  }

  if (stmts.length === 0) return;
  for (let i = 0; i < stmts.length; i += 100) {
    await env.DB.batch(stmts.slice(i, i + 100));
  }
  console.log(`solar-cron: backfilled ${stmts.length} historical rows`);
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log('solar-cron: fetch start');

    const [flux10Raw, cycleRaw, kpRaw, xray7dRaw, xray3dRaw, xray1dRaw, alertsRaw, kpHistRaw] = await Promise.all([
      fetchJson<any[]>(SWPC.flux10cm),
      fetchJson<any[]>(SWPC.solarCycle),
      fetchJson<any[]>(SWPC.kpCurrent),
      fetchJson<any[]>(SWPC.xrayFlux7d),
      fetchJson<any[]>(SWPC.xrayFlux3d),
      fetchJson<any[]>(SWPC.xrayFlux1d),
      fetchJson<any[]>(SWPC.geoAlerts),
      fetchJson<any[]>(SWPC.kpHistory),
    ]);

    const sfi = parseSfi10cm(flux10Raw) ?? parseSfi(cycleRaw);
    const ssn = parseSsn(cycleRaw);
    const { kp, time: kpTime } = parseKp(kpRaw);
    const a_index = kp !== null ? kpToAp(kp) : null;
    // Try 7-day → 3-day → 1-day fallback chain
    let { xclass, flux: xflux, time: xtime } = parseXray(xray7dRaw, '7d');
    if (xclass === null) ({ xclass, flux: xflux, time: xtime } = parseXray(xray3dRaw, '3d'));
    if (xclass === null) ({ xclass, flux: xflux, time: xtime } = parseXray(xray1dRaw, '1d'));
    console.log(`solar-cron: xray7d=${xray7dRaw?.length ?? 'null'} xray3d=${xray3dRaw?.length ?? 'null'} xray1d=${xray1dRaw?.length ?? 'null'} → class=${xclass}`);
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

    await env.SOLAR_CACHE.put('live', JSON.stringify(live), { expirationTtl: 3600 });
    console.log(`solar-cron: KV updated — SFI=${sfi} SSN=${ssn} Kp=${kp} Ap=${a_index} Xray=${xclass ?? 'null'} alerts=${alerts.length}`);

    await env.DB.prepare(
      `INSERT INTO solar_history (recorded_at, sfi, a_index, k_index, xray_flux, xray_class, sunspots)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(live.updated, sfi, a_index, kp, xflux, xclass, ssn)
      .run();

    console.log('solar-cron: D1 row inserted');

    await backfillHistory(env, flux10Raw, cycleRaw);
    await backfillKpHistory(env, kpHistRaw);
  },
};
