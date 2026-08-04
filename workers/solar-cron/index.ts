export interface Env {
  DB: D1Database;
  SOLAR_CACHE: KVNamespace;
  VAPID_PRIVATE_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_SUBJECT?: string;
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
  plasma7d:    'https://services.swpc.noaa.gov/products/solar-wind/plasma-7-day.json',
  mag7d:       'https://services.swpc.noaa.gov/products/solar-wind/mag-7-day.json',
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
  const raw = last.estimated_kp ?? last.kp_index ?? last.kp;
  const kp = parseFloat(raw);
  return { kp: isNaN(kp) ? null : Math.round(kp * 10) / 10, time: last.time_tag ?? null };
}

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

function parseXray(rows: any[] | null, label = ''): { xclass: string | null; flux: number | null; time: string | null } {
  if (!Array.isArray(rows) || !rows.length) return { xclass: null, flux: null, time: null };

  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const bandRaw = r.energy ?? r.band ?? r.wavelength;
    if (bandRaw != null) {
      const band = String(bandRaw).toLowerCase();
      const isShort = band.includes('0.05') || band.includes('0.4nm') || band.includes('0.4 nm') ||
                      band === 'short' || band.startsWith('short') || band === 'b' || band === 'xrs-b';
      if (isShort) continue;
    }
    const rawFlux = r.observed_flux ?? r.flux ?? r.current_int_xrlong ?? r.flux_observed ??
                    r.xrlong ?? r.xrslong ?? r.long_flux ?? null;
    if (rawFlux == null) continue;
    const flux = typeof rawFlux === 'number' ? rawFlux : parseFloat(String(rawFlux));
    if (!isFinite(flux) || flux <= 0) continue;
    if (flux < 1e-9 || flux > 1e-2) continue;
    const cls: string = r.current_class ?? r.xray_class ?? '';
    const xclass = /^[A-Z]\d/.test(cls) ? cls : fluxToClass(flux);
    return { xclass, flux, time: r.time_tag ?? null };
  }

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

