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
export function createMap(el, center, onPick) {
  const L = globalThis.L;
  const map = L.map(el, { zoomControl: false }).setView([center.lat, center.lon], 16);
  L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);
  L.control.zoom({ position: 'topright' }).addTo(map);
  // Leaflet fires `click` for each tap of a double-tap. Wait briefly so a double-tap zooms
  // instead of starting (and then re-fitting) two surveys.
  const DOUBLE_TAP_MS = 300;
  let pendingPick = null;
  map.on('click', (e) => {
    clearTimeout(pendingPick);
    pendingPick = setTimeout(() => onPick({ lat: e.latlng.lat, lon: e.latlng.lng }), DOUBLE_TAP_MS);
  });
  map.on('dblclick', () => clearTimeout(pendingPick));

  const items = L.layerGroup().addTo(map);
  const markersById = new Map();
  let userMarker = null;
  let area = null;
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
        const icon = L.divIcon({ className: `marker marker-${item.kind}`, html: iconHtml('', item.code), iconSize: [18, 18], iconAnchor: [9, 9] });
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
      if (selectedId && !markersById.has(selectedId)) selectedId = null;
      else if (selectedId) select(selectedId);
    },

    select,

    /** Fit the survey circle into the part of the map not covered by the bottom panel. */
    fitTo(c, radiusM, coveredBottomPx = 0) {
      map.fitBounds(L.latLng(c.lat, c.lon).toBounds(radiusM * 2), {
        paddingTopLeft: [8, 8],
        paddingBottomRight: [8, 8 + coveredBottomPx],
      });
    },
  };
}
