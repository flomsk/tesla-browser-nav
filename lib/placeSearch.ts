import { haversine, placeOnPolyline } from "@/lib/navigation";
import { isChargingDataConfigured, listChargingStations } from "@/lib/chargingStations";
import { listFuelStations } from "@/lib/fuelPrices";
import { categorySearch } from "@/lib/mapboxSearch";
import type { Bounds } from "@/lib/bounds";
import type { FuelType, Place, PlaceCategory } from "@/types/poi";

const MAX_RESULTS = 15;
// Around a point: chargers and fuel stations within ~5 km
const NEARBY_RADIUS_DEG = 0.05;
// On a panned map the search covers what is on screen, up to this many degrees across
const MAX_VIEW_SPAN_DEG = 0.6;
const MAX_TESLA_VIEW_SPAN_DEG = 4;
// Along a route: how far off the road a place may be
const MAX_DETOUR_METERS = 1500;

// Mapbox Search Box category ids for chips without a better dedicated source
const MAPBOX_CATEGORIES: Record<PlaceCategory, string> = {
  charging: "charging_station",
  fuel: "gas_station",
  cafe: "cafe",
  food: "restaurant",
  parking: "parking_lot",
};

const NOT_FOR_CARS = /bici|bicy|bike|moto/i;

export interface PlaceQuery {
  category: PlaceCategory;
  near: [number, number]; // lng, lat of the driver
  center?: [number, number]; // where to look instead of around the driver (map panned elsewhere)
  view?: Bounds; // the part of the map on screen around `center`
  route?: [number, number][]; // route ahead of the driver, starting at `near`
  teslaOnly?: boolean;
  fuelType: FuelType;
  language: string;
}

export function searchArea(query: PlaceQuery): Bounds {
  const points = query.route && query.route.length >= 2 ? query.route : [query.center ?? query.near];
  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  // Superchargers are sparse, so a Tesla-only search looks ~30 km around instead of ~5 km
  const pad = query.route ? 0.02 : query.teslaOnly ? 0.3 : NEARBY_RADIUS_DEG;
  const area = {
    left: Math.min(...lngs) - pad,
    right: Math.max(...lngs) + pad,
    bottom: Math.min(...lats) - pad,
    top: Math.max(...lats) + pad,
  };
  if (query.view && query.route) {
    // Along a route seen from elsewhere: only the stretch on screen, not the whole bbox of the trip
    const view = paddedView(query.view);
    return {
      left: Math.max(area.left, view.left),
      right: Math.min(area.right, view.right),
      bottom: Math.max(area.bottom, view.bottom),
      top: Math.min(area.top, view.top),
    };
  }
  if (!query.view) return area;
  // Whatever is on screen, but never less than the default area and never more than MAX_VIEW_SPAN
  // around the centre, so a zoomed-out map doesn't ask Open Charge Map for the whole country
  const [lng, lat] = query.center ?? query.near;
  const half = (query.teslaOnly ? MAX_TESLA_VIEW_SPAN_DEG : MAX_VIEW_SPAN_DEG) / 2;
  return {
    left: Math.max(Math.min(area.left, query.view.left), lng - half),
    right: Math.min(Math.max(area.right, query.view.right), lng + half),
    bottom: Math.max(Math.min(area.bottom, query.view.bottom), lat - half),
    top: Math.min(Math.max(area.top, query.view.top), lat + half),
  };
}

function paddedView(view: Bounds): Bounds {
  const padLng = (view.right - view.left) * 0.1;
  const padLat = (view.top - view.bottom) * 0.1;
  return { left: view.left - padLng, right: view.right + padLng, bottom: view.bottom - padLat, top: view.top + padLat };
}

function insideView(view: Bounds, lat: number, lon: number): boolean {
  const v = paddedView(view);
  return lon >= v.left && lon <= v.right && lat >= v.bottom && lat <= v.top;
}

// The part of the route ahead that is on screen, when the driver looks at another stretch of it.
// Null when none of it is visible.
export function visibleRoute(query: PlaceQuery): [number, number][] | null {
  const route = query.route;
  if (!route || !query.view) return route ?? null;
  const visible = route.flatMap(([lng, lat], i) => (insideView(query.view!, lat, lng) ? [i] : []));
  if (visible.length === 0) return null;
  // Keep a neighbour on each side so segments crossing the screen edge stay in
  const slice = route.slice(Math.max(visible[0] - 1, 0), Math.min(visible[visible.length - 1] + 2, route.length));
  return slice.length >= 2 ? slice : null;
}