async function backfillKpHistory(env: Env, kpHistRaw: any[] | null): Promise<void> {
  if (!Array.isArray(kpHistRaw) || kpHistRaw.length < 2) return;
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

async function backfillHistory(
  env: Env,
  flux10Raw: any[] | null,
  cycleRaw: any[] | null,
): Promise<void> {
  const { results } = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM solar_history').all();
  if (((results[0] as any)?.cnt ?? 0) >= 48) return;

  const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  const stmts: D1PreparedStatement[] = [];

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

  if (Array.isArray(cycleRaw)) {
    for (const e of cycleRaw) {
      if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
      const tag = e['time-tag'] ?? e.time_tag;
      if (!tag || typeof tag !== 'string') continue;
      const dateStr = tag.slice(0, 7);
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

/* ── Web Push helpers ── */

function toBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = '';
  bytes.forEach(b => { str += String.fromCharCode(b); });
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromBase64Url(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = pad + '=='.slice(0, (4 - pad.length % 4) % 4);
  const bin = atob(padded);
  return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
}

function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

interface PushSub {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Encrypt payload with RFC 8291 (aes128gcm) and send with VAPID authorization */
async function sendWebPush(
  sub: PushSub,
  payloadObj: Record<string, unknown>,
  vapidPrivB64: string,
  vapidPubB64: string,
  subject: string
): Promise<void> {
  const enc = new TextEncoder();
  const payloadStr = JSON.stringify(payloadObj);

  // Ephemeral ECDH sender key pair
  const senderPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const senderPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', senderPair.publicKey));

  // Receiver keys
  const receiverPubBytes = fromBase64Url(sub.p256dh);
  const authSecretBytes  = fromBase64Url(sub.auth);

  const receiverPubKey = await crypto.subtle.importKey(
    'raw', receiverPubBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  // ECDH shared secret
  const ecdhBits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverPubKey }, senderPair.privateKey, 256)
  );

  // RFC 8291 §3.4: IKM = HKDF(salt=auth_secret, IKM=ecdh, info="WebPush: info\0"||recv||send)
  const pushInfo = concatBytes(enc.encode('WebPush: info\x00'), receiverPubBytes, senderPubRaw);
  const ecdhKey  = await crypto.subtle.importKey('raw', ecdhBits, { name: 'HKDF' }, false, ['deriveBits']);
  const ikm = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: authSecretBytes, info: pushInfo },
      ecdhKey, 256
    )
  );

  // Random 16-byte salt for RFC 8188 record
  const recordSalt = crypto.getRandomValues(new Uint8Array(16));

  // CEK + NONCE from record salt + IKM
  const ikmKey = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']);
  const cekInfo   = enc.encode('Content-Encoding: aes128gcm\x00');
  const nonceInfo = enc.encode('Content-Encoding: nonce\x00');

  const cek = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: recordSalt, info: cekInfo }, ikmKey, 128
    )
  );
  const nonce = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: recordSalt, info: nonceInfo }, ikmKey, 96
    )
  );

  // AES-128-GCM encrypt (append \x02 padding delimiter per RFC 8188)
  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const padded  = concatBytes(enc.encode(payloadStr), new Uint8Array([2]));
  const cipher  = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, padded)
  );

  // RFC 8188 body: salt(16) + rs(4 BE uint32=4096) + keyIdLen(1=65) + senderPub(65) + cipher
  const rsBytes = new Uint8Array([0x00, 0x00, 0x10, 0x00]);
  const body    = concatBytes(recordSalt, rsBytes, new Uint8Array([65]), senderPubRaw, cipher);

  // VAPID JWT (RFC 8292)
  const origin     = new URL(sub.endpoint).origin;
  const now        = Math.floor(Date.now() / 1000);
  const jwtHeader  = toBase64Url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const jwtPayload = toBase64Url(enc.encode(JSON.stringify({ aud: origin, exp: now + 43200, sub: subject })));
  const toSign     = `${jwtHeader}.${jwtPayload}`;

  const vapidPrivBytes = fromBase64Url(vapidPrivB64);
  const vapidPrivKey   = await crypto.subtle.importKey(
    'pkcs8', vapidPrivBytes, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const sigBytes = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } }, vapidPrivKey, enc.encode(toSign)
  );
  const jwt = `${toSign}.${toBase64Url(sigBytes)}`;

  const resp = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization:    `vapid t=${jwt},k=${vapidPubB64}`,
      'Content-Type':   'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL:              '86400',
    },
    body,
  });

  if (!resp.ok && resp.status !== 201) {
    const txt = await resp.text().catch(() => '');
    console.error(`solar-cron: push failed ${resp.status} for ${sub.endpoint.slice(0, 60)}: ${txt.slice(0, 100)}`);
    // Remove gone subscriptions
    if (resp.status === 410 || resp.status === 404) {
      console.log(`solar-cron: removing gone subscription`);
    }
  }
}

/** Send push alerts to subscribed users if conditions cross their threshold */
async function sendPushAlerts(env: Env, live: LiveData): Promise<void> {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return;

  const kp    = live.k_index;
  const xray  = live.xray_class;
  const isXM  = xray && /^[XM]/.test(xray);

  if (kp === null && !isXM) return; // nothing to alert about

  let subs: Array<{ endpoint: string; p256dh: string; auth: string; kp_threshold: number }>;
  try {
    const { results } = await env.DB.prepare('SELECT endpoint, p256dh, auth, kp_threshold FROM push_subscriptions').all();
    subs = results as typeof subs;
  } catch {
    return;
  }

  if (!subs.length) return;

  const subject = env.VAPID_SUBJECT ?? 'mailto:alerts@tavaone.edu';

  for (const sub of subs) {
    const kpAlert  = kp !== null && kp >= sub.kp_threshold;
    const xrayAlert = isXM && xray && xray[0] === 'X';

    if (!kpAlert && !xrayAlert) continue;

    let title = 'Solar Alert';
    let body  = '';
    if (kpAlert && kp !== null) {
      title = `Kp ${kp} — Geomagnetic Storm`;
      body  = `Kp index has reached ${kp}. HF polar paths may be disrupted.`;
      if (kp >= 7) body += ' Aurora visible at mid-latitudes.';
    }
    if (xrayAlert && xray) {
      title = `${xray} Solar Flare`;
      body  = body ? `${body} Also: ${xray}-class flare detected.` : `${xray}-class solar flare — HF blackout possible on sunlit side.`;
    }

    try {
      await sendWebPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        { title, body, kp, xray },
        env.VAPID_PRIVATE_KEY,
        env.VAPID_PUBLIC_KEY,
        subject
      );
    } catch (e) {
      console.error('solar-cron: push send error', e);
    }
  }

  if (subs.length > 0) {
    console.log(`solar-cron: push alerts sent to ${subs.length} subscriber(s) — Kp=${kp} Xray=${xray}`);
  }
}

