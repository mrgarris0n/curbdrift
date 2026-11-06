// Leaflet wrapper. Uses the global `L` only inside functions so this module can be
// imported without a browser (tests import app.js, which imports this).

// Standard OpenStreetMap tiles (no key; light use under the OSMF tile policy). The theme
// desaturates them. CARTO basemaps were planned but now answer "API KEY REQUIRED".
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function iconHtml(className, codeText, shapeClass = 'shape') {
  const wrap = document.createElement('div');
  const shape = document.createElement('div');
  shape.className = shapeClass;
  const code = document.createElement('span');
  code.className = 'code';
  code.textContent = codeText;
  wrap.append(shape, code);
  return wrap.innerHTML;
}

/**
 * @returns {{setUser(center, label): void, setSurveyArea(center, radiusM): void,
 *   setItems(items, onSelect): void, select(id): void, fitTo(center, radiusM): void}}
 */
/**
 * Browsing the map (pan, zoom, tap) never fetches data. Callbacks:
 *   onMapTap()   — a tap on empty map (used to close an open file)
 *   onUserMove() — the user panned or zoomed (used to offer a re-survey)
 */
export function createMap(el, center, { onMapTap, onUserMove }) {
  const L = globalThis.L;
  const map = L.map(el, { zoomControl: false }).setView([center.lat, center.lon], 16);
  L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);
  L.control.zoom({ position: 'topright' }).addTo(map);
  map.on('click', () => onMapTap());
  // Moves made by fitTo() are ours, not the user's.
  let fitting = false;
  // Only real drags and zooms count: a resize (phone rotation, browser bar) also fires moveend.
  const userMoved = () => { if (!fitting) onUserMove(); };
  map.on('dragend', userMoved);
  map.on('zoomend', userMoved);

  const items = L.layerGroup().addTo(map);
  const markersById = new Map();
  let userMarker = null;
  let area = null;
  let routeLine = null;
  let routeIds = null; // ids of items on the drawn route, or null
  let selectedId = null;

  function select(id) {
    markersById.get(selectedId)?.getElement()?.classList.remove('selected');
    selectedId = id;
    markersById.get(id)?.getElement()?.classList.add('selected');
  }

  return {
    setUser(pos, label) {
      const icon = L.divIcon({ className: 'marker marker-user', html: iconHtml('', label, 'dot'), iconSize: [12, 12], iconAnchor: [6, 6] });
      if (userMarker) userMarker.setLatLng([pos.lat, pos.lon]).setIcon(icon);
      else userMarker = L.marker([pos.lat, pos.lon], { icon, keyboard: false, interactive: false, zIndexOffset: -100 }).addTo(map);
    },

    setSurveyArea(c, radiusM) {
      const opts = { radius: radiusM, color: '#2b3a55', weight: 1, dashArray: '4 4', fill: false, interactive: false };
      if (area) area.setLatLng([c.lat, c.lon]).setRadius(radiusM);
      else area = L.circle([c.lat, c.lon], opts).addTo(map);
    },

    setItems(list, onSelect) {
      items.clearLayers();
      markersById.clear();
      for (const item of list) {
        // 32px tap target around an 18px drawn shape: fingers are not styluses.
        const icon = L.divIcon({ className: `marker marker-${item.kind}`, html: iconHtml('', item.code), iconSize: [32, 32], iconAnchor: [16, 16] });
        const m = L.marker([item.lat, item.lon], { icon, title: item.code, alt: item.code, riseOnHover: true });
        m.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          select(item.id);
          onSelect(item);
        });
        m.on('keypress', (e) => {
          if (e.originalEvent.key === 'Enter') { select(item.id); onSelect(item); }
        });
        m.addTo(items);
        markersById.set(item.id, m);
      }
      if (routeIds) for (const [id, m] of markersById) m.getElement()?.classList.toggle('off-route', !routeIds.has(id));
      if (selectedId && !markersById.has(selectedId)) selectedId = null;
      else if (selectedId) select(selectedId);
    },

    select,

    /**
     * Draw the itinerary loop through the given points (or clear it with null). Markers not on
     * the route are dimmed, and the view fits the loop above the bottom panel.
     */
    setRoute(points, coveredBottomPx = 0) {
      routeLine?.remove();
      routeLine = null;
      routeIds = points ? new Set(points.map((pt) => pt.id).filter(Boolean)) : null;
      for (const [id, m] of markersById) m.getElement()?.classList.toggle('off-route', Boolean(routeIds) && !routeIds.has(id));
      if (!points) return;
      routeLine = L.polyline(points.map((pt) => [pt.lat, pt.lon]), { className: 'route-line', weight: 3, dashArray: '6 6', interactive: false }).addTo(map);
      fitting = true;
      map.fitBounds(routeLine.getBounds(), { paddingTopLeft: [24, 24], paddingBottomRight: [24, 24 + coveredBottomPx], animate: false, maxZoom: 18 });
      fitting = false;
    },

    /** Fit the survey circle into the part of the map not covered by the bottom panel. */
    fitTo(c, radiusM, coveredBottomPx = 0) {
      fitting = true; // not animated, so its zoomend fires synchronously inside this call
      map.fitBounds(L.latLng(c.lat, c.lon).toBounds(radiusM * 2), {
        paddingTopLeft: [8, 8],
        paddingBottomRight: [8, 8 + coveredBottomPx],
        animate: false,
      });
      fitting = false;
    },

    /** Center of the part of the map the bottom panel does not cover. */
    visibleCenter(coveredBottomPx = 0) {
      const size = map.getSize();
      const ll = map.containerPointToLatLng([size.x / 2, (size.y - coveredBottomPx) / 2]);
      return { lat: ll.lat, lon: ll.lng };
    },
  };
}
