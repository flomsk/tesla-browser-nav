import type { RouteData, RouteStep } from "@/types/route";

// Precomputed distances along a route so progress can be computed cheaply on every GPS fix
export interface RouteIndex {
  cumulative: number[]; // distance (m) from route start to each geometry vertex
  stepStarts: number[]; // distance (m) from route start to each step's maneuver
  total: number;
}

export interface RouteProgress {
  segmentIndex: number; // geometry segment we're on (coordinates[i] -> coordinates[i + 1])
  distanceAlong: number; // meters travelled along the route
  distanceFromRoute: number; // meters between the GPS fix and the route line
  stepIndex: number; // step we're currently driving
  nextStep: RouteStep | null; // maneuver at the end of the current step
  distanceToManeuver: number; // meters until nextStep's maneuver
  remainingDistance: number;
  remainingDuration: number; // seconds, scaled from the route's estimate
  speedLimitKmh: number | null; // limit on the current segment, if known
}

const DEG_TO_M = 111320;

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Project a point onto a segment in a local metric frame. Returns distance to the segment and
// the fraction t (0..1) along it.
function projectOnSegment(
  lat: number, lng: number,
  [aLng, aLat]: [number, number],
  [bLng, bLat]: [number, number]
): { distance: number; t: number } {
  const cos = Math.cos((aLat * Math.PI) / 180);
  const px = (lng - aLng) * DEG_TO_M * cos;
  const py = (lat - aLat) * DEG_TO_M;
  const bx = (bLng - aLng) * DEG_TO_M * cos;
  const by = (bLat - aLat) * DEG_TO_M;
  const lengthSq = bx * bx + by * by;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / lengthSq));
  return { distance: Math.hypot(px - t * bx, py - t * by), t };
}

export function indexRoute(route: RouteData): RouteIndex {
  const coords = route.geometry.coordinates;
  const cumulative = [0];
  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1] = coords[i - 1];
    const [lng2, lat2] = coords[i];
    cumulative.push(cumulative[i - 1] + haversine(lat1, lng1, lat2, lng2));
  }

  // Each maneuver location is (almost exactly) a geometry vertex; walk forward to find it
  const stepStarts: number[] = [];
  let searchFrom = 0;
  for (const step of route.steps) {
    const [mLng, mLat] = step.maneuver.location;
    let best = searchFrom;
    let bestDistance = Infinity;
    for (let i = searchFrom; i < coords.length; i++) {
      const d = haversine(mLat, mLng, coords[i][1], coords[i][0]);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
      if (d < 1) break; // exact vertex match
    }
    stepStarts.push(cumulative[best]);
    searchFrom = best;
  }

  return { cumulative, stepStarts, total: cumulative[cumulative.length - 1] ?? 0 };
}

function closestSegment(
  coords: [number, number][], lat: number, lng: number, from: number, to: number
): { index: number; distance: number; t: number } {
  let best = { index: from, distance: Infinity, t: 0 };
  for (let i = Math.max(0, from); i < Math.min(coords.length - 1, to); i++) {
    const { distance, t } = projectOnSegment(lat, lng, coords[i], coords[i + 1]);
    if (distance < best.distance) best = { index: i, distance, t };
  }
  return best;
}

// hintSegment: segment from the previous fix. We prefer matches just ahead of it so routes that
// pass near themselves (loops, interchanges) don't make progress jump around.
export function computeProgress(
  route: RouteData,
  index: RouteIndex,
  lat: number,
  lng: number,
  hintSegment: number | null
): RouteProgress | null {
  const coords = route.geometry.coordinates;
  if (coords.length < 2) return null;

  let match = hintSegment === null
    ? closestSegment(coords, lat, lng, 0, coords.length)
    : closestSegment(coords, lat, lng, hintSegment - 5, hintSegment + 300);
  if (match.distance > 60) {
    match = closestSegment(coords, lat, lng, 0, coords.length);
  }

  const segmentLength = index.cumulative[match.index + 1] - index.cumulative[match.index];
  const distanceAlong = index.cumulative[match.index] + match.t * segmentLength;

  let stepIndex = 0;
  for (let i = 0; i < index.stepStarts.length; i++) {
    if (index.stepStarts[i] <= distanceAlong + 1) stepIndex = i;
    else break;
  }

  const nextStep = route.steps[stepIndex + 1] ?? null;
  const stepEnd = index.stepStarts[stepIndex + 1] ?? index.total;
  const remainingDistance = Math.max(0, index.total - distanceAlong);

  return {
    segmentIndex: match.index,
    distanceAlong,
    distanceFromRoute: match.distance,
    stepIndex,
    nextStep,
    distanceToManeuver: Math.max(0, stepEnd - distanceAlong),
    remainingDistance,
    remainingDuration: index.total > 0 ? route.duration * (remainingDistance / index.total) : 0,
    speedLimitKmh: route.maxspeeds[match.index] ?? null,
  };
}

// Where a point sits relative to a polyline: metres along it to the closest spot, metres away,
// and the index of the closest segment
export function placeOnPolyline(
  coords: [number, number][], lat: number, lng: number
): { along: number; offset: number; segment: number } {
  if (coords.length < 2) {
    const [lng0, lat0] = coords[0] ?? [lng, lat];
    return { along: 0, offset: haversine(lat, lng, lat0, lng0), segment: 0 };
  }
  const match = closestSegment(coords, lat, lng, 0, coords.length);
  let along = 0;
  for (let i = 0; i < match.index; i++) {
    along += haversine(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
  }
  const [aLng, aLat] = coords[match.index];
  const [bLng, bLat] = coords[match.index + 1];
  along += match.t * haversine(aLat, aLng, bLat, bLng);
  return { along, offset: match.distance, segment: match.index };
}

// The route still ahead of the driver, starting at their position: at most maxMeters long and
// thinned to maxPoints vertices so it fits in a request
export function routeAhead(
  route: RouteData, progress: RouteProgress, lat: number, lng: number, maxMeters = 80000, maxPoints = 120
): [number, number][] {
  const coords = route.geometry.coordinates;
  const ahead: [number, number][] = [[lng, lat]];
  let travelled = 0;
  for (let i = progress.segmentIndex + 1; i < coords.length && travelled < maxMeters; i++) {
    const [prevLng, prevLat] = ahead[ahead.length - 1];
    travelled += haversine(prevLat, prevLng, coords[i][1], coords[i][0]);
    ahead.push(coords[i]);
  }
  if (ahead.length <= maxPoints) return ahead;
  const stride = (ahead.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, k) => ahead[Math.round(k * stride)]);
}

// Compass bearing (0 = north, clockwise) from a to b
export function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function angleDifference(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// Big arrow for the maneuver banner
export function maneuverArrow(step: RouteStep): string {
  const { type, modifier } = step.maneuver;
  if (type === "arrive") return "🏁";
  if (type === "roundabout" || type === "rotary" || type === "roundabout turn") return "⟳";
  switch (modifier) {
    case "uturn": return "⤺";
    case "sharp left": return "↙";
    case "left": return "←";
    case "slight left": return "↖";
    case "straight": return "↑";
    case "slight right": return "↗";
    case "right": return "→";
    case "sharp right": return "↘";
    default: return "↑";
  }
}
