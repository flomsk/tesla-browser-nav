// Mapbox Search Box API: addresses, POIs and category search, also along a route.
// Uses the same public token as the map. https://docs.mapbox.com/api/search/search-box/

const SEARCH_URL = "https://api.mapbox.com/search/searchbox/v1";
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

export interface SearchFeature {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  categories: string[];
}

interface SearchBoxFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    mapbox_id?: string;
    name?: string;
    full_address?: string;
    place_formatted?: string;
    poi_category_ids?: string[];
  };
}

function toFeature(f: SearchBoxFeature): SearchFeature | null {
  const [lon, lat] = f.geometry?.coordinates ?? [];
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  const p = f.properties ?? {};
  return {
    id: p.mapbox_id ?? `${lat},${lon}`,
    name: p.name ?? p.full_address ?? "",
    address: p.full_address ?? p.place_formatted ?? "",
    lat,
    lon,
    categories: p.poi_category_ids ?? [],
  };
}

async function request(path: string, params: Record<string, string>): Promise<SearchFeature[]> {
  if (!MAPBOX_TOKEN) throw new Error("NEXT_PUBLIC_MAPBOX_TOKEN is not set");
  const query = new URLSearchParams({ ...params, access_token: MAPBOX_TOKEN });
  const response = await fetch(`${SEARCH_URL}/${path}?${query}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Mapbox Search error ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const data = (await response.json()) as { features?: SearchBoxFeature[] };
  return (data.features ?? []).map(toFeature).filter((f): f is SearchFeature => f !== null);
}

// Google's encoded polyline format with 6 decimals, which the along-route search expects
export function encodePolyline6(coords: [number, number][]): string {
  let out = "";
  let prevLat = 0;
  let prevLng = 0;
  const encode = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const [lng, lat] of coords) {
    const la = Math.round(lat * 1e6);
    const lo = Math.round(lng * 1e6);
    encode(la - prevLat);
    encode(lo - prevLng);
    prevLat = la;
    prevLng = lo;
  }
  return out;
}

export function forwardSearch(
  query: string, near: [number, number] | null, language: string, limit = 8
): Promise<SearchFeature[]> {
  return request("forward", {
    q: query,
    language,
    limit: String(limit),
    ...(near ? { proximity: `${near[0]},${near[1]}` } : {}),
  });
}

// `route` (lng/lat pairs, starting at the driver) switches to search-along-route: results within
// a few minutes' detour of the route instead of around one point
export function categorySearch(
  category: string,
  options: { near: [number, number]; route?: [number, number][]; language: string; limit?: number }
): Promise<SearchFeature[]> {
  const params: Record<string, string> = {
    language: options.language,
    limit: String(options.limit ?? 15),
    proximity: `${options.near[0]},${options.near[1]}`,
  };
  if (options.route && options.route.length >= 2) {
    Object.assign(params, {
      route: encodePolyline6(options.route),
      route_geometry: "polyline6",
      sar_type: "isochrone",
      time_deviation: "5",
    });
  }
  return request(`category/${encodeURIComponent(category)}`, params);
}

export async function reverseGeocode(lng: number, lat: number, language: string): Promise<string | null> {
  const [feature] = await request("reverse", {
    longitude: String(lng),
    latitude: String(lat),
    language,
    limit: "1",
  });
  if (!feature) return null;
  if (!feature.address || feature.address.startsWith(feature.name)) return feature.address || feature.name;
  return `${feature.name}, ${feature.address}`;
}
