"use client";

import { useEffect, useMemo, useRef } from "react";
import { phrases, spokenDistance } from "@/lib/navLanguage";
import { eventsOnRoute, nextRouteWarning, shownWithoutRoute, warningByHeading } from "@/lib/roadEventAlerts";
import { beep, speak } from "@/lib/voice";
import type { RouteEvent, RoadEventWarning } from "@/lib/roadEventAlerts";
import type { NavLanguage } from "@/lib/navLanguage";
import type { RouteProgress } from "@/lib/navigation";
import type { UnitSystem } from "@/lib/units";
import type { RouteData } from "@/types/route";
import type { RoadEvent, RoadEventKind } from "@/types/roadEvent";

interface UseRoadEventAlertsOptions {
  events: RoadEvent[];
  route: RouteData | null; // the route being driven, null when not navigating
  progress: RouteProgress | null;
  latitude: number | null;
  longitude: number | null;
  heading: number | null;
  speed: number | null; // m/s
  units: UnitSystem;
  language: NavLanguage;
  speechLang: string;
  voiceEnabled: boolean;
}

// Things that stop or endanger you get a beep before the voice; slowdowns only the voice
const BEEP_KINDS = new Set<RoadEventKind>(["closure", "accident", "vehicleFire", "obstacle", "rockfall", "flooding"]);

export function useRoadEventAlerts({
  events, route, progress, latitude, longitude, heading, speed, units, language, speechLang, voiceEnabled,
}: UseRoadEventAlertsOptions): { warning: RoadEventWarning | null; routeEvents: RouteEvent[] } {
  // Matching against the route is the expensive part: only when the route or the list changes
  const routeEvents = useMemo(() => (route ? eventsOnRoute(events, route) : []), [events, route]);

  const warning = useMemo(() => {
    if (route && progress) return nextRouteWarning(routeEvents, progress.distanceAlong);
    // Free driving: only clear-cut hazards, and only when moving (heading is noise when parked)
    if (latitude === null || longitude === null || heading === null || speed === null || speed < 3) return null;
    return warningByHeading(events.filter(shownWithoutRoute), latitude, longitude, heading);
  }, [route, progress, routeEvents, events, latitude, longitude, heading, speed]);

  // Each incident is announced once per session
  const announcedRef = useRef<Set<string>>(new Set());
  const eventId = warning?.event.id ?? null;

  useEffect(() => {
    if (!warning || !eventId || announcedRef.current.has(eventId)) return;
    announcedRef.current.add(eventId);

    if (BEEP_KINDS.has(warning.event.kind)) beep();
    if (!voiceEnabled) return;
    const p = phrases(language);
    speak(p.eventAhead(p.events[warning.event.kind], spokenDistance(warning.distance, language, units)), speechLang);
    // Only when a different incident becomes the next one
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  return { warning, routeEvents };
}
