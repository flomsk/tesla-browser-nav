"use client";

import { useEffect, useMemo, useRef } from "react";
import { computeProgress, indexRoute } from "@/lib/navigation";
import { speak } from "@/lib/voice";
import type { RouteProgress } from "@/lib/navigation";
import type { RouteData } from "@/types/route";

interface UseTurnByTurnOptions {
  route: RouteData | null;
  active: boolean; // true while navigating (not while previewing routes)
  latitude: number | null;
  longitude: number | null;
  voiceEnabled: boolean;
  speechLang: string;
}

// Tracks progress along the active route and speaks Mapbox's voice instructions at the right time
export function useTurnByTurn({
  route,
  active,
  latitude,
  longitude,
  voiceEnabled,
  speechLang,
}: UseTurnByTurnOptions): RouteProgress | null {
  const index = useMemo(() => (route ? indexRoute(route) : null), [route]);

  const progress = useMemo(() => {
    if (!active || !route || !index || latitude === null || longitude === null) return null;
    return computeProgress(route, index, latitude, longitude, null);
  }, [active, route, index, latitude, longitude]);

  // Announcements already spoken, keyed by maneuver location + text so a reroute
  // (which returns a new route object) doesn't repeat them
  const spokenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!active) spokenRef.current.clear();
  }, [active]);

  useEffect(() => {
    if (!progress || !route || !voiceEnabled) return;

    const step = route.steps[progress.stepIndex];
    if (!step) return;

    const keyFor = (text: string) => `${step.maneuver.location.join(",")}|${text}`;
    const due = step.voiceInstructions.filter(
      (v) => progress.distanceToManeuver <= v.distanceAlongGeometry && !spokenRef.current.has(keyFor(v.announcement))
    );
    if (due.length === 0) return;

    // If several are due at once (e.g. right after starting), only the closest one is still relevant
    const latest = due.reduce((a, b) => (a.distanceAlongGeometry < b.distanceAlongGeometry ? a : b));
    due.forEach((v) => spokenRef.current.add(keyFor(v.announcement)));
    speak(latest.announcement, speechLang);
  }, [progress, route, voiceEnabled, speechLang]);

  return progress;
}
