"use client";

import { useState, useEffect, useMemo } from "react";
import type { SpeedCamera, SpeedCameraDataset } from "@/types/speedcamera";
import type { MapBounds } from "@/types/waze";

// Static dataset built by scripts/build-cameras-es.mjs. Cached offline by the service worker.
const DATASET_URL = "/data/cameras-es.json";

interface UseSpeedCamerasOptions {
  bounds: MapBounds | null;
  enabled?: boolean;
  minZoomLevel?: number; // don't render cameras when zoomed out past this level (too many markers)
  bufferMultiplier?: number; // include cameras slightly outside the viewport so they don't pop in
}

// Shared across hook instances so the dataset is fetched once per page load
let datasetPromise: Promise<SpeedCamera[]> | null = null;

function loadDataset(): Promise<SpeedCamera[]> {
  if (!datasetPromise) {
    datasetPromise = fetch(DATASET_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load speed cameras (${response.status})`);
        }
        return response.json() as Promise<SpeedCameraDataset>;
      })
      .then((data) => {
        console.log(`[SpeedCameras] Loaded ${data.cameras.length} cameras (generated ${data.generatedAt})`);
        return data.cameras;
      })
      .catch((error) => {
        // Allow a retry on the next mount
        datasetPromise = null;
        throw error;
      });
  }
  return datasetPromise;
}

export function useSpeedCameras({
  bounds,
  enabled = true,
  minZoomLevel = 10,
  bufferMultiplier = 2,
}: UseSpeedCamerasOptions) {
  const [allCameras, setAllCameras] = useState<SpeedCamera[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const loading = enabled && allCameras.length === 0 && error === null;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    loadDataset()
      .then((cameras) => {
        if (cancelled) return;
        setAllCameras(cameras);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, reloadToken]);

  const cameras = useMemo(() => {
    if (!enabled || !bounds) return [];
    if (bounds.zoom !== undefined && bounds.zoom < minZoomLevel) return [];

    const padLat = ((bounds.north - bounds.south) * (bufferMultiplier - 1)) / 2;
    const padLon = ((bounds.east - bounds.west) * (bufferMultiplier - 1)) / 2;
    const north = bounds.north + padLat;
    const south = bounds.south - padLat;
    const east = bounds.east + padLon;
    const west = bounds.west - padLon;

    return allCameras.filter(({ location: { lat, lon } }) =>
      lat <= north && lat >= south && lon <= east && lon >= west
    );
  }, [allCameras, bounds, enabled, minZoomLevel, bufferMultiplier]);

  return {
    cameras,
    // Whole dataset, for proximity warnings that must not depend on where the map is panned
    allCameras: enabled ? allCameras : [],
    loading,
    error,
    refetch: () => setReloadToken((token) => token + 1),
  };
}
