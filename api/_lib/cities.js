// Candidate tour markets (public geographic facts only: name, country, lat/lng).
// Qloo decides which of these the artist's audience actually over-indexes in.
export const REGIONS = {
  us: {
    label: 'United States & Canada',
    query: 'United States',
    cities: [
      ['New York', 40.7128, -74.006], ['Los Angeles', 34.0522, -118.2437], ['Chicago', 41.8781, -87.6298],
      ['Austin', 30.2672, -97.7431], ['Nashville', 36.1627, -86.7816], ['Atlanta', 33.749, -84.388],
      ['Seattle', 47.6062, -122.3321], ['Portland', 45.5152, -122.6784], ['San Francisco', 37.7749, -122.4194],
      ['Denver', 39.7392, -104.9903], ['Minneapolis', 44.9778, -93.265], ['Philadelphia', 39.9526, -75.1652],
      ['Boston', 42.3601, -71.0589], ['Washington', 38.9072, -77.0369], ['Detroit', 42.3314, -83.0458],
      ['New Orleans', 29.9511, -90.0715], ['Miami', 25.7617, -80.1918], ['Phoenix', 33.4484, -112.074],
      ['Salt Lake City', 40.7608, -111.891], ['Dallas', 32.7767, -96.797], ['Houston', 29.7604, -95.3698],
      ['Toronto', 43.6532, -79.3832], ['Montreal', 45.5017, -73.5673], ['Vancouver', 49.2827, -123.1207],
    ],
  },
  eu: {
    label: 'UK & Europe',
    query: 'Europe',
    cities: [
      ['London', 51.5072, -0.1276], ['Manchester', 53.4808, -2.2426], ['Glasgow', 55.8642, -4.2518],
      ['Dublin', 53.3498, -6.2603], ['Paris', 48.8566, 2.3522], ['Amsterdam', 52.3676, 4.9041],
      ['Brussels', 50.8503, 4.3517], ['Berlin', 52.52, 13.405], ['Hamburg', 53.5511, 9.9937],
      ['Copenhagen', 55.6761, 12.5683], ['Stockholm', 59.3293, 18.0686], ['Oslo', 59.9139, 10.7522],
      ['Prague', 50.0755, 14.4378], ['Vienna', 48.2082, 16.3738], ['Warsaw', 52.2297, 21.0122],
      ['Milan', 45.4642, 9.19], ['Madrid', 40.4168, -3.7038], ['Barcelona', 41.3874, 2.1686],
      ['Lisbon', 38.7223, -9.1393], ['Zurich', 47.3769, 8.5417],
    ],
  },
  in: {
    label: 'India',
    query: 'India',
    cities: [
      ['Mumbai', 19.076, 72.8777], ['Delhi', 28.6139, 77.209], ['Bengaluru', 12.9716, 77.5946],
      ['Hyderabad', 17.385, 78.4867], ['Chennai', 13.0827, 80.2707], ['Kolkata', 22.5726, 88.3639],
      ['Pune', 18.5204, 73.8567], ['Ahmedabad', 23.0225, 72.5714], ['Jaipur', 26.9124, 75.7873],
      ['Goa', 15.2993, 74.124], ['Chandigarh', 30.7333, 76.7794], ['Kochi', 9.9312, 76.2673],
      ['Shillong', 25.5788, 91.8933], ['Guwahati', 26.1445, 91.7362], ['Lucknow', 26.8467, 80.9462],
    ],
  },
};

export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Order stops into a short drivable route: nearest-neighbour then 2-opt. */
export function routeStops(stops, start) {
  if (stops.length < 3) return stops;
  const pts = [...stops];
  const si = start ? pts.findIndex((p) => p.city.toLowerCase() === String(start).toLowerCase()) : -1;
  let cur = pts.splice(si >= 0 ? si : westmost(pts), 1)[0];
  const out = [cur];
  while (pts.length) {
    let best = 0;
    let bestD = Infinity;
    pts.forEach((p, i) => {
      const d = haversineKm(cur, p);
      if (d < bestD) { bestD = d; best = i; }
    });
    cur = pts.splice(best, 1)[0];
    out.push(cur);
  }
  // 2-opt improvement on open path
  let improved = true;
  const len = (r) => r.slice(1).reduce((s, p, i) => s + haversineKm(r[i], p), 0);
  while (improved) {
    improved = false;
    for (let i = 1; i < out.length - 1; i++) {
      for (let k = i + 1; k < out.length; k++) {
        const cand = [...out.slice(0, i), ...out.slice(i, k + 1).reverse(), ...out.slice(k + 1)];
        if (len(cand) + 1e-6 < len(out)) { out.splice(0, out.length, ...cand); improved = true; }
      }
    }
  }
  return out;
}

function westmost(pts) {
  // default: start at the edge of the map so the route sweeps across it
  let k = 0;
  pts.forEach((p, i) => { if (p.lng < pts[k].lng) k = i; });
  return k;
}