/* ── Solar wind parsing ── */

type SwRow = (string | number | null)[];

interface SolarWindData {
  bz: number | null;
  bt: number | null;
  speed: number | null;
  density: number | null;
  updated: string | null;
  series: {
    labels:  string[];
    bz:      (number | null)[];
    bt:      (number | null)[];
    speed:   number[];
    density: number[];
  };
}

function parseSolarWind(plasma: SwRow[] | null, mag: SwRow[] | null): SolarWindData {
  const empty: SolarWindData = { bz: null, bt: null, speed: null, density: null, updated: null,
    series: { labels: [], bz: [], bt: [], speed: [], density: [] } };
  if (!Array.isArray(plasma) || plasma.length < 2 || !Array.isArray(mag) || mag.length < 2) return empty;

  const ph  = plasma[0] as string[];
  const mh  = mag[0]   as string[];
  const si  = ph.indexOf('speed');
  const di  = ph.indexOf('density');
  const bzi = mh.indexOf('bz_gsm');
  const bti = mh.indexOf('bt');
  if (si < 0 || di < 0 || bzi < 0) { console.log('solar-cron: solarwind schema mismatch', ph, mh); return empty; }

  // Scan backward for most recent row with physically valid values
  let pLatest: { speed: number; density: number; time: string } | null = null;
  for (let i = plasma.length - 1; i >= 1; i--) {
    const row = plasma[i];
    const speed   = parseFloat(String(row[si] ?? 'NaN'));
    const density = parseFloat(String(row[di] ?? 'NaN'));
    if (!isNaN(speed) && speed > 200 && speed < 1500 && !isNaN(density) && density >= 0) {
      pLatest = { speed, density, time: String(row[0] ?? '') };
      break;
    }
  }
  if (!pLatest) { console.log('solar-cron: no valid plasma row found'); return empty; }

  let mLatest: { bz: number; bt: number } | null = null;
  for (let i = mag.length - 1; i >= 1; i--) {
    const row = mag[i];
    const bz = parseFloat(String(row[bzi] ?? 'NaN'));
    if (!isNaN(bz) && bz > -500 && bz < 500) {
      const bt = bti >= 0 ? parseFloat(String(row[bti] ?? 'NaN')) : NaN;
      mLatest = { bz, bt: !isNaN(bt) && bt >= 0 ? bt : 0 };
      break;
    }
  }

  // Build mag lookup for 1-hour chart series
  const magByTime = new Map<string, { bz: number; bt: number }>();
  for (const row of mag.slice(1)) {
    const t  = String(row[0] ?? '');
    const bz = parseFloat(String(row[bzi] ?? 'NaN'));
    const bt = bti >= 0 ? parseFloat(String(row[bti] ?? 'NaN')) : NaN;
    if (t && !isNaN(bz)) magByTime.set(t, { bz, bt: !isNaN(bt) ? bt : 0 });
  }

  const cutoffMs = Date.now() - 3_600_000;
  const labels:  string[]          = [];
  const bzSeries: (number | null)[] = [];
  const btSeries: (number | null)[] = [];
  const speedSeries:   number[]    = [];
  const densitySeries: number[]    = [];
  let lastMs = 0;

  for (const row of plasma.slice(1)) {
    const t  = String(row[0] ?? '');
    const ms = new Date(t).getTime();
    if (isNaN(ms) || ms < cutoffMs) continue;
    if (ms - lastMs < 5 * 60_000) continue;
    const speed   = parseFloat(String(row[si] ?? 'NaN'));
    const density = parseFloat(String(row[di] ?? 'NaN'));
    if (isNaN(speed) || isNaN(density) || speed <= 0) continue;
    const magEntry = magByTime.get(t) ?? [...magByTime.entries()]
      .filter(([mt]) => Math.abs(new Date(mt).getTime() - ms) < 10 * 60_000)
      .sort(([a], [b]) => Math.abs(new Date(a).getTime() - ms) - Math.abs(new Date(b).getTime() - ms))[0]?.[1];
    labels.push(t);
    bzSeries.push(magEntry && !isNaN(magEntry.bz) ? Math.round(magEntry.bz * 10) / 10 : null);
    btSeries.push(magEntry && !isNaN(magEntry.bt) ? Math.round(magEntry.bt * 10) / 10 : null);
    speedSeries.push(Math.round(speed));
    densitySeries.push(Math.round(density * 10) / 10);
    lastMs = ms;
  }

  return {
    bz:      mLatest ? Math.round(mLatest.bz * 10) / 10 : null,
    bt:      mLatest ? Math.round(mLatest.bt * 10) / 10 : null,
    speed:   Math.round(pLatest.speed),
    density: Math.round(pLatest.density * 10) / 10,
    updated: pLatest.time,
    series:  { labels, bz: bzSeries, bt: btSeries, speed: speedSeries, density: densitySeries },
  };
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log('solar-cron: fetch start');

    const [flux10Raw, cycleRaw, kpRaw, xray7dRaw, xray3dRaw, xray1dRaw, alertsRaw, kpHistRaw, plasma7dRaw, mag7dRaw] = await Promise.all([
      fetchJson<any[]>(SWPC.flux10cm),
      fetchJson<any[]>(SWPC.solarCycle),
      fetchJson<any[]>(SWPC.kpCurrent),
      fetchJson<any[]>(SWPC.xrayFlux7d),
      fetchJson<any[]>(SWPC.xrayFlux3d),
      fetchJson<any[]>(SWPC.xrayFlux1d),
      fetchJson<any[]>(SWPC.geoAlerts),
      fetchJson<any[]>(SWPC.kpHistory),
      fetchJson<SwRow[]>(SWPC.plasma7d),
      fetchJson<SwRow[]>(SWPC.mag7d),
    ]);

    const sfi = parseSfi10cm(flux10Raw) ?? parseSfi(cycleRaw);
    const ssn = parseSsn(cycleRaw);
    const { kp, time: kpTime } = parseKp(kpRaw);
    const a_index = kp !== null ? kpToAp(kp) : null;
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

    const solarwind = parseSolarWind(plasma7dRaw, mag7dRaw);
    await Promise.all([
      env.SOLAR_CACHE.put('live', JSON.stringify(live), { expirationTtl: 3600 }),
      env.SOLAR_CACHE.put('solarwind', JSON.stringify(solarwind), { expirationTtl: 3600 }),
    ]);
    console.log(`solar-cron: KV updated — SFI=${sfi} SSN=${ssn} Kp=${kp} Ap=${a_index} Xray=${xclass ?? 'null'} alerts=${alerts.length} SW speed=${solarwind.speed} Bz=${solarwind.bz}`);

    await env.DB.prepare(
      `INSERT INTO solar_history (recorded_at, sfi, a_index, k_index, xray_flux, xray_class, sunspots)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(live.updated, sfi, a_index, kp, xflux, xclass, ssn)
      .run();

    console.log('solar-cron: D1 row inserted');

    await backfillHistory(env, flux10Raw, cycleRaw);
    await backfillKpHistory(env, kpHistRaw);
    await sendPushAlerts(env, live);
  },
};
