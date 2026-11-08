import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeWeather } from '../js/sources/weather.js';

const NOW = new Date('2026-11-06T12:00:00Z');

// Build an Open-Meteo-style hourly block (GMT times, no zone suffix) from hour offsets relative to NOW.
function hourly(fromH, toH, fn) {
  const out = { time: [], precipitation: [], shortwave_radiation: [], temperature_2m: [] };
  for (let h = fromH; h <= toH; h++) {
    const t = new Date(NOW.getTime() + h * 3600000).toISOString().slice(0, 16);
    const v = fn(h);
    out.time.push(t);
    out.precipitation.push(v.p ?? 0);
    out.shortwave_radiation.push(v.sw ?? 0);
    out.temperature_2m.push(v.t ?? 10);
  }
  return out;
}

test('no rain → rain72hMm 0, hoursSinceRain null', () => {
  const s = summarizeWeather(hourly(-80, 0, () => ({})), NOW);
  assert.equal(s.rain72hMm, 0);
  assert.equal(s.hoursSinceRain, null);
  assert.equal(s.meanTempC, 10);
});

test('rain then sun', () => {
  const s = summarizeWeather(hourly(-80, 0, (h) => (h === -20 ? { p: 10 } : h > -20 && h < 0 ? { sw: 500 } : {})), NOW);
  assert.equal(s.rain72hMm, 10);
  assert.equal(s.hoursSinceRain, 20);
  assert.equal(s.dryingKWh, 9.5);
});

test('future hours ignored', () => {
  const s = summarizeWeather(hourly(-10, 24, (h) => (h > 0 ? { p: 50 } : {})), NOW);
  assert.equal(s.rain72hMm, 0);
});

test('rain older than 72h ignored', () => {
  const s = summarizeWeather(hourly(-80, 0, (h) => (h === -75 ? { p: 30 } : {})), NOW);
  assert.equal(s.rain72hMm, 0);
});

test('fetchWeather gives up on a request that never answers', async () => {
  const { fetchWeather } = await import('../js/sources/weather.js');
  const impl = (url, init) => new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal.reason));
  });
  await assert.rejects(fetchWeather({ lat: 40.7, lon: -73.9 }, { fetchImpl: impl, timeoutMs: 50 }));
});

test('fetchWeather rejects a 200 response missing hourly arrays', async () => {
  const { fetchWeather } = await import('../js/sources/weather.js');
  const impl = async () => ({ ok: true, status: 200, json: async () => ({ hourly: { time: ['2026-11-05T00:00'] } }) });
  await assert.rejects(fetchWeather({ lat: 40.7, lon: -73.9 }, { fetchImpl: impl }));
});

test('no rain → peakHourMm72h 0, hoursSincePeak null', () => {
  const s = summarizeWeather(hourly(-80, 0, () => ({})), NOW);
  assert.equal(s.peakHourMm72h, 0);
  assert.equal(s.hoursSincePeak, null);
});

test('peakHourMm72h is the wettest hour in the window, hoursSincePeak counts from it', () => {
  const s = summarizeWeather(hourly(-80, 0, (h) => ({ p: { [-30]: 2, [-10]: 12, [-3]: 1 }[h] ?? 0 })), NOW);
  assert.equal(s.peakHourMm72h, 12);
  assert.equal(s.hoursSincePeak, 10);
  assert.equal(s.hoursSinceRain, 3);
});

test('peak ties resolve to the most recent hour', () => {
  const s = summarizeWeather(hourly(-80, 0, (h) => (h === -40 || h === -5 ? { p: 6 } : {})), NOW);
  assert.equal(s.hoursSincePeak, 5);
});

test('peak outside the 72h window or in the future is ignored', () => {
  const s = summarizeWeather(hourly(-80, 24, (h) => (h === -75 || h === 5 ? { p: 40 } : h === -2 ? { p: 3 } : {})), NOW);
  assert.equal(s.peakHourMm72h, 3);
  assert.equal(s.hoursSincePeak, 2);
});
