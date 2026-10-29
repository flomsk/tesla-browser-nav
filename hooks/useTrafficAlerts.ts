"use client";

import { useEffect, useMemo, useRef } from "react";
import { indexRoute } from "@/lib/navigation";
import { phrases, spokenDistance } from "@/lib/navLanguage";
import { jamsOnRoute, nextJam } from "@/lib/traffic";
import { speak } from "@/lib/voice";
import type { JamWarning } from "@/lib/traffic";
import type { NavLanguage } from "@/lib/navLanguage";
import type { RouteProgress } from "@/lib/navigation";
import type { UnitSystem } from "@/lib/units";
import type { RouteData } from "@/types/route";

interface UseTrafficAlertsOptions {
  route: RouteData | null; // the route being driven
  progress: RouteProgress | null;
  units: UnitSystem;
  language: NavLanguage;
  speechLang: string;
  voiceEnabled: boolean;
}

// The next jam on the route (from Mapbox live traffic), announced once
export function useTrafficAlerts({
  route, progress, units, language, speechLang, voiceEnabled,
}: UseTrafficAlertsOptions): JamWarning | null {
  const jams = useMemo(() => (route ? jamsOnRoute(route, indexRoute(route)) : []), [route]);
  const warning = useMemo(
    () => (progress ? nextJam(jams, progress.distanceAlong) : null),
    [jams, progress]
  );

  // Keyed by where the jam starts, so a refreshed route doesn't announce the same jam again
  const announcedRef = useRef<Set<string>>(new Set());
  const jamKey = warning ? `${warning.jam.start[0].toFixed(3)},${warning.jam.start[1].toFixed(3)}` : null;

  useEffect(() => {
    if (!warning || !jamKey || announcedRef.current.has(jamKey)) return;
    announcedRef.current.add(jamKey);
    if (!voiceEnabled) return;
    const minutes = Math.max(1, Math.round(warning.jam.delaySeconds / 60));
    speak(
      phrases(language).jamAhead(
        spokenDistance(warning.distance, language, units),
        spokenDistance(warning.jam.endAlong - warning.jam.startAlong, language, units),
        minutes
      ),
      speechLang
    );
    // Only when a different jam becomes the next one
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jamKey]);

  return warning;
}
