"use client";

import { useEffect, useRef, useState } from "react";
import type { MapBounds } from "@/types/waze";

interface UseMapPlacesOptions {
  endpoint: string; // e.g. "/api/fuel"; must answer `{ stations: T[] }` for left/right/bottom/top
  bounds: MapBounds | null;
  enabled: boolean;
  minZoom?: number;
  debounceMs?: number;
  bufferMultiplier?: number; // fetch a larger area so small pans need no new request
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

function contains(outer: MapBounds, inner: MapBounds): boolean {
  return inner.north <= outer.north && inner.south >= outer.south && inner.east <= outer.east && inner.west >= outer.west;
}

// Loads places (fuel stations, chargers) for the visible map area. Hidden below `minZoom`,
// where a city would show thousands of markers.
export function useMapPlaces<T>({
  endpoint,
  bounds,
  enabled,
  minZoom = 11,
  debounceMs = 400,
  bufferMultiplier = 1.6,
}: UseMapPlacesOptions) {
  const [places, setPlaces] = useState<T[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fetchedArea = useRef<MapBounds | null>(null);

  const zoomedIn = bounds !== null && (bounds.zoom === undefined || bounds.zoom >= minZoom);
  const active = enabled && zoomedIn;

  useEffect(() => {
    if (!active || !bounds) return;
    if (fetchedArea.current && contains(fetchedArea.current, bounds)) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const area = expandBounds(bounds, bufferMultiplier);
      const params = new URLSearchParams({
        left: area.west.toString(),
        right: area.east.toString(),
        bottom: area.south.toString(),
        top: area.north.toString(),
      });
      try {
        const response = await fetch(`${endpoint}?${params}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
        fetchedArea.current = area;
        setPlaces(data.stations ?? []);
        setError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        // Keep the last loaded places when offline
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, bounds, endpoint, debounceMs, bufferMultiplier]);

  return { places: active ? places : [], error: enabled ? error : null };
}
