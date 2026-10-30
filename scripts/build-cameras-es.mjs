/**
 * Builds a static speed camera dataset for Spain from official + community sources:
 *   - DGT (all of Spain except Catalonia and the Basque Country) — DATEX II XML from nap.dgt.es
 *   - Servei Català de Trànsit (Catalonia) — radars.txt with UTM 31N coordinates
 *   - OpenStreetMap via Overpass — fills gaps (Basque Country, municipal cameras)
 *
 * Output: public/data/cameras-es.json (served statically and cached offline by the service worker)
 *
 * Run with: node scripts/build-cameras-es.mjs
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DGT_URL = "https://nap.dgt.es/datex2/dgt/PredefinedLocationsPublication/radares/content.xml";
const SCT_URL = "https://transit.gencat.cat/web/.content/documents/seguretat_viaria/radars.txt";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// OSM cameras closer than this to an official one (of any type) are treated as duplicates
const DEDUP_RADIUS_METERS = 150;

// A DGT cabin this close to an average speed section end, or OSM cameras of one type this close
// to each other, are the same site: keep one marker
const COLOCATED_RADIUS_METERS = 30;

// A DGT camera's heading is trusted only if the road's carriageway and its PK order agree this well
const HEADING_AGREEMENT_DEGREES = 45;

// OSM cameras not edited since before this date are likely gone (agreed cut-off: 2021 or earlier)
const OSM_STALE_BEFORE = "2022-01-01";

const OUT_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data", "cameras-es.json");

async function fetchOverpass(query) {
  // The public Overpass server is often at capacity: back off and retry
  for (let attempt = 1; ; attempt++) {
    try {
      return JSON.parse(
        await fetchText(OVERPASS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(query)}`,
        })
      );
    } catch (error) {
      if (attempt === 5) throw error;
      console.warn(`[Overpass] ${error.message}, retrying`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 30000));
    }
  }
}

async function fetchText(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: { "User-Agent": "tesla-browser-nav camera dataset builder", ...init?.headers },
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.text();
}

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}

function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearing(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function angleDifference(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// --- DGT ---------------------------------------------------------------------

function tag(xml, name) {
  const match = xml.match(new RegExp(`<_0:${name}>([^<]*)</_0:${name}>`));
  return match ? match[1].trim() : undefined;
}

function coords(xml) {
  const lat = parseFloat(tag(xml, "latitude"));
  const lon = parseFloat(tag(xml, "longitude"));
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat: round(lat), lon: round(lon) } : null;
}

// First <_0:value> inside the descriptor with the given tpegDescriptorType
function descriptor(xml, type) {
  const re = /<_0:name>\s*<_0:descriptor>\s*<_0:value>([^<]*)<\/_0:value>\s*<\/_0:descriptor>\s*<_0:tpegDescriptorType>([^<]*)</g;
  for (const match of xml.matchAll(re)) {
    if (match[2] === type) return match[1].trim();
  }
  return undefined;
}

function parseDgt(xml) {
  const cameras = [];

  // Each top-level location starts with <_0:predefinedLocation id="..."> and contains a nested
  // <_0:predefinedLocation xsi:type="..."> with the geometry.
  const blocks = xml.split(/<_0:predefinedLocation id="/).slice(1);

  for (const block of blocks) {
    const id = block.slice(0, block.indexOf('"'));
    const road = tag(block, "roadNumber") ?? descriptor(block, "linkName");
    const town = descriptor(block, "townName");
    const name = [road, town].filter(Boolean).join(" · ") || undefined;

    if (block.includes('xsi:type="_0:Linear"')) {
      // Average speed section: emit start and end points
      const from = block.match(/<_0:from\b[\s\S]*?<\/_0:from>/);
      const to = block.match(/<_0:to\b[\s\S]*?<\/_0:to>/);
      const start = from && coords(from[0]);
      const end = to && coords(to[0]);
      // Both ends are checked in the start -> end direction of travel
      const heading = start && end ? Math.round(bearing(start, end)) : undefined;
      const pk = (part) => parseFloat(tag(block.match(new RegExp(`<_0:${part}>[\\s\\S]*?</_0:${part}>`))?.[0] ?? "", "referencePointDistance"));
      if (start) {
        cameras.push({ id: `dgt-${id}-start`, type: "average_speed_camera", location: start, heading, name: name && `${name} (inicio tramo)`, ref: road, source: "dgt", pk: pk("referencePointPrimaryLocation") });
      }
      if (end) {
        cameras.push({ id: `dgt-${id}-end`, type: "average_speed_camera", location: end, heading, name: name && `${name} (fin tramo)`, ref: road, source: "dgt", pk: pk("referencePointSecondaryLocation") });
      }
    } else {
      const location = coords(block);
      if (location) {
        cameras.push({
          id: `dgt-${id}`, type: "speed_camera", location, name, ref: road, source: "dgt",
          pk: parseFloat(tag(block, "referencePointDistance")),
          // positive = the direction in which the PK (kilometre point) grows
          pkDirection: tag(block, "directionRelative"),
        });
      }
    }
  }

  return cameras;
}

// DGT only says whether a cabin checks the growing or the falling PK direction. Turn that into a
// compass heading with two independent estimates and keep it only when they agree:
//   - the nearest one-way carriageway (OSM) the cabin sits on;
//   - the road's axis oriented by the nearest other DGT point on the same road with another PK.
// Checked against OSM cameras with an explicit direction: ~97% match. Cabins without an agreed
// heading keep warning both ways.
async function fetchRoadsNear(cameras) {
  const highways = "motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link";
  const around = cameras
    .map(({ location: { lat, lon } }) => `way(around:30,${lat},${lon})["highway"~"^(${highways})$"];`)
    .join("");
  const json = await fetchOverpass(`[out:json][timeout:300];(${around});out tags geom;`);
  return (json.elements || []).filter((el) => el.type === "way" && el.geometry);
}

// Nearest road segment to a point: { distance, bearing (way direction), oneway }
function nearestSegment(point, ways) {
  const kx = 111320 * Math.cos((point.lat * Math.PI) / 180);
  const ky = 110540;
  let best = null;
  for (const way of ways) {
    const reversed = way.tags?.oneway === "-1";
    const oneway = reversed || way.tags?.oneway === "yes" || /^motorway/.test(way.tags?.highway ?? "");
    for (let i = 1; i < way.geometry.length; i++) {
      const a = way.geometry[i - 1];
      const b = way.geometry[i];
      if (Math.abs(a.lat - point.lat) > 0.003 || Math.abs(a.lon - point.lon) > 0.004) continue;
      const ax = (a.lon - point.lon) * kx, ay = (a.lat - point.lat) * ky;
      const dx = (b.lon - a.lon) * kx, dy = (b.lat - a.lat) * ky;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      const distance = Math.hypot(ax + t * dx, ay + t * dy);
      if (!best || distance < best.distance) {
        best = { distance, bearing: reversed ? bearing(b, a) : bearing(a, b), oneway };
      }
    }
  }
  return best;
}

function addDgtHeadings(dgt, ways) {
  const byRoad = new Map();
  for (const camera of dgt) {
    if (!camera.ref || !Number.isFinite(camera.pk)) continue;
    if (!byRoad.has(camera.ref)) byRoad.set(camera.ref, []);
    byRoad.get(camera.ref).push(camera);
  }

  let found = 0;
  for (const cabin of dgt) {
    if (cabin.type !== "speed_camera" || !["positive", "negative"].includes(cabin.pkDirection)) continue;

    const segment = nearestSegment(cabin.location, ways);
    if (!segment || segment.distance > 40 || !segment.oneway) continue;

    // Nearest point on the same road with a different PK gives the direction the PK grows
    let reference = null;
    for (const other of byRoad.get(cabin.ref) || []) {
      const dPk = Math.abs(other.pk - cabin.pk);
      if (dPk < 300 || dPk > 80000 || distanceMeters(cabin.location, other.location) > 80000) continue;
      if (!reference || dPk < Math.abs(reference.pk - cabin.pk)) reference = other;
    }
    if (!reference) continue;
    const growing = reference.pk > cabin.pk ? bearing(cabin.location, reference.location) : bearing(reference.location, cabin.location);

    const axis = angleDifference(segment.bearing, growing) <= 90 ? segment.bearing : (segment.bearing + 180) % 360;
    if (angleDifference(axis, growing) > 60) continue; // road bends too much to tell
    const byPk = cabin.pkDirection === "positive" ? axis : (axis + 180) % 360;

    if (angleDifference(byPk, segment.bearing) <= HEADING_AGREEMENT_DEGREES) {
      cabin.heading = Math.round(segment.bearing);
      found++;
    }
  }
  return found;
}

// --- Catalonia (SCT) ---------------------------------------------------------

// ETRS89 / UTM zone 31N -> WGS84 lat/lon (ETRS89 and WGS84 differ by < 1m)
function utmToLatLon(easting, northing, zone = 31) {
  const a = 6378137;
  const f = 1 / 298.257222101;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  const x = easting - 500000;
  const m = northing / k0;
  const mu = m / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));

  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = Math.tan(phi1);
  const n1 = a / Math.sqrt(1 - e2 * sin1 ** 2);
  const t1 = tan1 ** 2;
  const c1 = ep2 * cos1 ** 2;
  const r1 = (a * (1 - e2)) / (1 - e2 * sin1 ** 2) ** 1.5;
  const d = x / (n1 * k0);

  const lat =
    phi1 -
    ((n1 * tan1) / r1) *
      (d ** 2 / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) * d ** 6) / 720);

  const lon0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const lon =
    lon0 +
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) * d ** 5) / 120) /
      cos1;

  return { lat: round((lat * 180) / Math.PI), lon: round((lon * 180) / Math.PI) };
}

// UTM 31N ranges covering Catalonia
const SCT_X_RANGE = [250000, 550000];
const SCT_Y_RANGE = [4450000, 4760000];

// The source file has some coordinates with the decimal separator missing or misplaced
// (e.g. "42552972" for 425529.72). Re-insert it after the expected number of integer digits.
function parseUtm(raw, integerDigits, [min, max]) {
  const direct = parseFloat(raw.replace(",", "."));
  if (direct >= min && direct <= max) return direct;

  const digits = raw.replace(/\D/g, "");
  const repaired = parseFloat(`${digits.slice(0, integerDigits)}.${digits.slice(integerDigits)}`);
  return repaired >= min && repaired <= max ? repaired : null;
}

function parseSct(text) {
  const cameras = [];
  const seen = new Set();

  for (const line of text.split(/\r?\n/)) {
    // Via  PK  Velocitat  X  Y   (decimal comma)
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 5) continue;

    const [road, pk, speed, xRaw, yRaw] = parts;
    const x = parseUtm(xRaw, 6, SCT_X_RANGE);
    const y = parseUtm(yRaw, 7, SCT_Y_RANGE);
    if (x === null || y === null) {
      console.warn(`[SCT] Skipping ${road} PK ${pk}: bad coordinates ${xRaw} ${yRaw}`);
      continue;
    }

    const id = `sct-${road}-${pk}`;
    if (seen.has(id)) continue;
    seen.add(id);

    cameras.push({
      id,
      // A PK range ("501,5-506,5") is an average speed section
      type: pk.includes("-") ? "average_speed_camera" : "speed_camera",
      location: utmToLatLon(x, y),
      maxspeed: /^\d+$/.test(speed) ? speed : undefined,
      name: `${road} PK ${pk}`,
      ref: road,
      source: "sct",
    });
  }

  return cameras;
}

// --- OpenStreetMap -----------------------------------------------------------

// Free-text tags mappers use to describe a camera
const OSM_TEXT_KEYS = ["note", "note_1", "note_2", "description", "description:es", "fixme", "name"];

// Relation enforcement=* values that are about speed or red lights
const SPEED_ENFORCEMENTS = new Set(["maxspeed", "average_speed", "traffic_signals", "red_light_camera"]);

// Why an OSM node shouldn't be shown as a camera, or undefined to keep it.
// `enforcements` are the enforcement=* values of the relations the node belongs to.
function osmDropReason(el, enforcements) {
  const tags = el.tags || {};
  const text = OSM_TEXT_KEYS.map((key) => tags[key] || "").join(" ").toLowerCase();

  if (Object.keys(tags).some((key) => /^(disused|removed|abandoned|demolished|was):/.test(key))) return "removed";
  if (el.timestamp && el.timestamp < OSM_STALE_BEFORE) return "stale";
  // Trailer / tripod / mobile spots, not fixed cameras
  if (tags["temporary"] === "yes" || /itinerante|remolque|m[óo]vil|tr[ií]pode|\btrip\b/.test(text)) return "mobile";
  // Advance warning signs ("PREaviso") mapped as cameras
  if (/\bpre(aviso)?\b/.test(text)) return "warningSign";
  // Speed display boards that don't fine ("radar pedagògic, no multa")
  if (/pedag|no multa/.test(text)) return "speedDisplay";
  // Seatbelt cameras, stop-line enforcement
  if (/no es un radar|\bstop\b/.test(text)) return "notSpeed";
  if (enforcements.size > 0 && ![...enforcements].some((e) => SPEED_ENFORCEMENTS.has(e))) return "notSpeed";
  return undefined;
}

function osmType(tags, enforcements) {
  if (tags["enforcement"] === "average_speed" || enforcements.has("average_speed")) {
    return "average_speed_camera";
  }
  const text = OSM_TEXT_KEYS.map((key) => tags[key] || "").join(" ").toLowerCase();
  if (
    tags["red_light_camera"] === "yes" ||
    tags["highway"] === "traffic_signals" ||
    tags["speed_camera"] === "traffic_signals" ||
    ["traffic_signals", "red_light_camera"].includes(tags["enforcement"]) ||
    enforcements.has("traffic_signals") ||
    enforcements.has("red_light_camera") ||
    // "SEM …" notes come from a red light camera list
    /sem[áa]for|en rojo|^\s*sem\b/.test(text)
  ) {
    return "red_light_camera";
  }
  return "speed_camera";
}

async function fetchOsm() {
  // Nodes with metadata (last edit), then the enforcement relations they belong to: a node's
  // relation tells an average speed section or a red light camera from a plain speed camera.
  const query = `
    [out:json][timeout:180];
    area["ISO3166-1"="ES"][admin_level=2]->.es;
    (
      node["highway"="speed_camera"](area.es);
      node["enforcement"~"^(maxspeed|average_speed)$"](area.es);
      node["highway"="traffic_signals"]["red_light_camera"="yes"](area.es);
      node["highway"="traffic_signals"]["enforcement:maxspeed"="yes"](area.es);
    )->.cameras;
    .cameras out meta;
    rel(bn.cameras)["enforcement"];
    out body;
  `;

  const json = await fetchOverpass(query);

  const elements = json.elements || [];
  const enforcementsByNode = new Map();
  for (const rel of elements.filter((el) => el.type === "relation")) {
    for (const member of rel.members || []) {
      if (member.type !== "node") continue;
      if (!enforcementsByNode.has(member.ref)) enforcementsByNode.set(member.ref, new Set());
      enforcementsByNode.get(member.ref).add(rel.tags?.enforcement);
    }
  }

  const dropped = {};
  const cameras = [];
  for (const el of elements.filter((el) => el.type === "node")) {
    const enforcements = enforcementsByNode.get(el.id) || new Set();
    const reason = osmDropReason(el, enforcements);
    if (reason) {
      dropped[reason] = (dropped[reason] || 0) + 1;
      continue;
    }

    const tags = el.tags || {};
    cameras.push({
      id: `osm-${el.id}`,
      type: osmType(tags, enforcements),
      location: { lat: round(el.lat), lon: round(el.lon) },
      maxspeed: tags["maxspeed"] || tags["enforcement:maxspeed:limit"],
      direction: tags["direction"] || tags["enforcement:direction"],
      // A numeric direction on a speed camera is the direction of travel it checks
      heading: /^\d+(\.\d+)?$/.test(tags["direction"] ?? "") ? Math.round(parseFloat(tags["direction"])) % 360 : undefined,
      name: tags["name"],
      ref: tags["ref"],
      source: "osm",
    });
  }

  return { cameras, dropped, total: cameras.length + Object.values(dropped).reduce((a, b) => a + b, 0) };
}

// --- Deduplication -----------------------------------------------------------

// Coarse grid (~1 km cells) so we don't compare every pair; fine for radii well under a cell
function spatialIndex() {
  const grid = new Map();
  const cell = (lat, lon) => `${lat},${lon}`;
  return {
    add(camera) {
      const key = cell(Math.floor(camera.location.lat * 100), Math.floor(camera.location.lon * 100));
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(camera);
    },
    find(camera, radius, predicate = () => true) {
      const lat = Math.floor(camera.location.lat * 100);
      const lon = Math.floor(camera.location.lon * 100);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const other of grid.get(cell(lat + dy, lon + dx)) || []) {
            if (predicate(other) && distanceMeters(other.location, camera.location) < radius) return other;
          }
        }
      }
      return undefined;
    },
  };
}

// When two markers are merged into the kept one, its heading survives only if the merged camera
// checks the same way. `unknownConflicts`: a merged camera without a heading may check the other way.
function mergeHeading(kept, merged, unknownConflicts) {
  if (kept.heading === undefined) return;
  const conflict =
    merged.heading === undefined
      ? unknownConflicts
      : angleDifference(kept.heading, merged.heading) > HEADING_AGREEMENT_DEGREES;
  if (conflict) kept.heading = undefined;
}

// DGT lists some cameras several times, has cabins for both directions at one spot, and a
// section's ends usually sit on a cabin: keep one marker per site, preferring the section end.
function dedupeDgt(dgt) {
  const kept = spatialIndex();
  const result = [];
  const sectionsFirst = [
    ...dgt.filter((camera) => camera.type === "average_speed_camera"),
    ...dgt.filter((camera) => camera.type !== "average_speed_camera"),
  ];
  for (const camera of sectionsFirst) {
    const site = kept.find(camera, COLOCATED_RADIUS_METERS);
    if (site) {
      mergeHeading(site, camera, true);
      continue;
    }
    kept.add(camera);
    result.push(camera);
  }
  return result;
}

// Drop OSM cameras that duplicate an official one of any type (official data wins): OSM often
// maps a section's end cameras as plain speed cameras. Then keep one OSM camera per site, since
// OSM often has one node per lane.
function dedupeOsm(official, osm) {
  const index = spatialIndex();
  for (const camera of official) index.add(camera);
  const kept = spatialIndex();
  return osm.filter((camera) => {
    const officialCamera = index.find(camera, DEDUP_RADIUS_METERS);
    if (officialCamera) {
      mergeHeading(officialCamera, camera, false);
      return false;
    }
    const site = kept.find(camera, COLOCATED_RADIUS_METERS, (other) => other.type === camera.type);
    if (site) {
      mergeHeading(site, camera, true);
      return false;
    }
    kept.add(camera);
    return true;
  });
}

// Drop build-only fields and empty values
const BUILD_ONLY_FIELDS = new Set(["pk", "pkDirection"]);

function forOutput(camera) {
  return Object.fromEntries(Object.entries(camera).filter(([k, v]) => v !== undefined && !BUILD_ONLY_FIELDS.has(k)));
}

async function main() {
  const [dgtXml, sctText, osmResult] = await Promise.all([
    fetchText(DGT_URL),
    fetchText(SCT_URL),
    fetchOsm(),
  ]);

  const dgtAll = parseDgt(dgtXml);
  const dgtHeadings = addDgtHeadings(dgtAll, await fetchRoadsNear(dgtAll.filter((c) => c.type === "speed_camera")));
  const dgt = dedupeDgt(dgtAll);
  const sct = parseSct(sctText);
  const official = [...dgt, ...sct];
  const osm = dedupeOsm(official, osmResult.cameras);

  // Spain incl. Canary and Balearic Islands, Ceuta and Melilla
  const inSpain = ({ location: { lat, lon } }) => lat > 27 && lat < 44.5 && lon > -18.5 && lon < 4.5;
  const cameras = [...official, ...osm].filter(inSpain).map(forOutput);

  const output = {
    generatedAt: new Date().toISOString(),
    counts: {
      dgt: dgt.length,
      dgtDuplicatesDropped: dgtAll.length - dgt.length,
      dgtHeadingsFromRoads: dgtHeadings,
      sct: sct.length,
      osm: osm.length,
      osmDuplicatesDropped: osmResult.cameras.length - osm.length,
      ...Object.fromEntries(Object.entries(osmResult.dropped).map(([reason, n]) => [`osmDropped_${reason}`, n])),
    },
    cameras,
  };

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(output));

  const byType = {};
  for (const camera of cameras) byType[camera.type] = (byType[camera.type] || 0) + 1;
  byType.withHeading = cameras.filter((camera) => camera.heading !== undefined).length;
  console.log(`Wrote ${cameras.length} cameras to ${OUT_FILE}`);
  console.log(output.counts, byType);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
