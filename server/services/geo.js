import { config } from '../config.js';
import { getDb, nowIso } from '../db.js';
import { memberGeoKey } from '../models.js';

// Címből koordináta az OpenStreetMap Nominatim szolgáltatással. A szolgáltatás szabályai szerint
// legfeljebb 1 kérés/másodperc, azonosítható User-Agent, és minden eredményt eltárolunk (geocode_cache).
async function nominatim(query) {
  const url = `${config.geocoding.url}?format=jsonv2&limit=1&accept-language=hu&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': `CantemusKorusApp/1.0 (${config.geocoding.contact})` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const [hit] = await res.json();
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
}

let geocoder = nominatim;
let enabled = config.geocoding.enabled;

// Teszteléshez: saját keresőfüggvény (a valódi szolgáltatás helyett).
export function setGeocoder(fn) {
  geocoder = fn;
  enabled = Boolean(fn);
}

let lastCall = 0;
let queue = Promise.resolve();
const MIN_GAP_MS = 1100;

function throttled(query) {
  const run = queue.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0 && geocoder === nominatim) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return geocoder(query);
  });
  queue = run.catch(() => {});
  return run;
}

const normalizeQuery = (q) => String(q || '').trim().replace(/\s+/g, ' ').toLowerCase();

// Koordináta egy szöveges helyhez; null, ha nem található vagy a szolgáltatás nem elérhető.
// Csak a sikeres válaszokat (a „nem található”-t is) tároljuk – hálózati hibánál később újra próbáljuk.
export async function geocode(query) {
  const key = normalizeQuery(query);
  if (!key) return null;
  const cached = getDb().prepare('SELECT lat, lng FROM geocode_cache WHERE query = ?').get(key);
  if (cached) return cached.lat == null ? null : { lat: cached.lat, lng: cached.lng };
  if (!enabled) return null;
  let hit;
  try {
    hit = await throttled(query);
  } catch (err) {
    console.error(`Helykeresési hiba („${query}”):`, err.message);
    return null;
  }
  getDb().prepare('INSERT OR REPLACE INTO geocode_cache (query, lat, lng, created_at) VALUES (?, ?, ?, ?)')
    .run(key, hit?.lat ?? null, hit?.lng ?? null, nowIso());
  return hit;
}

// Az esemény helyszíne: előbb cím + település + ország, ha az nem található, akkor csak település + ország.
export async function geocodeEventLocation({ address, city, country }) {
  // Csak országgal nincs értelme: az ország közepétől mért távolság félrevezető lenne.
  if (!String(address || '').trim() && !String(city || '').trim()) return null;
  const attempts = [[address, city, country], [city, country]]
    .map((parts) => parts.map((p) => String(p || '').trim()).filter(Boolean).join(', '))
    .filter((q, i, all) => q && all.indexOf(q) === i && (i === 0 || city));
  for (const q of attempts) {
    const hit = await geocode(q);
    if (hit) return hit;
  }
  return null;
}

// Légvonalbeli távolság km-ben (haversine).
export function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// A tagok lakóhelyének koordinátái a háttérben töltődnek fel (mentéskor, importkor és az ütemezőben).
export async function geocodePendingMembers() {
  const rows = getDb().prepare(`SELECT id, postal_code, home_city, geo_key FROM members WHERE active = 1 AND (postal_code != '' OR home_city != '')`).all();
  let done = 0;
  for (const r of rows) {
    const key = memberGeoKey({ postalCode: r.postal_code, homeCity: r.home_city });
    if (r.geo_key === key) continue;
    const hit = await geocode(key);
    // Ha a szolgáltatás nem volt elérhető (nincs a gyorsítótárban), később újra próbáljuk.
    if (!hit && !getDb().prepare('SELECT 1 FROM geocode_cache WHERE query = ?').get(normalizeQuery(key))) continue;
    getDb().prepare('UPDATE members SET home_lat = ?, home_lng = ?, geo_key = ? WHERE id = ?').run(hit?.lat ?? null, hit?.lng ?? null, key, r.id);
    done++;
  }
  return done;
}

let running = null;
export function kickGeocoding() {
  if (!running) running = geocodePendingMembers().catch((err) => console.error('Helykeresési hiba:', err)).finally(() => { running = null; });
  return running;
}

// Tagok távolsága (km) az esemény helyszínétől. located=false, ha a helyszín nem található.
export async function memberDistances(location) {
  const origin = await geocodeEventLocation(location);
  if (!origin) return { located: false, distances: {} };
  const rows = getDb().prepare('SELECT id, home_lat, home_lng FROM members WHERE active = 1 AND home_lat IS NOT NULL').all();
  const distances = {};
  for (const r of rows) distances[r.id] = Math.round(distanceKm(origin, { lat: r.home_lat, lng: r.home_lng }) * 10) / 10;
  return { located: true, distances };
}
