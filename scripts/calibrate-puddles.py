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
     intensity (the susceptibility factor), with a by-sensor bootstrap interval.

What it cannot check: FloodNet floods drain in about half an hour, so it says nothing about how
long a puddle lingers (the drying term and the burst's 24 h decay) or about puddles left by
drizzle that never floods a street (the 20 mm total scale).

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
from datetime import datetime, timezone
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


if __name__ == '__main__':
    main()
