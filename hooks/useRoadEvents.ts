"use client";

import { useEffect, useState } from "react";
import type { RoadEvent, RoadEventsResponse } from "@/types/roadEvent";

const REFRESH_MS = 3 * 60 * 1000;

// Live DGT incidents for all of Spain, refreshed every few minutes. The list is small (~1k),
// so it is loaded whole and matched against the route on the client.
export function useRoadEvents(enabled: boolean): RoadEvent[] {
  const [events, setEvents] = useState<RoadEvent[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch("/api/road-events");
        if (!response.ok) return; // keep the last list when offline or DGT is down
        const data = (await response.json()) as RoadEventsResponse;
        if (!cancelled) setEvents(data.events);
      } catch {
        // same: keep what we have
      }
    };

    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);

  return enabled ? events : [];
}
