import { angleDifference, bearing, haversine, placeOnPolyline } from "@/lib/navigation";
import type { RouteData } from "@/types/route";
import type { RoadEvent, RoadEventKind, TravelDirection } from "@/types/roadEvent";
import type { WazeAlert } from "@/types/waze";

// An incident on the current route, with its position along it
export interface RouteEvent {
  event: RoadEvent;
  along: number; // metres from the route start to where the incident begins
}

export interface RoadEventWarning {
  event: RoadEvent;
  distance: number; // metres ahead of the driver
}

// How far the incident may be from the route line and still be "on" it
const ON_ROUTE_METERS = 40;
// A carriageway's direction must roughly match ours (incidents on the other side don't matter)
const MAX_DIRECTION_DIFF = 70;
// Without a route: incidents in this cone around the heading count as ahead
const AHEAD_HALF_ANGLE = 30;

const DIRECTION_BEARING: Record<Exclude<TravelDirection, "unknown">, number> = {
  northBound: 0, northEastBound: 45, eastBound: 90, southEastBound: 135,
  southBound: 180, southWestBound: 225, westBound: 270, northWestBound: 315,
};

// Warn earlier for things that stop you than for things that slow you down
export const WARNING_DISTANCE: Record<RoadEventKind, number> = {
  closure: 3000,
  accident: 2000,
  vehicleFire: 2000,
  obstacle: 1500,
  rockfall: 1500,
  flooding: 1500,
  stoppedVehicle: 1000,
  lowVisibility: 1500,
  badSurface: 1000,
  slowTraffic: 2000,
  laneClosed: 1000,
  roadworks: 800,
};

// Kinds worth showing on the map when not navigating (lane closures, roadworks and stopped
// cars on the shoulder only matter on your own route)
const SHOWN_OFF_ROUTE = new Set<RoadEventKind>(["accident", "closure", "vehicleFire", "obstacle", "rockfall", "flooding", "lowVisibility"]);

function matchesDirection(event: RoadEvent, travelBearing: number): boolean {
  if (event.direction === "unknown") return true;
  return angleDifference(DIRECTION_BEARING[event.direction], travelBearing) <= MAX_DIRECTION_DIFF;
}

// Incidents on the route in our direction of travel, ordered along it. Run once per route /
// incident list, not per GPS fix.
export function eventsOnRoute(events: RoadEvent[], route: RouteData): RouteEvent[] {
  const coords = route.geometry.coordinates;
  if (coords.length < 2) return [];

  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  const pad = 0.01;
  const [west, east] = [Math.min(...lngs) - pad, Math.max(...lngs) + pad];
  const [south, north] = [Math.min(...lats) - pad, Math.max(...lats) + pad];
  const inBox = (p: { lat: number; lon: number }) => p.lon >= west && p.lon <= east && p.lat >= south && p.lat <= north;

  const result: RouteEvent[] = [];
  for (const event of events) {
    if (!inBox(event.start) && !(event.end && inBox(event.end))) continue;

    const start = placeOnPolyline(coords, event.start.lat, event.start.lon);
    const end = event.end ? placeOnPolyline(coords, event.end.lat, event.end.lon) : null;
    const startOn = start.offset <= ON_ROUTE_METERS;
    const endOn = end !== null && end.offset <= ON_ROUTE_METERS;
    if (!startOn && !endOn) continue;

    if (startOn && endOn) {
      // A stretch runs from start to end in its direction of traffic: it must run our way
      if (start.along > end!.along + 20) continue;
    } else {
      const at = startOn ? start : end!;
      const a = coords[at.segment];
      const b = coords[at.segment + 1] ?? a;
      if (!matchesDirection(event, bearing(a[1], a[0], b[1], b[0]))) continue;
    }

    result.push({ event, along: startOn ? start.along : end!.along });
  }
  return result.sort((x, y) => x.along - y.along);
}

// The next incident on the route that is close enough to announce
export function nextRouteWarning(routeEvents: RouteEvent[], distanceAlong: number): RoadEventWarning | null {
  for (const { event, along } of routeEvents) {
    const distance = along - distanceAlong;
    if (distance < -30) continue; // already passed
    if (distance <= WARNING_DISTANCE[event.kind]) return { event, distance: Math.max(0, distance) };
  }
  return null;
}

// Without a route: the closest incident ahead in our heading, on a carriageway going our way
export function warningByHeading(
  events: RoadEvent[], lat: number, lng: number, heading: number
): RoadEventWarning | null {
  let best: RoadEventWarning | null = null;
  for (const event of events) {
    const distance = haversine(lat, lng, event.start.lat, event.start.lon);
    if (distance > WARNING_DISTANCE[event.kind] || distance < 30) continue;
    if (angleDifference(bearing(lat, lng, event.start.lat, event.start.lon), heading) > AHEAD_HALF_ANGLE) continue;
    if (!matchesDirection(event, heading)) continue;
    if (!best || distance < best.distance) best = { event, distance };
  }
  return best;
}

export function shownWithoutRoute(event: RoadEvent): boolean {
  return SHOWN_OFF_ROUTE.has(event.kind);
}

const ALERT_TYPE: Partial<Record<RoadEventKind, WazeAlert["type"]>> = {
  accident: "ACCIDENT",
  vehicleFire: "ACCIDENT",
  closure: "ROAD_CLOSED",
  slowTraffic: "JAM",
};

// Map markers reuse the alert pins (icons, clustering, popups)
export function toMapAlert(event: RoadEvent, label: string): WazeAlert {
  return {
    uuid: event.id,
    type: ALERT_TYPE[event.kind] ?? "HAZARD",
    subtype: label,
    street: [event.road, event.km !== null ? `km ${event.km}` : null].filter(Boolean).join(" · ") || undefined,
    location: { x: event.start.lon, y: event.start.lat },
    reliability: 10,
    pubMillis: event.startTime ? Date.parse(event.startTime) : Date.now(),
    reportBy: "DGT",
    provider: "dgt",
  };
}
