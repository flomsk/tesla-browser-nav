import { searchArea, visibleRoute } from "@/lib/placeSearch";
import type { PlaceQuery } from "@/lib/placeSearch";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(detail)}`);
}

const base: PlaceQuery = { category: "charging", near: [-0.481, 38.3452], fuelType: "g95", language: "en" };
// Screen of roughly 5.4° x 3.3° around La Mancha, Madrid in its top-left corner
const center: [number, number] = [-2.19, 39.44];
const view = { left: -4.9, right: 0.5, bottom: 37.8, top: 41.1 };
const span = (b: { left: number; right: number; bottom: number; top: number }) =>
  Math.max(b.right - b.left, b.top - b.bottom);

const noView = searchArea({ ...base, center });
check("without a view: default ~5 km radius", Math.abs(span(noView) - 0.1) < 1e-9, noView);

const wide = searchArea({ ...base, center, view });
check("any charger: view clamped to 0.6° around the centre", Math.abs(span(wide) - 0.6) < 1e-9, wide);

const tesla = searchArea({ ...base, center, view, teslaOnly: true });
check("tesla: Madrid (-3.70, 40.42) is inside the area", tesla.left <= -3.7 && tesla.top >= 40.42, tesla);
check("tesla: never wider than 4°", span(tesla) <= 4 + 1e-9, tesla);

const tiny = { left: -2.195, right: -2.185, bottom: 39.435, top: 39.445 };
const small = searchArea({ ...base, center, view: tiny, teslaOnly: false });
check("tiny view never shrinks below the default area", Math.abs(span(small) - 0.1) < 1e-9, small);

const shortRoute = searchArea({ ...base, route: [[-0.48, 38.34], [-0.5, 38.4]] });
check("along a route without a view: the route's own box", span(shortRoute) < 0.2, shortRoute);

// Alicante -> Madrid, one point per 0.1°, looking at the stretch near Madrid
const trip: [number, number][] = Array.from({ length: 33 }, (_, i) => [-0.48 - i * 0.1, 38.35 + i * 0.065]);
const madridStretch = { left: -4.0, right: -2.8, bottom: 40.0, top: 40.8 };
const whole = searchArea({ ...base, route: trip });
const seen = searchArea({ ...base, route: trip, view: madridStretch });
check("along a route: whole trip is wider than 3°", span(whole) > 3, whole);
check("along a route + view: only the stretch on screen", span(seen) < 2, seen);
check("along a route + view: Madrid end of the route is inside", seen.left <= -3.5 && seen.top >= 40.4, seen);

const part = visibleRoute({ ...base, route: trip, view: madridStretch });
check("visibleRoute: a sub-stretch ending at Madrid", !!part && part.length >= 2 && part.length < trip.length / 2, part?.length);
check("visibleRoute: starts after the car, ends at the route's end", !!part && part[part.length - 1] === trip[trip.length - 1] && part[0] !== trip[0]);
check("visibleRoute: null when the screen shows none of the route", visibleRoute({ ...base, route: trip, view: { left: 10, right: 12, bottom: 50, top: 52 } }) === null);
check("visibleRoute: untouched without a view", visibleRoute({ ...base, route: trip }) === trip);

if (failed > 0) {
  console.log(`${failed} failed`);
  process.exit(1);
}
