const PREDICTED_URL = 'https://services.swpc.noaa.gov/json/solar-cycle/predicted-solar-cycle.json';
const OBSERVED_URL  = 'https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json';

/**
 * GET /api/solarcycle
 * Returns Solar Cycle 25 position data: observed SSN (monthly) + NOAA predicted curve.
 * Covers 2019-12 (cycle start) through predicted end (~2030).
 * Response: { data: [{ t, observed, predicted, high, low }], cycle: 25, currentSsn }
 */
export const onRequestGet: PagesFunction = async () => {
  try {
    const [predictedRes, observedRes] = await Promise.all([
      fetch(PREDICTED_URL, { headers: { Accept: 'application/json' } }),
      fetch(OBSERVED_URL,  { headers: { Accept: 'application/json' } }),
    ]);

    if (!predictedRes.ok) {
      return Response.json({ error: 'upstream error' }, { status: 502 });
    }

    const predicted = await predictedRes.json() as Array<Record<string, any>>;
    if (!Array.isArray(predicted)) return Response.json({ error: 'invalid data' }, { status: 502 });

    // Build observed map: month → smoothed SSN
    const observedMap = new Map<string, number>();
    if (observedRes.ok) {
      const observed = await observedRes.json() as Array<Record<string, any>>;
      if (Array.isArray(observed)) {
        for (const r of observed) {
          const t = r['time-tag'] ?? r.time_tag;
          const ssn = parseFloat(r.smoothed_ssn ?? r.ssn ?? r.observed_ssn ?? 'NaN');
          if (t && !isNaN(ssn) && ssn >= 0) observedMap.set(String(t).slice(0, 7), ssn);
        }
      }
    }

    // Merge predicted + observed; keep from cycle 25 start (2019-12)
    const data = predicted
      .filter(r => {
        const t = r['time-tag'] ?? '';
        return t >= '2019-12';
      })
      .map(r => {
        const t          = String(r['time-tag'] ?? '');
        const month      = t.slice(0, 7);
        const obs        = observedMap.get(month);
        const pred       = parseFloat(r.predicted_ssn ?? r['predicted-ssn'] ?? 'NaN');
        const predHigh   = parseFloat(r.high_ssn ?? r['high-ssn'] ?? 'NaN');
        const predLow    = parseFloat(r.low_ssn  ?? r['low-ssn']  ?? 'NaN');
        return {
          t: month,
          observed:   obs   !== undefined && obs   >= 0 ? Math.round(obs)      : null,
          predicted:  !isNaN(pred)     ? Math.round(pred)      : null,
          high:       !isNaN(predHigh) ? Math.round(predHigh)  : null,
          low:        !isNaN(predLow)  ? Math.round(predLow)   : null,
        };
      })
      .filter(r => r.observed !== null || r.predicted !== null);

    // Current SSN: last observed month
    const lastObs = [...data].reverse().find(r => r.observed !== null);
    const currentSsn = lastObs?.observed ?? null;

    return Response.json(
      { data, cycle: 25, currentSsn },
      { headers: { 'Cache-Control': 'public, max-age=86400' } }
    );
  } catch {
    return Response.json({ error: 'fetch failed' }, { status: 502 });
  }
};
