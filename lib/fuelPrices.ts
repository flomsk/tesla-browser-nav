import type { FuelStation, FuelStationsResponse, FuelType } from "@/types/poi";

// Every fuel station in Spain with current prices, refreshed by the ministry about every 30 minutes.
// No API key needed. The full list is ~12 MB, so it is downloaded once and filtered in memory.
const GEOPORTAL_URL =
  "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/";
const CACHE_TTL_MS = 30 * 60 * 1000;

const PRICE_FIELDS: Record<FuelType, string> = {
  g95: "Precio Gasolina 95 E5",
  g98: "Precio Gasolina 98 E5",
  diesel: "Precio Gasoleo A",
  dieselPremium: "Precio Gasoleo Premium",
  lpg: "Precio Gases licuados del petróleo",
};

type GeoportalStation = Record<string, string>;

interface FuelCache {
  stations: FuelStation[];
  updatedAt: string | null;
  fetchedAt: number;
}

const globalForFuel = globalThis as unknown as {
  fuelCache?: FuelCache;
  fuelLoading?: Promise<FuelCache>;
};

// "1,459" -> 1.459
function parseDecimal(value: string | undefined): number | null {
  if (!value) return null;
  const n = parseFloat(value.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function titleCase(value: string): string {
  return value.toLowerCase().replace(/(^|[\s/-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

function toStation(raw: GeoportalStation): FuelStation | null {
  const lat = parseDecimal(raw["Latitud"]);
  const lon = parseDecimal(raw["Longitud (WGS84)"]);
  if (lat === null || lon === null) return null;

  const prices: Partial<Record<FuelType, number>> = {};
  for (const [type, field] of Object.entries(PRICE_FIELDS) as [FuelType, string][]) {
    const price = parseDecimal(raw[field]);
    if (price !== null && price > 0) prices[type] = price;
  }
  if (Object.keys(prices).length === 0) return null;

  return {
    id: raw["IDEESS"],
    brand: titleCase(raw["Rótulo"] || "Gasolinera"),
    lat,
    lon,
    address: titleCase(raw["Dirección"] || ""),
    town: titleCase(raw["Localidad"] || ""),
    hours: raw["Horario"] || "",
    prices,
  };
}

async function download(): Promise<FuelCache> {
  const response = await fetch(GEOPORTAL_URL, {
    headers: { Accept: "application/json" },
    // The response is far above Next's 2 MB data cache limit; we keep our own cache instead
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Geoportal error: ${response.status}`);
  const data = (await response.json()) as { Fecha?: string; ListaEESSPrecio?: GeoportalStation[] };
  const stations = (data.ListaEESSPrecio ?? []).map(toStation).filter((s): s is FuelStation => s !== null);
  return { stations, updatedAt: data.Fecha ?? null, fetchedAt: Date.now() };
}

async function getAllStations(): Promise<FuelCache> {
  const cached = globalForFuel.fuelCache;
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  // One download at a time, shared by concurrent requests
  if (!globalForFuel.fuelLoading) {
    globalForFuel.fuelLoading = download()
      .then((fresh) => {
        globalForFuel.fuelCache = fresh;
        return fresh;
      })
      .finally(() => {
        globalForFuel.fuelLoading = undefined;
      });
  }

  try {
    return await globalForFuel.fuelLoading;
  } catch (error) {
    // Serve stale prices rather than nothing when the ministry is down
    if (cached) return cached;
    throw error;
  }
}

export async function listFuelStations(bounds: {
  left: number;
  right: number;
  bottom: number;
  top: number;
}): Promise<FuelStationsResponse> {
  const { stations, updatedAt } = await getAllStations();
  return {
    stations: stations.filter(
      (s) => s.lat >= bounds.bottom && s.lat <= bounds.top && s.lon >= bounds.left && s.lon <= bounds.right
    ),
    updatedAt,
  };
}
