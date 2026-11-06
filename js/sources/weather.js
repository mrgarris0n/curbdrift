const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const HOUR_MS = 3600000;
const RAIN_HOUR_MM = 0.2;

/** @typedef {{rain72hMm:number, hoursSinceRain:number|null, dryingKWh:number, meanTempC:number}} WeatherSummary */

/** Hourly rain, sun and temperature around center. Times come back in GMT (no zone suffix). */
export async function fetchWeather(center, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const params = new URLSearchParams({
    latitude: center.lat.toFixed(4),
    longitude: center.lon.toFixed(4),
    hourly: 'precipitation,shortwave_radiation,temperature_2m',
    past_days: '3',
    forecast_days: '1',
    timezone: 'GMT',
  });
  const res = await fetchImpl(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`weather HTTP ${res.status}`);
  const body = await res.json();
  if (!body?.hourly?.time) throw new Error('weather: unexpected response');
  return body.hourly;
}

/**
 * Reduce the last 72 hours to what a puddle cares about.
 * - rain72hMm: total precipitation in (now − 72h, now]
 * - hoursSinceRain: hours since the last hour with ≥ 0.2 mm, or null
 * - dryingKWh: Σ shortwave radiation (W/m² over 1h = Wh/m²) after the last rain hour, ÷ 1000
 * - meanTempC: mean temperature over those drying hours (or the whole window if none)
 * @returns {WeatherSummary}
 */
export function summarizeWeather(hourly, now) {
  const start = now.getTime() - 72 * HOUR_MS;
  const hours = [];
  hourly.time.forEach((t, i) => {
    const ms = Date.parse(`${t}:00Z`);
    if (Number.isFinite(ms) && ms > start && ms <= now.getTime()) {
      hours.push({ ms, p: hourly.precipitation[i] ?? 0, sw: hourly.shortwave_radiation[i] ?? 0, t: hourly.temperature_2m[i] });
    }
  });

  const rain72hMm = Math.round(hours.reduce((a, h) => a + h.p, 0) * 100) / 100;
  let lastRain = -1;
  hours.forEach((h, i) => { if (h.p >= RAIN_HOUR_MM) lastRain = i; });
  const after = lastRain >= 0 ? hours.slice(lastRain + 1) : [];
  const tempHours = (after.length ? after : hours).filter((h) => Number.isFinite(h.t));

  return {
    rain72hMm,
    hoursSinceRain: lastRain >= 0 ? Math.round((now.getTime() - hours[lastRain].ms) / HOUR_MS) : null,
    dryingKWh: after.reduce((a, h) => a + h.sw, 0) / 1000,
    meanTempC: tempHours.length ? tempHours.reduce((a, h) => a + h.t, 0) / tempHours.length : 0,
  };
}
