// Pothole Guard — client-only demo using Leaflet and localStorage

const STORAGE_KEY = 'pothole_guard_reports_v1';
const DEFAULT_ALERT_RADIUS_M = 150;

/** @typedef {{ id: string, lat: number, lng: number, severity: 'low'|'medium'|'high', notes?: string, photoDataUrl?: string, radiusM: number, createdAt: number }} Pothole */

/** @type {Record<string, L.Marker>} */
const idToMarker = {};
/** @type {Pothole[]} */
let potholes = [];
let map, userMarker, watchId, draftPin;

const toastEl = document.getElementById('toast');
const locateMeBtn = document.getElementById('locateMeBtn');
const addPotholeBtn = document.getElementById('addPotholeBtn');
const exportBtn = document.getElementById('exportBtn');
const fitReportsBtn = document.getElementById('fitReportsBtn');
const alertsToggle = document.getElementById('alertsToggle');
const routeBtn = document.getElementById('routeBtn');
const fromPlaceInput = document.getElementById('fromPlace');
const toPlaceInput = document.getElementById('toPlace');
const liveToggle = document.getElementById('liveToggle');
const routeBadge = document.getElementById('routeBadge');

const placeSearchInput = document.getElementById('placeSearch');
const placeSearchBtn = document.getElementById('placeSearchBtn');
const severitySelect = document.getElementById('severity');
const notesInput = document.getElementById('notes');
const photoInput = document.getElementById('photo');
const radiusInput = document.getElementById('radius');
const reportForm = document.getElementById('reportForm');
const reportsList = document.getElementById('reportsList');

init();

function init() {
  initMap();
  loadFromStorage();
  renderAllMarkers();
  renderList();
  bindUi();
  startGeolocation();
}

function initMap() {
  const MH_BOUNDS = [[15.6, 72.6], [22.2, 80.9]]; // [southWest, northEast]
  const MH_CENTER = [19.7515, 75.7139];
  map = L.map('map', { maxBounds: MH_BOUNDS, maxBoundsViscosity: 1.0 });
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  map.setView(MH_CENTER, 7);
}

