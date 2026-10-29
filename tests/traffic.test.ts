import { indexRoute } from "@/lib/navigation";
import { congestionRuns, jamsOnRoute, nextJam, pickFasterRoute, routeOverlap } from "@/lib/traffic";
import type { Congestion, RouteData } from "@/types/route";

let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${ok ? "" : JSON.stringify(detail)}`);
  if (!ok) failures++;
};

// 10 km straight road, 100 m segments, motorway limit 120
const lat = 40.4;
const dLng = 1 / (111320 * Math.cos((lat * Math.PI) / 180));
const coords: [number, number][] = Array.from({ length: 101 }, (_, i) => [-3.7 + i * 100 * dLng, lat]);
const congestion: Congestion[] = Array(100).fill("low");
// Jam from 4.0 to 5.5 km with a 100 m lighter gap at 4.6 km; a 200 m slowdown at 8 km
for (let i = 40; i < 55; i++) congestion[i] = i === 46 ? "moderate" : i >= 50 ? "severe" : "heavy";
congestion[80] = congestion[81] = "heavy";
// Jammed segments crawl at ~10 km/h (36 s per 100 m), the rest at the limit
const segmentDurations = congestion.map((c) => (c === "heavy" || c === "severe" ? 36 : 3.3));
const route = {
  id: "t", geometry: { type: "LineString", coordinates: coords }, distance: 10000, duration: 600,
  steps: [], summary: "", maxspeeds: Array(100).fill(120), congestion, segmentDurations,
} as unknown as RouteData;

const jams = jamsOnRoute(route, indexRoute(route));
check("one jam, gap merged, short slowdown ignored", jams.length === 1, jams);
const jam = jams[0];
check("jam spans 4.0–5.5 km", Math.abs(jam.startAlong - 4000) < 20 && Math.abs(jam.endAlong - 5500) < 20, jam);
check("delay ≈ 14 segments × (36 − 3.3) s ≈ 7.6 min", Math.abs(jam.delaySeconds - 14 * (36 - 100 / (108 / 3.6))) < 5, jam.delaySeconds);
check("marked severe", jam.severe);
check("no warning 3 km before", nextJam(jams, 1000) === null);
check("warning 1.5 km before", Math.abs((nextJam(jams, 2500)?.distance ?? -1) - 1500) < 20);
check("still shown inside the jam (distance 0)", nextJam(jams, 4800)?.distance === 0);
check("gone after the jam", nextJam(jams, 5600) === null);

const runs = congestionRuns(route);
check("runs merge equal neighbours", runs.length === 8 && runs.reduce((n, r) => n + r.coordinates.length - 1, 0) === 100, runs.map((r) => `${r.level}:${r.coordinates.length - 1}`));

// Overlap: identical road vs a parallel road 500 m north
const parallel = coords.map(([lng, la]) => [lng, la + 500 / 111320] as [number, number]);
check("same road overlaps fully", routeOverlap(coords, coords) === 1);
check("parallel road doesn't overlap", routeOverlap(parallel, coords) === 0);
check("half-shared route ~0.5", Math.abs(routeOverlap([...coords.slice(0, 51), ...parallel.slice(51)], coords) - 0.5) <= 0.1);

// Faster route decision
const mk = (c: [number, number][], duration: number) => ({ ...route, geometry: { type: "LineString", coordinates: c }, duration }) as RouteData;
const sameWay = mk(coords, 900);
const otherWay = mk(parallel, 600);
let pick = pickFasterRoute([sameWay, otherWay], coords, 700, []);
check("finds the same way and refreshes it", pick.same === sameWay);
check("offers the other way saving 5 min (vs fresh same-way ETA)", pick.faster?.route === otherWay && pick.faster.savingSeconds === 300, pick.faster);
pick = pickFasterRoute([mk(coords, 700), mk(parallel, 600)], coords, 700, []);
check("no offer for under 3 min", pick.faster === null);
pick = pickFasterRoute([sameWay, otherWay], coords, 700, [parallel]);
check("dismissed way not offered again", pick.faster === null);
pick = pickFasterRoute([otherWay], coords, 1000, []);
check("current way missing: compare with remaining ETA", pick.same === null && pick.faster?.savingSeconds === 400);

console.log(failures === 0 ? "ALL PASSED" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
