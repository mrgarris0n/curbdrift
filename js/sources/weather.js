import { requestSignal } from '../net.js';

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const HOUR_MS = 3600000;
const RAIN_HOUR_MM = 0.2;

/** @typedef {{rain72hMm:number, hoursSinceRain:number|null, peakHourMm72h:number, hoursSincePeak:number|null, evaporationMm:number}} WeatherSummary */

/** Hourly rain and FAO-56 reference evapotranspiration (ET0) around center. Times come back in GMT (no zone suffix). */
export async function fetchWeather(center, { fetchImpl = globalThis.fetch, timeoutMs = 15000, signal } = {}) {
  const params = new URLSearchParams({
    latitude: center.lat.toFixed(4),
    longitude: center.lon.toFixed(4),
    hourly: 'precipitation,et0_fao_evapotranspiration',
    past_days: '3',
    forecast_days: '1',
    timezone: 'GMT',
  });
  const res = await fetchImpl(`${ENDPOINT}?${params}`, { signal: requestSignal(timeoutMs, signal) });
  if (!res.ok) throw new Error(`weather HTTP ${res.status}`);
  const body = await res.json();
  const h = body?.hourly;
  const arrays = [h?.time, h?.precipitation, h?.et0_fao_evapotranspiration];
  if (!arrays.every(Array.isArray)) throw new Error('weather: unexpected response');
  return body.hourly;
}

/**
 * Reduce the last 72 hours to what a puddle cares about.
 * - rain72hMm: total precipitation in (now − 72h, now]
 * - hoursSinceRain: hours since the last hour with ≥ 0.2 mm, or null
 * - peakHourMm72h: precipitation in the wettest single hour of the window
 * - hoursSincePeak: hours since that hour (the latest one on a tie), or null if no hour had ≥ 0.2 mm
 * - evaporationMm: Σ ET0 (mm) over the hours after the last rain hour (0 if it did not rain).
 *   ET0 already folds in sun, temperature, wind and humidity.
 * @returns {WeatherSummary}
 */
export function summarizeWeather(hourly, now) {
  const start = now.getTime() - 72 * HOUR_MS;
  const hours = [];
  hourly.time.forEach((t, i) => {
    const ms = Date.parse(`${t}:00Z`);
    if (Number.isFinite(ms) && ms > start && ms <= now.getTime()) {
      hours.push({ ms, p: hourly.precipitation[i] ?? 0, e: hourly.et0_fao_evapotranspiration[i] ?? 0 });
    }
  });

  const rain72hMm = Math.round(hours.reduce((a, h) => a + h.p, 0) * 100) / 100;
  let lastRain = -1;
  let peak = -1;
  hours.forEach((h, i) => {
    if (h.p >= RAIN_HOUR_MM) lastRain = i;
    if (h.p >= RAIN_HOUR_MM && (peak < 0 || h.p >= hours[peak].p)) peak = i;
  });
  const hoursAgo = (i) => (i >= 0 ? Math.round((now.getTime() - hours[i].ms) / HOUR_MS) : null);
  const after = lastRain >= 0 ? hours.slice(lastRain + 1) : [];

  return {
    rain72hMm,
    hoursSinceRain: hoursAgo(lastRain),
    peakHourMm72h: peak >= 0 ? hours[peak].p : 0,
    hoursSincePeak: hoursAgo(peak),
    evaporationMm: Math.round(after.reduce((a, h) => a + h.e, 0) * 100) / 100,
  };
}