function bindUi() {
  locateMeBtn.addEventListener('click', async () => {
    try {
      const pos = await getCurrentPosition();
      const { latitude, longitude } = pos.coords;
      map.setView([latitude, longitude], 16);
    } catch (e) {
      showToast('Location unavailable. Check permissions.');
    }
  });

  addPotholeBtn.addEventListener('click', () => {
    showToast('Using map center for report location');
  });

  const dropPinBtn = document.getElementById('dropPinBtn');
  if (dropPinBtn) {
    dropPinBtn.addEventListener('click', () => {
      const c = map.getCenter();
      if (!draftPin) {
        draftPin = L.marker([c.lat, c.lng], { draggable: true }).addTo(map);
        draftPin.bindPopup('Drag to adjust location. Click report to save.').openPopup();
      } else {
        draftPin.setLatLng(c).openPopup();
      }
    });
  }

  if (placeSearchInput && placeSearchBtn) {
    const doSearch = async () => {
      const q = (placeSearchInput.value || '').trim();
      if (!q) return;
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`);
        const data = await res.json();
        if (Array.isArray(data) && data[0]) {
          const lat = parseFloat(data[0].lat);
          const lon = parseFloat(data[0].lon);
          map.setView([lat, lon], 16);
        } else {
          showToast('Place not found');
        }
      } catch {
        showToast('Search failed');
      }
    };
    placeSearchBtn.addEventListener('click', doSearch);
    placeSearchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
  }

  if (routeBtn && toPlaceInput) {
    const geocode = async (q) => {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`);
      const data = await res.json();
      return Array.isArray(data) && data[0] ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) } : null;
    };
    const parseLatLng = (s) => {
      const m = String(s||'').trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
      return m ? { lat: parseFloat(m[1]), lon: parseFloat(m[2]) } : null;
    };
    const routeOnce = async (from, toQ) => {
      const to = parseLatLng(toQ) || await geocode(toQ);
      if (!to) { showToast('Destination not found'); return; }
      const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
      const r = await fetch(url);
      if (!r.ok) { showToast('Route failed'); return; }
      const json = await r.json();
      const route = json.routes && json.routes[0];
      if (!route) { showToast('No route'); return; }
      const latlngs = route.geometry.coordinates.map(c => [c[1], c[0]]);
      const poly = L.polyline(latlngs, { color: '#2563eb', weight: 5, opacity: 0.8 });
      if (window._routeLayer) { window._routeLayer.remove(); }
      window._routeLayer = poly.addTo(map);
      map.fitBounds(poly.getBounds(), { padding: [40,40] });
      // Count potholes within ~40m
      const bufferM = 40;
      const toMeters = (lat, lon) => L.CRS.EPSG3857.project(L.latLng(lat, lon));
      const segDist = (p, a, b) => {
        const apx = p.x - a.x, apy = p.y - a.y; const abx = b.x - a.x, aby = b.y - a.y;
        const t = Math.max(0, Math.min(1, (apx*abx + apy*aby) / (abx*abx + aby*aby)));
        const cx = a.x + t*abx, cy = a.y + t*aby; const dx = p.x - cx, dy = p.y - cy; return Math.sqrt(dx*dx + dy*dy);
      };
      const coords = route.geometry.coordinates; // [lon,lat]
      let count = 0;
      for (const p of potholes) {
        const P = toMeters(p.lat, p.lng);
        let min = Infinity;
        for (let i=0;i<coords.length-1;i++) {
          const A = toMeters(coords[i][1], coords[i][0]);
          const B = toMeters(coords[i+1][1], coords[i+1][0]);
          const d = segDist(P, A, B); if (d < min) min = d;
        }
        if (min <= bufferM) count++;
      }
      const km = (route.distance/1000).toFixed(1);
      const mins = Math.round(route.duration/60);
      if (routeBadge) routeBadge.textContent = count === 0 ? `No potholes • ${km} km • ${mins} min` : `Potholes: ${count} • ${km} km • ${mins} min`;
    };
    let liveWatchId = null;
    const stopLive = () => { if (liveWatchId != null) navigator.geolocation.clearWatch(liveWatchId); liveWatchId = null; };
    routeBtn.addEventListener('click', async () => {
      const fromStr = fromPlaceInput?.value || '';
      if (fromStr.trim()) {
        const f = parseLatLng(fromStr) || await geocode(fromStr);
        if (!f) { showToast('From not found'); return; }
        await routeOnce({ lat: f.lat, lng: f.lon }, toPlaceInput.value || '');
      } else {
        try {
          const pos = await getCurrentPosition();
          await routeOnce({ lat: pos.coords.latitude, lng: pos.coords.longitude }, toPlaceInput.value || '');
        } catch { showToast('Location unavailable'); }
      }
    });
    if (liveToggle) {
      liveToggle.addEventListener('change', async () => {
        if (liveToggle.checked) {
          if (!('geolocation' in navigator)) { showToast('Geolocation not supported'); liveToggle.checked = false; return; }
          liveWatchId = navigator.geolocation.watchPosition(async (pos) => {
            await routeOnce({ lat: pos.coords.latitude, lng: pos.coords.longitude }, toPlaceInput.value || '');
          }, () => {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 8000 });
        } else { stopLive(); }
      });
    }
  }

  exportBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(potholes, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'potholes.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  if (fitReportsBtn) {
    fitReportsBtn.addEventListener('click', () => {
      if (potholes.length === 0) { showToast('No reports yet'); return; }
      const latlngs = potholes.map(p => [p.lat, p.lng]);
      const bounds = L.latLngBounds(latlngs);
      map.fitBounds(bounds.pad(0.2));
    });
  }

  reportForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const center = map.getCenter();
    const pinLatLng = draftPin?.getLatLng();
    const lat = pinLatLng ? pinLatLng.lat : center.lat;
    const lng = pinLatLng ? pinLatLng.lng : center.lng;
    const severity = /** @type {any} */ (severitySelect.value || 'medium');
    const notes = notesInput.value?.trim() || '';
    const radiusM = Math.max(25, parseInt(radiusInput.value || String(DEFAULT_ALERT_RADIUS_M), 10));
  let photoDataUrl = undefined;
  const file = photoInput?.files?.[0];
  if (file) {
    try {
      photoDataUrl = await fileToDataUrl(file, 1280, 1280);
    } catch {
      showToast('Could not read photo. Saving without image.');
    }
  }
    const pothole = /** @type {Pothole} */ ({
      id: crypto.randomUUID(),
    lat, lng, severity, notes, photoDataUrl,
      radiusM,
      createdAt: Date.now()
    });
    potholes.push(pothole);
    saveToStorage();
    addMarker(pothole);
    renderList();
    if (draftPin) { draftPin.remove(); draftPin = null; }
    reportForm.reset();
    radiusInput.value = String(DEFAULT_ALERT_RADIUS_M);
    showToast('Pothole reported. Drive safe!');
  });
}

