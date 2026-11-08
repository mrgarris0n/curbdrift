#!/usr/bin/env python3
"""Turn DEP's NYC Stormwater Flood Map into the point file the browser reads (assets/flood.json).

The flood maps are a static model (last published 2024), distributed only as Esri File
Geodatabases, which plain Node cannot read. So this runs by hand, not in the deploy build:
re-run it when DEP republishes the dataset (NYC Open Data 9i7c-xyvv) and commit the result.

    python3 -m venv ~/.cache/curbdrift-flood
    ~/.cache/curbdrift-flood/bin/pip install pyogrio shapely pyproj
    ~/.cache/curbdrift-flood/bin/python scripts/flood-points.py

Scenario: Moderate Flood (2.13 in/h) with current sea levels. Categories: 1 = nuisance
ponding (4 in to 1 ft), 2 = deep and contiguous (1 ft or more). Each flood area becomes one
point per 30 m grid cell inside it, or one representative point if it is smaller than a cell.
A download that looks wrong stops the script before anything is written.
"""
import gzip
import json
import sys
import tempfile
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pyogrio
import shapely
from pyproj import Transformer

DATASET = '9i7c-xyvv'
SCENARIO_GDB = 'NYC_Stormwater_Flood_Map_Moderate_Flood_2_13_inches_per_hr_with_Current_Sea_Levels.gdb'
CATEGORIES = {1, 2}
SPACING_M = 30
FT_PER_M = 1 / 0.3048
MIN_POINTS = 20000  # the 2024 map gives ~32,000; far fewer means a broken or different file
NYC_BBOX = (-74.27, 40.49, -73.69, 40.92)  # lon/lat
OUT = Path(__file__).resolve().parent.parent / 'assets' / 'flood.json'


def fail(msg):
    sys.exit(f'flood-points: {msg}; nothing written')


def fetch_json(url):
    with urllib.request.urlopen(url, timeout=60) as res:
        return json.load(res)


def download(workdir):
    meta = fetch_json(f'https://data.cityofnewyork.us/api/views/{DATASET}.json')
    blob = meta.get('blobId') or fail('dataset has no downloadable file')
    zip_path = workdir / 'flood.zip'
    url = f'https://data.cityofnewyork.us/api/views/{DATASET}/files/{blob}?download=true'
    with urllib.request.urlopen(url, timeout=300) as res, open(zip_path, 'wb') as f:
        while chunk := res.read(1 << 20):
            f.write(chunk)
    updated = meta.get('rowsUpdatedAt') or meta.get('viewLastModified')
    return zip_path, datetime.fromtimestamp(updated, timezone.utc).isoformat() if updated else None


def find_gdb(zip_path, workdir):
    with zipfile.ZipFile(zip_path) as z:
        members = [m for m in z.namelist() if f'/{SCENARIO_GDB}/' in m]
        if not members:
            fail(f'{SCENARIO_GDB} not in the download')
        for m in members:
            # Only plain relative paths inside the archive; never write outside workdir.
            if m.startswith('/') or '..' in Path(m).parts:
                fail(f'unsafe path in archive: {m}')
            z.extract(m, workdir)
    return next(workdir.rglob(SCENARIO_GDB))


def sample(gdb):
    _, _, geoms, fields = pyogrio.raw.read(str(gdb), columns=['Flooding_Category'])
    to_wgs84 = Transformer.from_crs(2263, 4326, always_xy=True)  # NY Long Island, US feet
    step = SPACING_M * FT_PER_M
    xs_all, ys_all, cats_all = [], [], []
    for wkb, cat in zip(geoms, fields[0]):
        cat = int(cat)
        if cat not in CATEGORIES:
            continue
        geom = shapely.force_2d(shapely.from_wkb(wkb))
        for part in getattr(geom, 'geoms', [geom]):
            minx, miny, maxx, maxy = part.bounds
            gx, gy = np.meshgrid(np.arange(minx + step / 2, maxx, step), np.arange(miny + step / 2, maxy, step))
            gx, gy = gx.ravel(), gy.ravel()
            inside = shapely.contains_xy(part, gx, gy) if gx.size else np.zeros(0, bool)
            if inside.any():
                px, py = gx[inside], gy[inside]
            else:
                r = part.representative_point()
                px, py = np.array([r.x]), np.array([r.y])
            xs_all.append(px)
            ys_all.append(py)
            cats_all.append(np.full(px.size, cat))
    lon, lat = to_wgs84.transform(np.concatenate(xs_all), np.concatenate(ys_all))
    cats = np.concatenate(cats_all)
    points = sorted({(round(float(a), 5), round(float(b), 5), int(c)) for a, b, c in zip(lon, lat, cats)}, key=lambda p: (p[1], p[0], p[2]))
    return [list(p) for p in points]


def check(points):
    if len(points) < MIN_POINTS:
        fail(f'only {len(points)} points (expected at least {MIN_POINTS})')
    if {p[2] for p in points} != CATEGORIES:
        fail('unexpected flooding categories')
    w, s, e, n = NYC_BBOX
    if any(not (w <= p[0] <= e and s <= p[1] <= n) for p in points):
        fail('points outside New York City (wrong projection?)')


def main():
    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        zip_path, updated = download(workdir)
        points = sample(find_gdb(zip_path, workdir))
    check(points)
    snapshot = {
        'source': f'https://data.cityofnewyork.us/d/{DATASET}',
        'scenario': 'Moderate Flood (2.13 in/hr) with Current Sea Levels',
        'categories': {'1': 'nuisance: 4 in to 1 ft', '2': 'deep: 1 ft or more'},
        'sourceUpdatedAt': updated,
        'spacingM': SPACING_M,
        'points': points,  # [lon, lat, category]
    }
    body = json.dumps(snapshot, separators=(',', ':'))
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(body + '\n')
    print(f'flood-points: {len(points)} points, {len(body) / 1e3:.0f} KB raw, {len(gzip.compress(body.encode(), 9)) / 1e3:.0f} KB gzipped → {OUT}')


if __name__ == '__main__':
    main()
