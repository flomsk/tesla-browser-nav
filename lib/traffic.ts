import { haversine, placeOnPolyline } from "@/lib/navigation";
import type { RouteIndex } from "@/lib/navigation";
import type { Congestion, RouteData } from "@/types/route";

// Share of a fresh route that must follow ours for it to count as "the same way"
const SAME_ROUTE_OVERLAP = 0.85;
// Worth bothering the driver only for a real gain
export const MIN_SAVING_SECONDS = 3 * 60;

// A stretch of the route in heavy or severe traffic
export interface TrafficJam {
  start: [number, number]; // lng, lat where it begins (identifies the jam across route refreshes)
  startAlong: number; // metres from route start
  endAlong: number;
  delaySeconds: number; // extra time compared with driving it at a normal speed
  severe: boolean;
}

export interface JamWarning {
  jam: TrafficJam;
  distance: number; // metres ahead of the driver
}

// Small gaps of lighter traffic inside a jam don't split it in two
const MERGE_GAP_METERS = 200;
// Shorter slowdowns (a busy junction) aren't worth announcing
const MIN_JAM_METERS = 300;
const MIN_DELAY_SECONDS = 30;
// Announce a jam this far before it starts
export const JAM_WARNING_METERS = 2000;
// Without a known speed limit, assume this free-flow speed (km/h)
const DEFAULT_FREE_FLOW_KMH = 50;

const JAM_LEVELS = new Set<Congestion>(["heavy", "severe"]);

// Consecutive segments with the same traffic level, for drawing the route in colours
export function congestionRuns(route: RouteData): { level: Congestion; coordinates: [number, number][] }[] {
  const coords = route.geometry.coordinates;
  const runs: { level: Congestion; coordinates: [number, number][] }[] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const level = route.congestion[i] ?? "unknown";
    const last = runs[runs.length - 1];
    if (last && last.level === level) last.coordinates.push(coords[i + 1]);
    else runs.push({ level, coordinates: [coords[i], coords[i + 1]] });
  }
  return runs;
}

// Jams along the whole route, in order
export function jamsOnRoute(route: RouteData, index: RouteIndex): TrafficJam[] {
  const coords = route.geometry.coordinates;
  const jams: TrafficJam[] = [];
  let current: TrafficJam | null = null;

  for (let i = 0; i < coords.length - 1; i++) {
    const level = route.congestion[i];
    if (!level || !JAM_LEVELS.has(level)) continue;

    const startAlong = index.cumulative[i];
    const endAlong = index.cumulative[i + 1];
    const length = endAlong - startAlong;
    const freeFlowMps = ((route.maxspeeds[i] ?? DEFAULT_FREE_FLOW_KMH) * 0.9) / 3.6;
    const expected = route.segmentDurations[i] ?? length / freeFlowMps;
    const delay = Math.max(0, expected - length / freeFlowMps);

    if (current && startAlong - current.endAlong <= MERGE_GAP_METERS) {
      current.endAlong = endAlong;
      current.delaySeconds += delay;
      current.severe ||= level === "severe";
    } else {
      current = { start: coords[i], startAlong, endAlong, delaySeconds: delay, severe: level === "severe" };
      jams.push(current);
    }
  }

  return jams.filter((j) => j.endAlong - j.startAlong >= MIN_JAM_METERS && j.delaySeconds >= MIN_DELAY_SECONDS);
}

export function nextJam(jams: TrafficJam[], distanceAlong: number): JamWarning | null {
  for (const jam of jams) {
    if (jam.endAlong < distanceAlong) continue; // already through it
    const distance = jam.startAlong - distanceAlong;
    if (distance > JAM_WARNING_METERS) return null; // jams are in order: the rest are further
    return { jam, distance: Math.max(0, distance) };
  }
  return null;
}

// Share of `candidate` that runs along `reference` (within ~60 m), sampled. Used to tell
// whether a freshly calculated route is the one we're driving or a different way.
export function routeOverlap(candidate: [number, number][], reference: [number, number][], samples = 25): number {
  if (candidate.length < 2 || reference.length < 2) return 0;
  let total = 0;
  const lengths = [0];
  for (let i = 1; i < candidate.length; i++) {
    total += haversine(candidate[i - 1][1], candidate[i - 1][0], candidate[i][1], candidate[i][0]);
    lengths.push(total);
  }
  let matched = 0;
  let j = 0;
  for (let k = 0; k < samples; k++) {
    const target = (total * (k + 0.5)) / samples;
    while (j < lengths.length - 2 && lengths[j + 1] < target) j++;
    const [lng, lat] = candidate[j];
    if (placeOnPolyline(reference, lat, lng).offset <= 60) matched++;
  }
  return matched / samples;
}

// Given freshly calculated routes from the driver's position: which one is the way we're already
// driving (to refresh its traffic), and whether another is enough faster to offer
export function pickFasterRoute(
  candidates: RouteData[],
  ahead: [number, number][], // what's left of the current route
  currentRemainingSeconds: number, // fallback when the current way isn't among the candidates
  dismissed: [number, number][][]
): { same: RouteData | null; faster: { route: RouteData; savingSeconds: number } | null } {
  const same = candidates.find((c) => routeOverlap(c.geometry.coordinates, ahead) >= SAME_ROUTE_OVERLAP) ?? null;
  const currentSeconds = same?.duration ?? currentRemainingSeconds;

  const best = candidates
    .filter((c) => c !== same)
    .filter((c) => !dismissed.some((d) => routeOverlap(c.geometry.coordinates, d) >= SAME_ROUTE_OVERLAP))
    .sort((a, b) => a.duration - b.duration)[0];
  const savingSeconds = best ? currentSeconds - best.duration : 0;

  return { same, faster: best && savingSeconds >= MIN_SAVING_SECONDS ? { route: best, savingSeconds } : null };
}
