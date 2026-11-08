#!/usr/bin/env python3
"""Check the puddle constants in js/scoring.js against FloodNet street-flood sensors.

FloodNet (NYC Open Data kb2e-tjy3 sensors, aq7i-eu5q events) records every flood of 10 mm or
more at ~425 non-tidal street sensors. This replays the weather the app itself reads (Open-Meteo's
archived forecasts, the same models as its live forecast API) against those events, storm by
storm, and reports:

  1. which clock the event timestamps use (rain should peak at the flood onsets);
  2. whether a storm's peak hour or its total predicts floods better (the Phase 1 burst term);
  3. flood odds by peak intensity, and the intensity reference R in min(peak / R, 1) that
     ranks storms best inside the app's wetness = max(min(total / 20, 1), min(peak / R, 1));
  4. how often sensors off DEP's flood map flood, relative to those on it, at equal storm
     intensity (the susceptibility factor), with a by-sensor bootstrap interval;
  5. for each 311 puddle type, how much its complaints concentrate on rain days, which gives
     DESCRIPTOR_WEIGHT (Nov 2025 to Nov 2026, citywide 311 counts; New York against Central Park
     rain, Chicago against Midway);
  6. the drying term: evaporation as 1.05 × FAO-56 reference evapotranspiration (ET0), against
     the earlier sunshine-and-temperature guess and the energy limit (all sunshine evaporating
     water, 0.68 kWh/m² per mm), day by day at Central Park.
  7. 311 flooding complaints around storms, per borough (2023-06 to 2026-10): excess complaints
     over the dry-weather rate by storm total (backs the 20 mm "fully wet" scale) and by hours
     since the rain ended (the burst's 24 h fade; reporting delay makes this an upper bound).

What it cannot check: FloodNet floods drain in about half an hour, so it says nothing about how
long a puddle lingers (the drying term and the burst's 24 h decay) or about puddles left by
drizzle that never floods a street (the 20 mm total scale). Its storm-level check (3) uses rain
totals and peaks only, so changing the drying term cannot move it. The drying term rests on
physics instead (6).

    python3 -m venv ~/.cache/curbdrift-flood && ~/.cache/curbdrift-flood/bin/pip install numpy
    ~/.cache/curbdrift-flood/bin/python scripts/calibrate-puddles.py

Downloads are cached in ~/.cache/curbdrift-calibration (the weather is ~70 MB and costs ~1,700
of Open-Meteo's 10,000 daily free calls); delete that folder to refresh.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path.home() / '.cache' / 'curbdrift-calibration'
START, END = '2021-06-01', '2026-11-01'  # archived forecasts start mid-2021
T0 = datetime.fromisoformat(START).replace(tzinfo=timezone.utc)
CELL_DEG = 0.05  # sensors are grouped onto this grid for weather (the model grid is ~3 km)
CLUSTER_M = 30  # js/sources/complaints.js
RAIN_HOUR_MM = 0.2  # js/sources/weather.js
STORM_GAP_H = 3
BANDS = [0.2, 1, 2.5, 5, 7.6, 10, 15, 25, float('inf')]
DESC_START, DESC_END = '2025-11-01', '2026-11-01'  # one year of 311 puddle complaints
PUDDLE_DESCRIPTORS = [  # js/sources/complaints.js
    'Catch Basin Clogged/Flooding (Use Comments) (SC)', 'Street Flooding (SJ)', 'Flooding on Street', 'Catch Basin Clogged',
    'Catch Basin Sunken/Damaged/Raised (SC1)', 'Catch Basin Sunken', 'Catch Basin Grating Missing (SA4)',
]
CHICAGO_PUDDLE_TYPES = [  # js/sources/complaints-chicago.js
    'Water On Street Complaint', 'Alley Sewer Inspection Request', 'Sewer Cleaning Inspection Request', 'Sewer Cave-In Inspection Request',
]


def get_json(url, tries=5):
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=180) as res:
                return json.load(res)
        except Exception as err:  # network hiccups and 429s: back off and retry
            if attempt == tries - 1:
                sys.exit(f'calibrate: {url[:80]}… failed: {err}')
            time.sleep(30)


def cached(name, fetch):
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(fetch()))
    return json.loads(path.read_text())


def socrata(dataset, select):
    q = urllib.parse.urlencode({'$limit': 50000, '$select': select})
    return lambda: get_json(f'https://data.cityofnewyork.us/resource/{dataset}.json?{q}')


def hour(ts):
    d = datetime.fromisoformat(ts[:19]).replace(tzinfo=timezone.utc)
    return int((d - T0).total_seconds() // 3600)


def cell_of(s):
    snap = lambda v: round(round(float(v) / CELL_DEG) * CELL_DEG, 2)
    return f"{snap(s['latitude'])},{snap(s['longitude'])}"


def fetch_weather(cells):
    out = {}
    for i, c in enumerate(cells):
        lat, lon = c.split(',')
        q = urllib.parse.urlencode({'latitude': lat, 'longitude': lon, 'start_date': START, 'end_date': END,
                                    'hourly': 'precipitation', 'timezone': 'GMT'})
        d = get_json(f'https://historical-forecast-api.open-meteo.com/v1/forecast?{q}')
        out[c] = [0 if v is None else v for v in d['hourly']['precipitation']]
        print(f'  weather {i + 1}/{len(cells)}', file=sys.stderr)
        time.sleep(7)  # stay well under 600 weighted calls a minute
    return out


def auc(score, y):
    order = np.argsort(score, kind='mergesort')
    ranks = np.empty(len(score))
    ranks[order] = np.arange(1, len(score) + 1)
    _, inv, cnt = np.unique(score, return_inverse=True, return_counts=True)
    ranks = (np.bincount(inv, ranks) / cnt)[inv]  # ties share their mean rank
    n1 = y.sum()
    return (ranks[y].sum() - n1 * (n1 + 1) / 2) / (n1 * (len(y) - n1))


def risk_ratio(off_map, band, flooded, idx):
    """Mantel–Haenszel risk ratio, off-map vs on-map, stratified by storm-peak band."""
    num = den = 0.0
    for b in range(len(BANDS) - 1):
        m = idx[band[idx] == b]
        if not m.size:
            continue
        off, on = m[off_map[m]], m[~off_map[m]]
        num += flooded[off].sum() * on.size / m.size
        den += flooded[on].sum() * off.size / m.size
    return num / den


def main():
    sensors = [s for s in cached('sensors.json', socrata('kb2e-tjy3', 'sensor_id,date_installed,date_removed,tidally_influenced,latitude,longitude'))
               if s.get('tidally_influenced') == 'No']
    events = cached('events.json', socrata('aq7i-eu5q', 'sensor_id,flood_start_time'))
    rain = {c: np.array(v, float) for c, v in cached(f'weather-{START}-{END}.json', lambda: fetch_weather(sorted({cell_of(s) for s in sensors}))).items()}
    points = np.array(json.loads((ROOT / 'assets' / 'flood.json').read_text())['points'])
    n_hours = len(next(iter(rain.values())))

    starts = defaultdict(list)
    for e in events:
        starts[e['sensor_id']].append(hour(e['flood_start_time']))
    starts = {k: np.array(v) for k, v in starts.items()}

    # 1. Clock check: rain around onsets, by assumed offset.
    print('1. Event clock: mean rain (mm) in the onset hour or the one before, by offset added to the timestamps')
    by_id = {s['sensor_id']: s for s in sensors}
    for off in range(-2, 7):
        vals = [max(rain[cell_of(by_id[k])][h + off], rain[cell_of(by_id[k])][h + off - 1])
                for k, hs in starts.items() if k in by_id for h in hs if 1 <= h + off < n_hours]
        print(f'   {off:+d} h: {np.mean(vals):.2f}')
    print('   (UTC timestamps peak at +1 h, since Open-Meteo labels each hour\'s rain at its end; New York time would peak at +4/+5)')

    # Storms per weather cell: rain hours with gaps of at most STORM_GAP_H.
    storms = {}
    for c, p in rain.items():
        idx = np.flatnonzero(p >= RAIN_HOUR_MM)
        breaks = np.flatnonzero(np.diff(idx) > STORM_GAP_H)
        bounds = zip(np.r_[idx[0], idx[breaks + 1]], np.r_[idx[breaks], idx[-1]])
        storms[c] = [(a, b, p[a:b + 1].max(), p[a:b + 1].sum()) for a, b in bounds]

    rows = []  # sensor index, off map, peak, total, flooded
    end_h = n_hours - 1
    for i, s in enumerate(sensors):
        lat, lon = float(s['latitude']), float(s['longitude'])
        dy = (points[:, 1] - lat) * 111320
        dx = (points[:, 0] - lon) * 111320 * np.cos(np.radians(lat))
        off_map = (dx * dx + dy * dy).min() > CLUSTER_M ** 2
        first = max(hour(s['date_installed']), 0)
        last = min(hour(s['date_removed']), end_h) if s.get('date_removed') else end_h
        st = starts.get(s['sensor_id'], np.array([]))
        for a, b, peak, total in storms[cell_of(s)]:
            if a < first or b > last:
                continue
            rows.append((i, off_map, peak, total, bool(st.size and ((st >= a - 1) & (st <= b + 2)).any())))
    sid, off_map, peak, total, flooded = (np.array(col) for col in zip(*rows))
    print(f'\n{len(rows)} sensor-storms at {len(sensors)} non-tidal sensors, {flooded.sum()} flooded ({flooded.mean():.1%}); '
          f'{len(set(sid[~off_map]))} sensors on the flood map')

    print(f'\n2. Predicting floods (AUC): storm peak hour {auc(peak, flooded):.3f}, storm total {auc(total, flooded):.3f}')

    band = np.digitize(peak, BANDS) - 1
    print('\n3. Share of storms that flood, by peak mm/h       on map           off map')
    for b in range(len(BANDS) - 1):
        cells = [f'{flooded[m].mean():6.1%} ({m.sum():5d})' for m in ((band == b) & ~off_map, (band == b) & off_map)]
        print(f'   {BANDS[b]:5.1f}–{BANDS[b + 1]:<5}   {cells[0]}   {cells[1]}')
    print('   AUC of the app\'s wetness term by intensity reference R:')
    for r in (5, 7.6, 10, 15, 25):
        print(f'     R = {r:4}: {auc(np.maximum(np.minimum(total / 20, 1), np.minimum(peak / r, 1)), flooded):.4f}')

    rr = risk_ratio(off_map, band, flooded, np.arange(len(rows)))
    groups = [np.flatnonzero(sid == i) for i in np.unique(sid)]
    rng = np.random.default_rng(1)
    boot = [risk_ratio(off_map, band, flooded, np.concatenate([groups[j] for j in rng.integers(len(groups), size=len(groups))]))
            for _ in range(300)]
    print(f'\n4. Off-map vs on-map flood rate at equal storm peak: {rr:.2f} '
          f'(95% interval resampling sensors: {np.percentile(boot, 2.5):.2f}–{np.percentile(boot, 97.5):.2f})')

    for city in WEIGHT_CITIES:
        descriptor_weights(city)
    drying()
    complaints_around_storms()


WEIGHT_CITIES = [
    {'label': 'New York', 'key': 'nyc', 'url': 'https://data.cityofnewyork.us/resource/erm2-nwe9.json', 'field': 'descriptor',
     'where': "complaint_type in('Sewer','Sewer Maintenance')", 'used': PUDDLE_DESCRIPTORS, 'controls': [],
     'rain': (40.7812, -73.9665, 'America/New_York', 'Central Park'), 'cache': ('311-daily', 'rain-central-park')},
    {'label': 'Chicago', 'key': 'chicago', 'url': 'https://data.cityofchicago.org/resource/v6vf-nfxy.json', 'field': 'sr_type',
     'where': 'true', 'used': CHICAGO_PUDDLE_TYPES,
     # Shown, not used: rain-driven but indoors / a defect type that should not follow rain.
     'controls': ['Water in Basement Complaint', 'Sidewalk Inspection Request'],
     'rain': (41.7868, -87.7522, 'America/Chicago', 'Midway'), 'cache': ('chicago-311-daily', 'rain-midway')},
]


def descriptor_weights(city):
    """Share of each complaint type filed on a rain day (≥ 2 mm that day or the day before)."""
    types = city['used'] + city['controls']
    quoted = ','.join("'" + d.replace("'", "''") + "'" for d in types)
    f = city['field']
    q = urllib.parse.urlencode({
        '$select': f'date_trunc_ymd(created_date) as day, {f}, count(*) as n',
        '$where': f"created_date >= '{DESC_START}' AND created_date < '{DESC_END}' AND {city['where']} AND {f} in({quoted})",
        '$group': f'day, {f}', '$limit': 50000,
    })
    counts = cached(f"{city['cache'][0]}-{DESC_START}-{DESC_END}.json", lambda: get_json(f"{city['url']}?{q}"))
    lat, lon, tz, place = city['rain']
    w = urllib.parse.urlencode({'latitude': lat, 'longitude': lon, 'start_date': '2025-10-31', 'end_date': DESC_END,
                                'daily': 'precipitation_sum', 'timezone': tz})
    daily = cached(f"{city['cache'][1]}-{DESC_START}-{DESC_END}.json", lambda: get_json(f'https://archive-api.open-meteo.com/v1/archive?{w}'))['daily']
    rain = {d: (v or 0) for d, v in zip(daily['time'], daily['precipitation_sum'])}
    days = list(rain)
    wet = {d: rain[d] >= 2 or rain[days[i - 1]] >= 2 for i, d in enumerate(days) if i}
    base = np.mean([wet[d] for d in wet if d < DESC_END])
    n, on_rain = defaultdict(int), defaultdict(int)
    for r in counts:
        day = r['day'][:10]
        n[r[f]] += int(r['n'])
        on_rain[r[f]] += int(r['n']) * wet[day]
    triggered = {d: max(0.0, (on_rain[d] / n[d] - base) / (1 - base)) for d in n}
    top = max(triggered[d] for d in city['used'] if d in triggered)
    print(f"\n5. {city['label']}: rain days at {place} (≥ 2 mm that day or the day before): {base:.0%} of days, {DESC_START} to {DESC_END}")
    print(f'   {"type":50} {"complaints":>10} {"on rain days":>13} {"weight":>7}')
    for d in sorted(n, key=lambda d: -triggered[d]):
        note = '' if d in city['used'] else '  (not used)'
        print(f'   {d:50} {n[d]:10d} {on_rain[d] / n[d]:12.0%} {triggered[d] / top:7.2f}{note}')


def drying():
    """Old vs new drying per day at Central Park, from the archived forecasts the app reads."""
    q = urllib.parse.urlencode({'latitude': 40.7812, 'longitude': -73.9665, 'start_date': '2023-06-01', 'end_date': '2026-10-31',
                                'hourly': 'shortwave_radiation,temperature_2m,et0_fao_evapotranspiration', 'timezone': 'America/New_York'})
    h = cached('drying-central-park-2023-06-01-2026-10-31.json', lambda: get_json(f'https://historical-forecast-api.open-meteo.com/v1/forecast?{q}'))['hourly']
    by_day = defaultdict(lambda: {'sw': 0.0, 't': [], 'e': 0.0})
    for t, sw, temp, e in zip(h['time'], h['shortwave_radiation'], h['temperature_2m'], h['et0_fao_evapotranspiration']):
        d = by_day[t[:10]]
        d['sw'] += sw or 0
        d['e'] += e or 0
        if temp is not None:
            d['t'].append(temp)
    seasons = {'Dec–Feb': (12, 1, 2), 'Mar–May': (3, 4, 5), 'Jun–Aug': (6, 7, 8), 'Sep–Nov': (9, 10, 11)}
    rows = []
    for day, d in by_day.items():
        kwh = d['sw'] / 1000
        old = 1.2 * kwh * (1 + max(0.0, float(np.mean(d['t']))) / 25)
        rows.append((int(day[5:7]), old, 1.05 * d['e'], kwh / 0.68))
    rows = np.array(rows)
    print('\n6. Drying, mm/day at Central Park (old: 1.2 × kWh × (1 + T/25); new: 1.05 × ET0)')
    print(f'   {"season":8} {"old":>6} {"new":>6} {"old/new":>8} {"old beyond energy limit":>24}')
    for name, months in [*seasons.items(), ('all', tuple(range(1, 13)))]:
        r = rows[np.isin(rows[:, 0], months)]
        print(f'   {name:8} {np.median(r[:, 1]):6.2f} {np.median(r[:, 2]):6.2f} {np.median(r[:, 1] / np.maximum(r[:, 2], 1e-6)):8.2f} {np.mean(r[:, 1] > r[:, 3]):23.0%}')


STORM311_START, STORM311_END = '2023-06-01', '2026-11-01'
BOROUGH_POINTS = {  # one weather point per borough; Central Park for Manhattan
    'MANHATTAN': (40.7812, -73.9665), 'BROOKLYN': (40.6782, -73.9442), 'QUEENS': (40.7282, -73.7949),
    'BRONX': (40.8448, -73.8648), 'STATEN ISLAND': (40.5795, -74.1502),
}


def complaints_around_storms():
    """Excess 311 flooding complaints after storms: how big a storm, and how long it lingers."""
    rain_driven = [d for d in PUDDLE_DESCRIPTORS if 'Sunken' not in d and 'Grating' not in d]  # weight >= 0.5
    quoted = ','.join("'" + d.replace("'", "''") + "'" for d in rain_driven)

    def fetch_311():
        rows, offset = [], 0
        while True:  # SoQL has no hourly truncation: group by day and hour of day
            q = urllib.parse.urlencode({
                '$select': 'date_trunc_ymd(created_date) as day, date_extract_hh(created_date) as hh, borough, count(*) as n',
                '$where': f"created_date >= '{STORM311_START}' AND created_date < '{STORM311_END}' AND complaint_type in('Sewer','Sewer Maintenance') AND descriptor in({quoted})",
                '$group': 'day, hh, borough', '$order': 'day, hh, borough', '$limit': 50000, '$offset': offset})
            page = get_json(f'https://data.cityofnewyork.us/resource/erm2-nwe9.json?{q}')
            rows += page
            if len(page) < 50000:
                return rows
            offset += 50000

    def fetch_rain():
        out = {}
        for b, (lat, lon) in BOROUGH_POINTS.items():
            q = urllib.parse.urlencode({'latitude': lat, 'longitude': lon, 'start_date': STORM311_START, 'end_date': '2026-10-31',
                                        'hourly': 'precipitation', 'timezone': 'America/New_York'})
            out[b] = [v or 0 for v in get_json(f'https://historical-forecast-api.open-meteo.com/v1/forecast?{q}')['hourly']['precipitation']]
            time.sleep(7)
        return out

    rows = cached(f'311-hourly-borough-{STORM311_START}-{STORM311_END}.json', fetch_311)
    rain = {b: np.array(v, float) for b, v in cached(f'rain-boroughs-{STORM311_START}-2026-10-31.json', fetch_rain).items()}
    n = len(rain['MANHATTAN'])
    t0 = datetime.fromisoformat(STORM311_START)  # both sources are New York wall-clock time
    counts = {b: np.zeros(n) for b in BOROUGH_POINTS}
    for r in rows:
        h = int((datetime.fromisoformat(r['day'][:10]) - t0).total_seconds() // 3600) + int(r['hh'])
        if r.get('borough') in counts and 0 <= h < n:
            counts[r['borough']][h] += int(r['n'])
    stamps = [t0 + timedelta(hours=h) for h in range(n)]
    hour_of_week = np.array([t.weekday() * 24 + t.hour for t in stamps])
    month = np.array([t.year * 12 + t.month for t in stamps])

    dose, tails = [], defaultdict(list)
    for b, p in rain.items():
        c = counts[b]
        last, dry = -10 ** 9, np.zeros(n, bool)  # dry: no rain hour in the previous 120 h
        for h in range(n):
            if p[h] >= RAIN_HOUR_MM:
                last = h
            dry[h] = h - last > 120
        # Expected complaints in dry weather: hour-of-week shape × that month's dry level.
        shape = np.array([c[dry & (hour_of_week == k)].mean() for k in range(168)])
        shape /= shape.mean()
        base = np.zeros(n)
        for m in np.unique(month):
            mm = month == m
            level = c[mm & dry].mean() if (mm & dry).sum() > 48 else c[dry].mean()
            base[mm] = level * shape[hour_of_week[mm]]
        excess = c - base
        idx = np.flatnonzero(p >= RAIN_HOUR_MM)
        breaks = np.flatnonzero(np.diff(idx) > STORM_GAP_H)
        storms = list(zip(np.r_[idx[0], idx[breaks + 1]], np.r_[idx[breaks], idx[-1]]))
        starts = np.array([a for a, _ in storms])
        for a, e in storms:
            later = starts[starts > e]
            gap = later[0] - e if later.size else 10 ** 9
            if gap > 48 and e + 48 < n:
                dose.append((p[a:e + 1].sum(), excess[a:e + 49].sum()))
            if gap > 96 and e + 97 < n and p[a:e + 1].sum() >= 5:
                tails['day' if 6 <= stamps[e].hour < 18 else 'night'].append(excess[e + 1:e + 97])

    dose = np.array(dose)
    rng = np.random.default_rng(3)
    print(f'\n7. 311 flooding complaints around storms, {STORM311_START} to {STORM311_END} ({int(sum(c.sum() for c in counts.values()))} complaints)')
    print(f'   Excess complaints from storm start to 48 h after ({len(dose)} borough-storms with 48 dry hours after), median by storm total:')
    edges = [0.2, 5, 10, 15, 20, 30, 45, 70, float('inf')]
    print('     ' + '  '.join(f'{lo:g}–{hi:g} mm: {np.median(dose[(dose[:, 0] >= lo) & (dose[:, 0] < hi), 1]):.1f}' for lo, hi in zip(edges, edges[1:])))
    ratio = lambda d: np.median(d[(d[:, 0] >= 20) & (d[:, 0] < 70), 1]) / max(np.median(d[(d[:, 0] >= 5) & (d[:, 0] < 15), 1]), 0.1)
    boot = [ratio(dose[rng.integers(len(dose), size=len(dose))]) for _ in range(1000)]
    print(f'     20–70 mm storms vs 5–15 mm: {ratio(dose):.1f}× (90% {np.percentile(boot, 5):.1f}–{np.percentile(boot, 95):.1f}×): the response steps up between 15 and 20 mm, then plateaus')

    def efold(curve):  # exponential fit to the positive tail, 12–96 h after the rain
        x = np.arange(1, 97)
        m = (x >= 12) & (curve > 0)
        slope = np.polyfit(x[m], np.log(curve[m]), 1)[0] if m.sum() >= 5 else 0
        return -1 / slope if slope < 0 else float('nan')
    print('   Fade after the rain ends (storms >= 5 mm, 96 dry hours after), e-folding time of the excess:')
    for k in ('day', 'night'):
        arr = np.array(tails[k])
        fits = [f for f in (efold(arr[rng.integers(len(arr), size=len(arr))].mean(0)) for _ in range(1000)) if np.isfinite(f)]
        print(f'     storms ending by {k:5} (n={len(arr)}): median {np.median(fits):.0f} h, 90% {np.percentile(fits, 5):.0f}–{np.percentile(fits, 95):.0f} h')
    print('     Reporting delay stretches this, so it is an upper bound; 24 h fits under it but is not confirmed.')


if __name__ == '__main__':
    main()
