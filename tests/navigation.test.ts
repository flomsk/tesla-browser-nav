import { computeProgress, indexRoute, maneuverArrow } from "@/lib/navigation";
import { findCameraAhead, warningDistanceFor } from "@/hooks/useCameraAlerts";
import { spokenDistance } from "@/lib/navLanguage";
import { formatShortDistance, limitInUnits, maxspeedToKmh } from "@/lib/units";
import type { RouteData } from "@/types/route";

let failures = 0;
function check(name: string, ok: boolean, detail: unknown = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${ok ? "" : JSON.stringify(detail)}`);
  if (!ok) failures++;
}

// Route in Madrid: 2 km north along lng -3.70, then right turn and 1 km east
const lat0 = 40.40;
const lng0 = -3.70;
const dLat1km = 1 / 111.32;
const dLng1km = 1 / (111.32 * Math.cos((lat0 * Math.PI) / 180));
const coords: [number, number][] = [];
for (let i = 0; i <= 20; i++) coords.push([lng0, lat0 + (i / 10) * dLat1km]);
for (let i = 1; i <= 10; i++) coords.push([lng0 + (i / 10) * dLng1km, lat0 + 2 * dLat1km]);

const route: RouteData = {
  id: "route-0",
  geometry: { type: "LineString", coordinates: coords },
  distance: 3000,
  duration: 180,
  summary: "test",
  maxspeeds: coords.slice(1).map((_, i) => (i < 20 ? 50 : 30)),
  congestion: [],
  segmentDurations: [],
  steps: [
    {
      instruction: "Head north", distance: 2000, duration: 120, name: "A",
      maneuver: { type: "depart", location: coords[0] },
      voiceInstructions: [
        { distanceAlongGeometry: 2000, announcement: "Head north, then turn right" },
        { distanceAlongGeometry: 400, announcement: "In 400 meters, turn right" },
        { distanceAlongGeometry: 60, announcement: "Turn right" },
      ],
    },
    {
      instruction: "Turn right onto B", distance: 1000, duration: 60, name: "B",
      maneuver: { type: "turn", modifier: "right", location: coords[20] },
      voiceInstructions: [{ distanceAlongGeometry: 1000, announcement: "Continue for 1 km" }],
    },
    {
      instruction: "You have arrived", distance: 0, duration: 0, name: "B",
      maneuver: { type: "arrive", location: coords[30] },
      voiceInstructions: [],
    },
  ],
};

const index = indexRoute(route);
check("total length ~3000m", Math.abs(index.total - 3000) < 15, index.total);
check("step starts", Math.abs(index.stepStarts[1] - 2000) < 10 && Math.abs(index.stepStarts[2] - index.total) < 1, index.stepStarts);

// 1.5 km north, 10 m east of the line
const p1 = computeProgress(route, index, lat0 + 1.5 * dLat1km, lng0 + 0.01 * dLng1km, null)!;
check("progress along", Math.abs(p1.distanceAlong - 1500) < 10, p1.distanceAlong);
check("off-route distance ~10m", Math.abs(p1.distanceFromRoute - 10) < 2, p1.distanceFromRoute);
check("current step 0, next is turn right", p1.stepIndex === 0 && p1.nextStep?.maneuver.modifier === "right", p1.stepIndex);
check("~500m to maneuver", Math.abs(p1.distanceToManeuver - 500) < 10, p1.distanceToManeuver);
check("remaining ~1500m / 90s", Math.abs(p1.remainingDistance - 1500) < 15 && Math.abs(p1.remainingDuration - 90) < 2, p1);
check("segment speed limit 50", p1.speedLimitKmh === 50, p1.speedLimitKmh);
check("arrow right", maneuverArrow(p1.nextStep!) === "→");

// Announcement selection: at 1650 m along -> 350 m to maneuver -> "In 400 meters" is due (and "Head north" too)
const p2 = computeProgress(route, index, lat0 + 1.65 * dLat1km, lng0, null)!;
const due = route.steps[p2.stepIndex].voiceInstructions.filter((v) => p2.distanceToManeuver <= v.distanceAlongGeometry);
const latest = due.reduce((a, b) => (a.distanceAlongGeometry < b.distanceAlongGeometry ? a : b));
check("speaks only the closest due announcement", latest.announcement === "In 400 meters, turn right", latest);

// After the turn
const p3 = computeProgress(route, index, lat0 + 2 * dLat1km, lng0 + 0.5 * dLng1km, null)!;
check("after turn: step 1, next arrive, limit 30", p3.stepIndex === 1 && p3.nextStep?.maneuver.type === "arrive" && p3.speedLimitKmh === 30, p3);
check("arrive arrow", maneuverArrow(p3.nextStep!) === "🏁");

// Cameras: one 400 m ahead (north), one 400 m behind, one 400 m to the east (side road)
const cam = (id: string, dLatKm: number, dLngKm: number, maxspeed?: string) => ({
  id, type: "speed_camera" as const, source: "dgt" as const, maxspeed,
  location: { lat: lat0 + dLatKm * dLat1km, lon: lng0 + dLngKm * dLng1km },
});
const cameras = [cam("ahead", 0.4, 0, "50"), cam("behind", -0.4, 0), cam("side", 0, 0.4)];
const w = findCameraAhead(cameras, lat0, lng0, 0, 500);
check("finds camera ahead only", w?.camera.id === "ahead" && Math.abs(w.distance - 400) < 5 && w.limitKmh === 50, w);
check("heading east picks side camera", findCameraAhead(cameras, lat0, lng0, 90, 500)?.camera.id === "side");
check("out of range -> none", findCameraAhead(cameras, lat0, lng0, 0, 300) === null);
const oneWay = (heading: number) => [{ ...cam("ahead", 0.4, 0), heading }];
check("camera for our direction warns", findCameraAhead(oneWay(10), lat0, lng0, 0, 500)?.camera.id === "ahead");
check("camera for the opposite direction is ignored", findCameraAhead(oneWay(180), lat0, lng0, 0, 500) === null);
check("warning distance clamps", warningDistanceFor(5) === 300 && warningDistanceFor(33) === 660 && warningDistanceFor(60) === 800 && warningDistanceFor(null) === 500);

// Formatting / speech
check("ru 1 km", spokenDistance(1000, "ru", "metric") === "1 километр", spokenDistance(1000, "ru", "metric"));
check("ru 2 km", spokenDistance(2000, "ru", "metric") === "2 километра");
check("ru 5 km", spokenDistance(5000, "ru", "metric") === "5 километров");
check("ru 1.5 km", spokenDistance(1500, "ru", "metric") === "1.5 километра");
check("ru 300 m", spokenDistance(300, "ru", "metric") === "300 метров");
check("es 500 m", spokenDistance(480, "es", "metric") === "500 metros", spokenDistance(480, "es", "metric"));
check("short distance metric", formatShortDistance(347, "metric") === "350 m" && formatShortDistance(1260, "metric") === "1.3 km");
check("short distance imperial", formatShortDistance(100, "imperial") === "350 ft", formatShortDistance(100, "imperial"));
check("limit in mph", limitInUnits(120, "imperial") === 75 && limitInUnits(50, "imperial") === 30, [limitInUnits(120, "imperial"), limitInUnits(50, "imperial")]);
check("maxspeed parse", maxspeedToKmh("50 mph") === 80 && maxspeedToKmh("120") === 120 && maxspeedToKmh("signals") === null);

console.log(failures === 0 ? "ALL PASSED" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
