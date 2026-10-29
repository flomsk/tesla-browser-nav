import { haversine, placeOnPolyline } from "@/lib/navigation";
import { isChargingDataConfigured, listChargingStations } from "@/lib/chargingStations";
import { listFuelStations } from "@/lib/fuelPrices";
import { categorySearch } from "@/lib/mapboxSearch";
import type { Bounds } from "@/lib/bounds";
import type { FuelType, Place, PlaceCategory } from "@/types/poi";

const MAX_RESULTS = 15;
// Around a point: chargers and fuel stations within ~5 km
const NEARBY_RADIUS_DEG = 0.05;
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
  route?: [number, number][]; // route ahead of the driver, starting at `near`
  teslaOnly?: boolean;
  fuelType: FuelType;
  language: string;
}

function searchArea(query: PlaceQuery): Bounds {
  const points = query.route && query.route.length >= 2 ? query.route : [query.near];
  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  // Superchargers are sparse, so a Tesla-only search looks ~30 km around instead of ~5 km
  const pad = query.route ? 0.02 : query.teslaOnly ? 0.3 : NEARBY_RADIUS_DEG;
  return {
    left: Math.min(...lngs) - pad,
    right: Math.max(...lngs) + pad,
    bottom: Math.min(...lats) - pad,
    top: Math.max(...lats) + pad,
  };
}

// Distance shown in the list: along the route when there is one, else straight line.
// Returns null for places behind the driver or too far off the route.
function locate(query: PlaceQuery, lat: number, lon: number): { distance: number; detour: number | null } | null {
  if (query.route && query.route.length >= 2) {
    const { along, offset } = placeOnPolyline(query.route, lat, lon);
    if (offset > MAX_DETOUR_METERS || along < 50) return null;
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
    .sort((a, b) => rankCharger(a) - rankCharger(b));
}

function rankCharger(place: Place): number {
  const kw = parseInt(place.badge ?? "0", 10);
  const penalty = place.isTesla || kw >= 100 ? 0 : kw >= 50 ? 1500 : 6000;
  return (place.distance ?? 0) + penalty;
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
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
}

async function mapboxPlaces(query: PlaceQuery): Promise<Place[]> {
  const features = await categorySearch(MAPBOX_CATEGORIES[query.category], {
    near: query.near,
    route: query.route,
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
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
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
