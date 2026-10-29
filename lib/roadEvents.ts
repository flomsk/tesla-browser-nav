import type { RoadEvent, RoadEventKind, RoadEventsResponse, TravelDirection } from "@/types/roadEvent";

// DGT live traffic incidents (DATEX II v3), all of Spain except Catalonia and the Basque Country,
// which publish their own. Free, no key, ~5 MB, refreshed by DGT every few minutes.
const DGT_SITUATIONS_URL = "https://nap.dgt.es/datex2/v3/dgt/SituationPublication/datex2_v36.xml";
const CACHE_TTL_MS = 3 * 60 * 1000;

// When one situation has several records (roadworks + lane closure + ...), the most
// important one decides what we tell the driver
const KIND_PRIORITY: RoadEventKind[] = [
  "closure", "accident", "vehicleFire", "obstacle", "rockfall", "flooding", "stoppedVehicle",
  "lowVisibility", "badSurface", "slowTraffic", "laneClosed", "roadworks",
];

// DATEX II detailed cause / management values -> our kinds
const KIND_BY_VALUE: Record<string, RoadEventKind> = {
  accident: "accident",
  roadClosed: "closure",
  carriagewayClosures: "closure",
  vehicleOnFire: "vehicleFire",
  vehicleStuck: "stoppedVehicle",
  objectOnTheRoad: "obstacle",
  obstructionOnTheRoad: "obstacle",
  spillageOnTheRoad: "obstacle",
  rockfalls: "rockfall",
  flooding: "flooding",
  damagedRoadSurface: "badSurface",
  roadSurfaceInPoorCondition: "badSurface",
  fog: "lowVisibility",
  visibilityReduced: "lowVisibility",
  smokeHazard: "lowVisibility",
  slowTraffic: "slowTraffic",
  laneClosures: "laneClosed",
  singleAlternateLineTraffic: "laneClosed",
  narrowLanes: "laneClosed",
  roadworks: "roadworks",
};

// Things that clear within hours. DGT sometimes leaves them open for months; past a day we
// assume they are stale rather than warn about a crash that is long gone.
const SHORT_LIVED = new Set<RoadEventKind>(["accident", "vehicleFire", "stoppedVehicle", "obstacle", "slowTraffic", "lowVisibility"]);
const SHORT_LIVED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const DIRECTIONS = new Set<TravelDirection>([
  "northBound", "northEastBound", "eastBound", "southEastBound",
  "southBound", "southWestBound", "westBound", "northWestBound",
]);

const globalForEvents = globalThis as unknown as {
  roadEventsCache?: RoadEventsResponse & { fetchedAt: number };
  roadEventsLoading?: Promise<RoadEventsResponse & { fetchedAt: number }>;
};

function first(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match ? match[1] : null;
}

function coordinates(xml: string | undefined): { lat: number; lon: number } | null {
  if (!xml) return null;
  const lat = parseFloat(first(xml, "loc:latitude") ?? "");
  const lon = parseFloat(first(xml, "loc:longitude") ?? "");
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function parseSituation(id: string, xml: string, now: number): RoadEvent | null {
  // Planned events that haven't started yet don't matter to someone driving now
  const startTime = first(xml, "com:overallStartTime");
  if (startTime && Date.parse(startTime) > now) return null;
  if (/<com:validityStatus>(suspended|planned)</.test(xml)) return null;

  const values = [...xml.matchAll(/<sit:[a-zA-Z]+Type>([^<]+)<\/sit:[a-zA-Z]+Type>/g)].map((m) => m[1]);
  const kinds = values.map((v) => KIND_BY_VALUE[v]).filter((k): k is RoadEventKind => k !== undefined);
  if (kinds.length === 0) return null;
  const kind = KIND_PRIORITY.find((k) => kinds.includes(k))!;
  if (SHORT_LIVED.has(kind) && startTime && now - Date.parse(startTime) > SHORT_LIVED_MAX_AGE_MS) return null;

  // Linear stretches have <loc:from> and <loc:to>; point locations have a single coordinate
  const from = coordinates(xml.match(/<loc:from[ >][\s\S]*?<\/loc:from>/)?.[0]);
  const to = coordinates(xml.match(/<loc:to[ >][\s\S]*?<\/loc:to>/)?.[0]);
  const start = from ?? coordinates(xml);
  if (!start) return null;

  const direction = first(xml, "loc:tpegDirection") as TravelDirection | null;
  const severity = first(xml, "sit:overallSeverity") ?? first(xml, "sit:severity");
  const km = parseFloat(first(xml, "lse:kilometerPoint") ?? "");

  return {
    id: `dgt-${id}`,
    kind,
    severity: severity === "low" || severity === "medium" || severity === "high" || severity === "highest" ? severity : null,
    road: first(xml, "loc:roadName"),
    km: Number.isFinite(km) ? km : null,
    direction: direction && DIRECTIONS.has(direction) ? direction : "unknown",
    start,
    end: from && to ? to : null,
    startTime,
    endTime: first(xml, "com:overallEndTime"),
  };
}

export function parseDgtSituations(xml: string, now = Date.now()): RoadEventsResponse {
  const events: RoadEvent[] = [];
  for (const chunk of xml.split("<sit:situation id=\"").slice(1)) {
    const id = chunk.slice(0, chunk.indexOf("\""));
    const event = parseSituation(id, chunk, now);
    if (event) events.push(event);
  }
  return { events, updatedAt: first(xml, "com:publicationTime") };
}

async function download() {
  const response = await fetch(DGT_SITUATIONS_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`DGT situations error: ${response.status}`);
  return { ...parseDgtSituations(await response.text()), fetchedAt: Date.now() };
}

export async function listRoadEvents(): Promise<RoadEventsResponse> {
  const cached = globalForEvents.roadEventsCache;
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  // One download at a time, shared by concurrent requests
  if (!globalForEvents.roadEventsLoading) {
    globalForEvents.roadEventsLoading = download()
      .then((fresh) => {
        globalForEvents.roadEventsCache = fresh;
        return fresh;
      })
      .finally(() => {
        globalForEvents.roadEventsLoading = undefined;
      });
  }

  try {
    return await globalForEvents.roadEventsLoading;
  } catch (error) {
    // Slightly stale incidents beat none when DGT is briefly down
    if (cached) return cached;
    throw error;
  }
}
