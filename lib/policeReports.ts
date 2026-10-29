import { Redis } from "@upstash/redis";
import type { WazeAlert } from "@/types/waze";

// Crowdsourced police reports, Waze-style:
// - a report lives REPORT_TTL_MS after the last confirmation, but never longer than MAX_LIFETIME_MS
// - "still there" extends it, "not there" shortens it and removes it once denials outnumber confirmations
// - a report near an existing one counts as a confirmation instead of creating a duplicate

export const REPORT_TTL_MS = 30 * 60 * 1000; // 30 minutes
export const MAX_LIFETIME_MS = 3 * 60 * 60 * 1000; // 3 hours
const DENIED_TTL_MS = 10 * 60 * 1000; // a "not there" vote caps the remaining life at 10 minutes
export const MERGE_RADIUS_METERS = 200;

export interface PoliceReport {
  id: string;
  lat: number;
  lon: number;
  createdAt: number;
  lastConfirmedAt: number;
  expiresAt: number;
  up: number; // the reporter counts as the first confirmation
  down: number;
}

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export type Vote = "up" | "down";

// --- Storage -----------------------------------------------------------------
// Upstash Redis when configured, otherwise process memory (fine for `next dev` or a single
// self-hosted Node process, but NOT shared between serverless instances).

const REPORTS_KEY = "police:reports";
const VOTE_KEY_PREFIX = "police:vote:";

interface Store {
  all(): Promise<PoliceReport[]>;
  save(report: PoliceReport): Promise<void>;
  remove(ids: string[]): Promise<void>;
  // Returns false if this device already voted on this report
  claimVote(reportId: string, deviceId: string): Promise<boolean>;
}

function createRedisStore(redis: Redis): Store {
  return {
    async all() {
      const hash = await redis.hgetall<Record<string, PoliceReport>>(REPORTS_KEY);
      return hash ? Object.values(hash) : [];
    },
    async save(report) {
      await redis.hset(REPORTS_KEY, { [report.id]: report });
    },
    async remove(ids) {
      if (ids.length > 0) await redis.hdel(REPORTS_KEY, ...ids);
    },
    async claimVote(reportId, deviceId) {
      const result = await redis.set(`${VOTE_KEY_PREFIX}${reportId}:${deviceId}`, 1, {
        nx: true,
        px: MAX_LIFETIME_MS,
      });
      return result === "OK";
    },
  };
}

function createMemoryStore(): Store {
  const reports = new Map<string, PoliceReport>();
  const votes = new Map<string, number>(); // key -> expiresAt

  return {
    async all() {
      return Array.from(reports.values());
    },
    async save(report) {
      reports.set(report.id, report);
    },
    async remove(ids) {
      ids.forEach((id) => reports.delete(id));
    },
    async claimVote(reportId, deviceId) {
      const now = Date.now();
      for (const [key, expiresAt] of votes) {
        if (expiresAt < now) votes.delete(key);
      }
      const key = `${reportId}:${deviceId}`;
      if (votes.has(key)) return false;
      votes.set(key, now + MAX_LIFETIME_MS);
      return true;
    },
  };
}

// Keep the in-memory store across hot reloads in dev
const globalForStore = globalThis as unknown as { policeStore?: Store };

function getStore(): Store {
  if (!globalForStore.policeStore) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    globalForStore.policeStore = url && token
      ? createRedisStore(new Redis({ url, token }))
      : createMemoryStore();
    console.log(`[Police] Using ${url && token ? "Upstash Redis" : "in-memory"} store`);
  }
  return globalForStore.policeStore;
}

// --- Logic -------------------------------------------------------------------

// Police reports are returned in the same shape as Waze alerts so the map and
// proximity alert code can render them unchanged
export function toAlert(report: PoliceReport): WazeAlert {
  return {
    uuid: report.id,
    type: "POLICE",
    location: { x: report.lon, y: report.lat },
    reliability: Math.min(10, 5 + report.up - report.down),
    nThumbsUp: report.up - 1,
    pubMillis: report.createdAt,
    reportBy: "community",
    provider: "community",
  };
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Returns live reports and lazily deletes expired ones
async function liveReports(store: Store, now: number): Promise<PoliceReport[]> {
  const reports = await store.all();
  const expired = reports.filter((r) => r.expiresAt <= now).map((r) => r.id);
  await store.remove(expired);
  return reports.filter((r) => r.expiresAt > now);
}

function applyConfirmation(report: PoliceReport, now: number): PoliceReport {
  return {
    ...report,
    up: report.up + 1,
    lastConfirmedAt: now,
    expiresAt: Math.min(now + REPORT_TTL_MS, report.createdAt + MAX_LIFETIME_MS),
  };
}

export async function listReports(bounds: Bounds): Promise<PoliceReport[]> {
  const reports = await liveReports(getStore(), Date.now());
  return reports.filter(
    (r) => r.lat <= bounds.north && r.lat >= bounds.south && r.lon <= bounds.east && r.lon >= bounds.west
  );
}

export async function createReport(
  lat: number,
  lon: number,
  deviceId: string
): Promise<{ report: PoliceReport; merged: boolean }> {
  const store = getStore();
  const now = Date.now();

  const nearby = (await liveReports(store, now))
    .map((r) => ({ report: r, distance: distanceMeters(lat, lon, r.lat, r.lon) }))
    .filter(({ distance }) => distance <= MERGE_RADIUS_METERS)
    .sort((a, b) => a.distance - b.distance)[0];

  if (nearby) {
    // Treat as a confirmation of the existing report (once per device)
    if (!(await store.claimVote(nearby.report.id, deviceId))) {
      return { report: nearby.report, merged: true };
    }
    const updated = applyConfirmation(nearby.report, now);
    await store.save(updated);
    return { report: updated, merged: true };
  }

  const report: PoliceReport = {
    id: crypto.randomUUID(),
    lat,
    lon,
    createdAt: now,
    lastConfirmedAt: now,
    expiresAt: now + REPORT_TTL_MS,
    up: 1,
    down: 0,
  };
  await store.claimVote(report.id, deviceId);
  await store.save(report);
  return { report, merged: false };
}

export async function voteReport(
  id: string,
  vote: Vote,
  deviceId: string
): Promise<{ report: PoliceReport | null; status: "ok" | "not_found" | "already_voted" }> {
  const store = getStore();
  const now = Date.now();

  const report = (await liveReports(store, now)).find((r) => r.id === id);
  if (!report) return { report: null, status: "not_found" };

  if (!(await store.claimVote(id, deviceId))) {
    return { report, status: "already_voted" };
  }

  if (vote === "up") {
    const updated = applyConfirmation(report, now);
    await store.save(updated);
    return { report: updated, status: "ok" };
  }

  const updated: PoliceReport = {
    ...report,
    down: report.down + 1,
    expiresAt: Math.min(report.expiresAt, now + DENIED_TTL_MS),
  };

  if (updated.down > updated.up) {
    await store.remove([id]);
    return { report: null, status: "ok" };
  }

  await store.save(updated);
  return { report: updated, status: "ok" };
}
