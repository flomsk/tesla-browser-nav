import type { Bounds } from "@/lib/bounds";
import type { ChargerConnector, ChargingStation } from "@/types/poi";

// Open Charge Map: community database of EV chargers, free API key from https://openchargemap.org
const OCM_URL = "https://api.openchargemap.io/v3/poi/";
const OCM_KEY = process.env.OPEN_CHARGE_MAP_KEY;
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_RESULTS = 500;
// Open Charge Map operator ids for Tesla: 23 = Tesla-only sites, 3534 = sites open to all EVs
const TESLA_OPERATOR_IDS = [23, 3534];

interface OcmPoi {
  ID: number;
  OperatorID?: number;
  OperatorInfo?: { ID?: number; Title?: string };
  UsageType?: { Title?: string };
  StatusType?: { IsOperational?: boolean | null };
  NumberOfPoints?: number | null;
  AddressInfo?: {
    Title?: string;
    AddressLine1?: string;
    Town?: string;
    Latitude?: number;
    Longitude?: number;
  };
  Connections?: Array<{
    ConnectionType?: { Title?: string };
    PowerKW?: number | null;
    Quantity?: number | null;
  }>;
}

const globalForChargers = globalThis as unknown as {
  chargerCache?: Map<string, { stations: ChargingStation[]; fetchedAt: number }>;
};
const cache = (globalForChargers.chargerCache ??= new Map());

export function isChargingDataConfigured(): boolean {
  return Boolean(OCM_KEY);
}

function toStation(poi: OcmPoi): ChargingStation | null {
  const lat = poi.AddressInfo?.Latitude;
  const lon = poi.AddressInfo?.Longitude;
  if (typeof lat !== "number" || typeof lon !== "number") return null;

  const connectors: ChargerConnector[] = (poi.Connections ?? []).map((c) => ({
    type: c.ConnectionType?.Title ?? "Unknown",
    powerKw: c.PowerKW ?? null,
    quantity: c.Quantity ?? 1,
  }));
  const powers = connectors.map((c) => c.powerKw).filter((p): p is number => typeof p === "number" && p > 0);
  const operatorId = poi.OperatorInfo?.ID ?? poi.OperatorID;
  const operator = poi.OperatorInfo?.Title ?? null;

  return {
    id: `ocm-${poi.ID}`,
    name: poi.AddressInfo?.Title ?? "Charging station",
    operator,
    lat,
    lon,
    address: [poi.AddressInfo?.AddressLine1, poi.AddressInfo?.Town].filter(Boolean).join(", "),
    maxPowerKw: powers.length > 0 ? Math.max(...powers) : null,
    points: poi.NumberOfPoints ?? null,
    connectors,
    isTesla: (operatorId !== undefined && TESLA_OPERATOR_IDS.includes(operatorId)) || /tesla/i.test(operator ?? ""),
    isOperational: poi.StatusType?.IsOperational ?? null,
    usage: poi.UsageType?.Title ?? null,
  };
}

// Snap to a 0.05° grid so small map pans hit the same cache entry
function cacheKey(bounds: Bounds): string {
  const snap = (v: number, up: boolean) => ((up ? Math.ceil : Math.floor)(v * 20) / 20).toFixed(2);
  return [snap(bounds.bottom, false), snap(bounds.left, false), snap(bounds.top, true), snap(bounds.right, true)].join(",");
}

// teslaOnly asks Open Charge Map for Tesla's sites only, so wide areas aren't cut off by the
// result limit before any Supercharger shows up
export async function listChargingStations(bounds: Bounds, { teslaOnly = false } = {}): Promise<ChargingStation[]> {
  if (!OCM_KEY) throw new Error("OPEN_CHARGE_MAP_KEY is not set");

  const key = cacheKey(bounds);
  const entryKey = teslaOnly ? `${key}:operators=${TESLA_OPERATOR_IDS.join(",")}` : key;
  const cached = cache.get(entryKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.stations;

  const [bottom, left, top, right] = key.split(",");
  const params = new URLSearchParams({
    output: "json",
    boundingbox: `(${top},${left}),(${bottom},${right})`,
    maxresults: String(MAX_RESULTS),
    compact: "false",
    verbose: "false",
    ...(teslaOnly ? { operatorid: TESLA_OPERATOR_IDS.join(",") } : {}),
  });
  const response = await fetch(`${OCM_URL}?${params}`, {
    headers: { "X-API-Key": OCM_KEY, "User-Agent": "tesla-browser-nav" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Open Charge Map error: ${response.status}`);

  const stations = ((await response.json()) as OcmPoi[])
    .map(toStation)
    .filter((s): s is ChargingStation => s !== null);
  cache.set(entryKey, { stations, fetchedAt: Date.now() });
  return stations;
}
