"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { WazeAlert, MapBounds } from "@/types/waze";

interface UsePoliceReportsOptions {
  bounds: MapBounds | null;
  refreshInterval?: number; // milliseconds
  debounceMs?: number;
  bufferMultiplier?: number; // fetch a larger area than the viewport so markers don't pop in
  minZoomLevel?: number;
}

const DEVICE_ID_KEY = "teslanav-device-id";

// Anonymous per-browser id so the server can count one vote per device
function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return "anonymous-device";
  }
}

function expandBounds(bounds: MapBounds, multiplier: number): MapBounds {
  const padLat = ((bounds.north - bounds.south) * (multiplier - 1)) / 2;
  const padLon = ((bounds.east - bounds.west) * (multiplier - 1)) / 2;
  return {
    north: bounds.north + padLat,
    south: bounds.south - padLat,
    east: bounds.east + padLon,
    west: bounds.west - padLon,
    zoom: bounds.zoom,
  };
}

export function usePoliceReports({
  bounds,
  refreshInterval = 30000, // 30 seconds
  debounceMs = 300,
  bufferMultiplier = 3,
  minZoomLevel = 9,
}: UsePoliceReportsOptions) {
  const [alerts, setAlerts] = useState<WazeAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const lastBounds = useRef<MapBounds | null>(null);

  const fetchReports = useCallback(
    async (viewport: MapBounds) => {
      if (viewport.zoom !== undefined && viewport.zoom < minZoomLevel) return;

      const area = expandBounds(viewport, bufferMultiplier);
      const params = new URLSearchParams({
        left: area.west.toString(),
        right: area.east.toString(),
        bottom: area.south.toString(),
        top: area.north.toString(),
      });

      try {
        setLoading(true);
        const response = await fetch(`/api/police?${params}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch police reports (${response.status})`);
        }
        const data = await response.json();
        setAlerts(data.alerts || []);
        setError(null);
      } catch (err) {
        // Keep showing the last known reports when offline
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [bufferMultiplier, minZoomLevel]
  );

  // Debounced fetch when bounds change
  useEffect(() => {
    if (!bounds) return;
    lastBounds.current = bounds;

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(() => fetchReports(bounds), debounceMs);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [bounds, debounceMs, fetchReports]);

  // Periodic refresh
  useEffect(() => {
    const interval = setInterval(() => {
      if (lastBounds.current) fetchReports(lastBounds.current);
    }, refreshInterval);
    return () => clearInterval(interval);
  }, [refreshInterval, fetchReports]);

  // Report police at the given position. Returns the report id (an existing one if merged), or null on failure.
  const reportPolice = useCallback(async (lat: number, lon: number): Promise<string | null> => {
    try {
      const response = await fetch("/api/police", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lon, deviceId: getDeviceId() }),
      });
      if (!response.ok) return null;

      const { alert } = (await response.json()) as { alert: WazeAlert };
      setAlerts((current) => [...current.filter((a) => a.uuid !== alert.uuid), alert]);
      return alert.uuid;
    } catch {
      return null;
    }
  }, []);

  // Confirm ("still there") or deny ("not there") an existing report
  const voteOnReport = useCallback(async (id: string, vote: "up" | "down"): Promise<boolean> => {
    try {
      const response = await fetch(`/api/police/${encodeURIComponent(id)}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote, deviceId: getDeviceId() }),
      });

      if (response.status === 404) {
        setAlerts((current) => current.filter((a) => a.uuid !== id));
        return true;
      }
      if (!response.ok) return false;

      const { alert } = (await response.json()) as { alert: WazeAlert | null };
      setAlerts((current) => {
        const others = current.filter((a) => a.uuid !== id);
        return alert ? [...others, alert] : others;
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  return {
    alerts,
    loading,
    error,
    reportPolice,
    voteOnReport,
  };
}