function addMarker(p) {
  const color = p.severity === 'high' ? 'red' : p.severity === 'medium' ? 'orange' : 'blue';
  const marker = L.circleMarker([p.lat, p.lng], {
    radius: 8,
    color,
    weight: 2,
    fillColor: color,
    fillOpacity: 0.5
  }).addTo(map);

  marker.bindPopup(`<strong>Pothole (${p.severity})</strong><br/>${escapeHtml(p.notes || '')}`);
  idToMarker[p.id] = marker;
}

function removeMarker(id) {
  const m = idToMarker[id];
  if (m) {
    m.remove();
    delete idToMarker[id];
  }
}

function renderAllMarkers() {
  Object.values(idToMarker).forEach(m => m.remove());
  for (const p of potholes) addMarker(p);
}

function renderList() {
  reportsList.innerHTML = '';
  if (potholes.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No reports yet.';
    reportsList.appendChild(li);
    return;
  }
  for (const p of potholes.slice().sort((a,b) => b.createdAt - a.createdAt)) {
    const li = document.createElement('li');
    const chip = document.createElement('div');
    chip.className = `chip ${p.severity}`;
    chip.textContent = `Severity: ${p.severity}`;
    const loc = document.createElement('div');
    loc.textContent = `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} • ${Math.round(p.radiusM)} m radius`;
    const notes = document.createElement('div');
    if (p.notes) notes.textContent = p.notes;
    const actions = document.createElement('div');
    actions.className = 'report-actions';
    const flyBtn = document.createElement('button');
    flyBtn.textContent = 'Fly to';
    flyBtn.addEventListener('click', () => map.flyTo([p.lat, p.lng], 18));
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => deleteReport(p.id));
    actions.appendChild(flyBtn);
    actions.appendChild(delBtn);
    li.appendChild(chip);
    li.appendChild(loc);
    if (p.photoDataUrl) {
      const img = document.createElement('img');
      img.src = p.photoDataUrl;
      img.alt = 'Pothole photo';
      img.style.maxWidth = '100%';
      img.style.borderRadius = '6px';
      li.appendChild(img);
    }
    if (p.notes) li.appendChild(notes);
    li.appendChild(actions);
    reportsList.appendChild(li);
  }
}

function deleteReport(id) {
  potholes = potholes.filter(p => p.id !== id);
  saveToStorage();
  removeMarker(id);
  renderList();
}

function saveToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(potholes));
}

function loadFromStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) potholes = arr;
  } catch { /* ignore */ }
}

function startGeolocation() {
  if (!('geolocation' in navigator)) {
    showToast('Geolocation not supported by this browser.');
    return;
  }
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
    enableHighAccuracy: true,
    maximumAge: 2000,
    timeout: 8000
  });
}

function onPosition(pos) {
  const { latitude, longitude } = pos.coords;
  if (!userMarker) {
    userMarker = L.circleMarker([latitude, longitude], { radius: 6, color: '#2563eb', fillColor: '#2563eb', fillOpacity: .7 }).addTo(map);
  } else {
    userMarker.setLatLng([latitude, longitude]);
  }
  checkProximity(latitude, longitude);
}

function onPositionError() {
  // Avoid spamming toasts; silent failure here
}

let lastAlertedId = null;
function checkProximity(lat, lng) {
  if (!alertsToggle.checked) return;
  for (const p of potholes) {
    const d = haversineMeters(lat, lng, p.lat, p.lng);
    if (d <= p.radiusM) {
      if (lastAlertedId !== p.id) {
        showToast('Drive safe — pothole ahead!');
        highlightMarker(p.id);
        lastAlertedId = p.id;
      }
      return;
    }
  }
  lastAlertedId = null;
}

function highlightMarker(id) {
  const m = idToMarker[id];
  if (!m) return;
  const orig = m.options.color;
  m.setStyle({ color: '#111827', fillColor: '#111827' });
  setTimeout(() => m.setStyle({ color: orig, fillColor: orig }), 1600);
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(showToast._t);
  // @ts-ignore
  showToast._t = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function fileToDataUrl(file, maxW, maxH) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, maxW / img.width, maxH / img.height);
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(/** @type {string} */(reader.result));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => resolve(/** @type {string} */(reader.result));
      img.src = /** @type {string} */(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}


