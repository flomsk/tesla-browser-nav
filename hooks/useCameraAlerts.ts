"use client";

import { useEffect, useMemo, useRef } from "react";
import { phrases, spokenDistance } from "@/lib/navLanguage";
import { angleDifference } from "@/lib/navigation";
import { formatSpeedLimit, maxspeedToKmh } from "@/lib/units";
import { beep, speak } from "@/lib/voice";
import type { NavLanguage } from "@/lib/navLanguage";
import type { UnitSystem } from "@/lib/units";
import type { SpeedCamera } from "@/types/speedcamera";

export interface CameraWarning {
  camera: SpeedCamera;
  distance: number; // meters
  limitKmh: number | null;
}

interface UseCameraAlertsOptions {
  cameras: SpeedCamera[];
  latitude: number | null;
  longitude: number | null;
  heading: number | null; // degrees, direction of travel
  speed: number | null; // m/s
  enabled: boolean;
  units: UnitSystem;
  language: NavLanguage;
  speechLang: string;
  voiceEnabled: boolean;
}

// Only cameras within this cone around our heading count as "ahead"
// (tighter than for police so cameras on parallel or crossing roads are ignored)
const AHEAD_HALF_ANGLE = 35;
// A camera with a known heading only counts when we drive roughly its way (not the opposite carriageway)
const MAX_HEADING_DIFF = 90;
// Warn ~20 seconds ahead, but at least 300 m and at most 800 m
const WARNING_SECONDS = 20;
const MIN_WARNING_M = 300;
const MAX_WARNING_M = 800;
// Don't warn about the same camera again for a while (e.g. GPS jitter, stop-and-go)
const REALERT_AFTER_MS = 10 * 60 * 1000;

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function warningDistanceFor(speed: number | null): number {
  if (speed === null) return 500;
  return Math.min(MAX_WARNING_M, Math.max(MIN_WARNING_M, speed * WARNING_SECONDS));
}

export function findCameraAhead(
  cameras: SpeedCamera[],
  latitude: number,
  longitude: number,
  heading: number,
  maxDistance: number
): CameraWarning | null {
  // Cheap bounding-box prefilter before the trigonometry
  const latPad = maxDistance / 111320;
  const lngPad = latPad / Math.cos((latitude * Math.PI) / 180);

  let nearest: CameraWarning | null = null;
  for (const camera of cameras) {
    const { lat, lon } = camera.location;
    if (Math.abs(lat - latitude) > latPad || Math.abs(lon - longitude) > lngPad) continue;

    const distance = haversine(latitude, longitude, lat, lon);
    if (distance > maxDistance || (nearest && distance >= nearest.distance)) continue;

    let diff = Math.abs(bearing(latitude, longitude, lat, lon) - heading) % 360;
    if (diff > 180) diff = 360 - diff;
    if (diff > AHEAD_HALF_ANGLE) continue;
    if (camera.heading !== undefined && angleDifference(camera.heading, heading) > MAX_HEADING_DIFF) continue;

    nearest = { camera, distance, limitKmh: maxspeedToKmh(camera.maxspeed) };
  }
  return nearest;
}

// Returns the nearest camera ahead (if any) and plays a beep + spoken warning when a new one appears
export function useCameraAlerts({
  cameras,
  latitude,
  longitude,
  heading,
  speed,
  enabled,
  units,
  language,
  speechLang,
  voiceEnabled,
}: UseCameraAlertsOptions): CameraWarning | null {
  const warning = useMemo(() => {
    if (!enabled || latitude === null || longitude === null || heading === null) return null;
    // Parked or crawling: heading is unreliable and warnings would be noise
    if (speed !== null && speed < 2) return null;
    return findCameraAhead(cameras, latitude, longitude, heading, warningDistanceFor(speed));
  }, [cameras, latitude, longitude, heading, speed, enabled]);

  const alertedAtRef = useRef<Map<string, number>>(new Map());
  const cameraId = warning?.camera.id ?? null;

  useEffect(() => {
    if (!warning || !cameraId) return;

    const now = Date.now();
    const lastAlerted = alertedAtRef.current.get(cameraId);
    if (lastAlerted !== undefined && now - lastAlerted < REALERT_AFTER_MS) return;
    alertedAtRef.current.set(cameraId, now);

    beep();
    if (!voiceEnabled) return;

    const p = phrases(language);
    const distance = spokenDistance(warning.distance, language, units);
    const base =
      warning.camera.type === "average_speed_camera" ? p.averageSpeed(distance)
      : warning.camera.type === "red_light_camera" ? p.redLight(distance)
      : p.camera(distance);
    const limit = warning.camera.maxspeed ? p.limit(formatSpeedLimit(warning.camera.maxspeed, units)) : "";
    speak(base + limit, speechLang);
    // Only re-run when a different camera becomes the nearest one ahead
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId]);

  return warning;
}
