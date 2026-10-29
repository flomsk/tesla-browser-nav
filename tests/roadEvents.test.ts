import { eventsOnRoute, nextRouteWarning, warningByHeading } from "@/lib/roadEventAlerts";
import { parseDgtSituations } from "@/lib/roadEvents";
import type { RoadEvent } from "@/types/roadEvent";
import type { RouteData } from "@/types/route";

let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${ok ? "" : JSON.stringify(detail)}`);
  if (!ok) failures++;
};

// Two situations in DGT's DATEX II shape: a fresh accident stretch and a months-old one
const situation = (id: string, start: string, type: string, value: string) => `
<sit:situation id="${id}"><sit:overallSeverity>high</sit:overallSeverity>
<sit:situationRecord xsi:type="sit:Accident" id="r${id}" version="1">
<sit:validity><com:validityStatus>active</com:validityStatus><com:validityTimeSpecification>
<com:overallStartTime>${start}</com:overallStartTime></com:validityTimeSpecification></sit:validity>
<sit:cause><sit:causeType>accident</sit:causeType><sit:detailedCauseType><sit:${type}>${value}</sit:${type}></sit:detailedCauseType></sit:cause>
<sit:locationReference xsi:type="loc:SingleRoadLinearLocation"><loc:supplementaryPositionalDescription><loc:roadInformation><loc:roadName>A-6</loc:roadName></loc:roadInformation></loc:supplementaryPositionalDescription>
<loc:tpegLinearLocation><loc:tpegDirection>northWestBound</loc:tpegDirection>
<loc:to xsi:type="loc:TpegNonJunctionPoint"><loc:pointCoordinates><loc:latitude>40.48</loc:latitude><loc:longitude>-3.87</loc:longitude></loc:pointCoordinates></loc:to>
<loc:from xsi:type="loc:TpegNonJunctionPoint"><loc:pointCoordinates><loc:latitude>40.47</loc:latitude><loc:longitude>-3.86</loc:longitude></loc:pointCoordinates>
<loc:_tpegNonJunctionPointExtension><loc:extendedTpegNonJunctionPoint><lse:kilometerPoint>18.5</lse:kilometerPoint></loc:extendedTpegNonJunctionPoint></loc:_tpegNonJunctionPointExtension></loc:from>
</loc:tpegLinearLocation></sit:locationReference></sit:situationRecord></sit:situation>`;
const now = Date.parse("2026-10-29T19:48:00+01:00");
const xml = `<d2:payload><com:publicationTime>2026-10-29T19:46:17+01:00</com:publicationTime>${situation("1", "2026-10-29T18:30:00+01:00", "accidentType", "accident")}${situation("2", "2026-05-25T19:05:00+02:00", "accidentType", "accident")}${situation("3", "2026-05-25T19:05:00+02:00", "roadOrCarriagewayOrLaneManagementType", "roadClosed")}</d2:payload>`;
const parsed = parseDgtSituations(xml, now);
check("fresh accident parsed with stretch, road, km, direction",
  parsed.events.some((e) => e.id === "dgt-1" && e.kind === "accident" && e.road === "A-6" && e.km === 18.5
    && e.direction === "northWestBound" && e.start.lat === 40.47 && e.end?.lat === 40.48), parsed.events);
check("months-old accident dropped as stale", !parsed.events.some((e) => e.id === "dgt-2"));
check("long-lived closure kept", parsed.events.some((e) => e.id === "dgt-3" && e.kind === "closure"));

// Synthetic straight eastbound road at lat 40.4, 10 km long
const lat = 40.4;
const dLng = 1 / (111320 * Math.cos((lat * Math.PI) / 180));
const coords: [number, number][] = Array.from({ length: 101 }, (_, i) => [-3.7 + i * 100 * dLng, lat]);
const route = { geometry: { type: "LineString", coordinates: coords }, steps: [], maxspeeds: [], distance: 10000, duration: 600 } as unknown as RouteData;
const at = (m: number) => ({ lat, lon: -3.7 + m * dLng });
const ev = (id: string, p: Partial<RoadEvent>): RoadEvent => ({
  id, kind: "accident", severity: null, road: "A-1", km: 1, direction: "unknown",
  start: at(0), end: null, startTime: null, endTime: null, ...p,
});

const events: RoadEvent[] = [
  ev("ours-point", { start: at(3000), direction: "eastBound" }),
  ev("other-side", { start: at(4000), direction: "westBound" }),
  ev("stretch-our-way", { kind: "roadworks", start: at(6000), end: at(6500) }),
  ev("stretch-other-way", { kind: "roadworks", start: at(7500), end: at(7000) }),
  ev("off-road", { start: { lat: lat + 0.01, lon: at(5000).lon } }),
  ev("unknown-dir", { kind: "closure", start: at(9000) }),
];
const onRoute = eventsOnRoute(events, route);
const expected: [string, number][] = [["ours-point", 3000], ["stretch-our-way", 6000], ["unknown-dir", 9000]];
check("keeps events in our direction, drops other side / off road",
  onRoute.length === 3 && expected.every(([id, m], i) => onRoute[i].event.id === id && Math.abs(onRoute[i].along - m) < 30),
  onRoute.map((r) => `${r.event.id}@${Math.round(r.along)}`));

const routeEvents = eventsOnRoute(events, route);
check("accident warned within 2 km", nextRouteWarning(routeEvents, 1500)?.event.id === "ours-point");
check("not yet at 4 km before", nextRouteWarning(routeEvents, 500) === null);
check("roadworks only from 800 m", nextRouteWarning(routeEvents, 5000) === null && nextRouteWarning(routeEvents, 5300)?.event.id === "stretch-our-way");
check("closure from 3 km", nextRouteWarning(routeEvents, 6100)?.event.id === "closure" || nextRouteWarning(routeEvents, 6100)?.event.id === "unknown-dir");

// Heading-based (no route)
check("heading east sees accident ahead", warningByHeading(events, lat, at(1500).lon, 90)?.event.id === "ours-point");
check("heading west sees nothing ahead", warningByHeading(events, lat, at(3500).lon, 270)?.event.id !== "ours-point");


console.log(failures === 0 ? "ALL PASSED" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