// Distance shown in the list: along the route when there is one, else straight line.
// Returns null for places behind the driver or too far off the route.
function locate(query: PlaceQuery, lat: number, lon: number): { distance: number; detour: number | null } | null {
  if (query.route && query.route.length >= 2) {
    const { along, offset } = placeOnPolyline(query.route, lat, lon);
    if (offset > MAX_DETOUR_METERS || along < 50) return null;
    if (query.view && !insideView(query.view, lat, lon)) return null;
    return { distance: along, detour: offset };
  }
  return { distance: haversine(query.near[1], query.near[0], lat, lon), detour: null };
}

async function chargers(query: PlaceQuery): Promise<Place[]> {
  const stations = await listChargingStations(searchArea(query), { teslaOnly: query.teslaOnly });
  return stations
    .filter((s) => s.isOperational !== false && (!query.teslaOnly || s.isTesla))
    .map((s): Place | null => {
      const position = locate(query, s.lat, s.lon);
      if (!position) return null;
      return {
        id: s.id,
        category: "charging",
        name: s.name,
        address: [s.operator, s.address].filter(Boolean).join(" · "),
        lat: s.lat,
        lon: s.lon,
        ...position,
        badge: s.maxPowerKw ? `${Math.round(s.maxPowerKw)} kW` : null,
        price: null,
        isTesla: s.isTesla,
      };
    })
    .filter((p): p is Place => p !== null)
    // Fast chargers first within similar distances: a 250 kW stop 2 km further beats a 7 kW socket
    .sort((a, b) => rankCharger(query, a) - rankCharger(query, b));
}

// Distance used for ordering: from the search centre when the map was panned away from the car
function sortDistance(query: PlaceQuery, place: Place): number {
  return query.center && !query.route
    ? haversine(query.center[1], query.center[0], place.lat, place.lon)
    : place.distance ?? 0;
}

function rankCharger(query: PlaceQuery, place: Place): number {
  const kw = parseInt(place.badge ?? "0", 10);
  const penalty = place.isTesla || kw >= 100 ? 0 : kw >= 50 ? 1500 : 6000;
  return sortDistance(query, place) + penalty;
}

async function fuelStations(query: PlaceQuery): Promise<Place[]> {
  const { stations } = await listFuelStations(searchArea(query));
  return stations
    .map((s): Place | null => {
      const price = s.prices[query.fuelType];
      if (price === undefined) return null;
      const position = locate(query, s.lat, s.lon);
      if (!position) return null;
      return {
        id: `fuel-${s.id}`,
        category: "fuel",
        name: s.brand,
        address: [s.address, s.town].filter(Boolean).join(", "),
        lat: s.lat,
        lon: s.lon,
        ...position,
        badge: `${price.toFixed(3)} €`,
        price,
        isTesla: false,
      };
    })
    .filter((p): p is Place => p !== null)
    .sort((a, b) => sortDistance(query, a) - sortDistance(query, b));
}

async function mapboxPlaces(query: PlaceQuery): Promise<Place[]> {
  const route = visibleRoute(query);
  if (query.route && !route) return [];
  const features = await categorySearch(MAPBOX_CATEGORIES[query.category], {
    near: query.center ?? query.near,
    route: route ?? undefined,
    language: query.language,
    limit: 25,
  });
  return features
    .map((f): Place | null => {
      const position = locate(query, f.lat, f.lon);
      if (!position) return null;
      return {
        id: f.id,
        category: query.category,
        name: f.name,
        address: f.address,
        lat: f.lat,
        lon: f.lon,
        ...position,
        badge: null,
        price: null,
        isTesla: /tesla/i.test(f.name),
      };
    })
    .filter((p): p is Place => p !== null)
    .filter((p) => !query.teslaOnly || p.isTesla)
    // Mapbox lists bicycle and motorbike parking under parking lots too
    .filter((p) => query.category !== "parking" || !NOT_FOR_CARS.test(p.name))
    .sort((a, b) => sortDistance(query, a) - sortDistance(query, b));
}

export async function searchPlaces(query: PlaceQuery): Promise<Place[]> {
  let places: Place[] = [];
  if (query.category === "charging" && isChargingDataConfigured()) {
    places = await chargers(query);
  } else if (query.category === "fuel") {
    places = await fuelStations(query);
  }
  // Mapbox covers everything else, and is the fallback when a dedicated source has nothing
  // (no Open Charge Map key, or outside Spain for fuel prices)
  if (places.length === 0) places = await mapboxPlaces(query);
  return places.slice(0, MAX_RESULTS);
}
