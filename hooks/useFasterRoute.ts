"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { phrases } from "@/lib/navLanguage";
import { pickFasterRoute } from "@/lib/traffic";
import { speak } from "@/lib/voice";
import type { NavLanguage } from "@/lib/navLanguage";
import type { RouteProgress } from "@/lib/navigation";
import type { UnitSystem } from "@/lib/units";
import type { RouteData, RoutesResponse } from "@/types/route";

export interface FasterRouteOffer {
  route: RouteData;
  savingSeconds: number;
}

interface UseFasterRouteOptions {
  destination: { lng: number; lat: number } | null;
  route: RouteData | null; // the route being driven
  progress: RouteProgress | null;
  latitude: number | null;
  longitude: number | null;
  units: UnitSystem;
  language: NavLanguage;
  speechLang: string;
  voiceEnabled: boolean;
  // Same way, fresher traffic: swapped in silently so ETA and jams stay current
  onRefresh: (route: RouteData) => void;
}

const CHECK_EVERY_MS = 3 * 60 * 1000;
// Close to the destination there is nothing left to gain
const MIN_REMAINING_METERS = 3000;
const OFFER_TIMEOUT_MS = 30 * 1000;

// Every few minutes while navigating, recalculates from the current position with live
// traffic. Offers a different way when it saves several minutes (Waze-style), otherwise
// quietly refreshes the current route's traffic.
export function useFasterRoute({
  destination, route, progress, latitude, longitude, units, language, speechLang, voiceEnabled, onRefresh,
}: UseFasterRouteOptions) {
  const [offer, setOffer] = useState<FasterRouteOffer | null>(null);
  const dismissedRef = useRef<[number, number][][]>([]);

  // Latest values for the timer callback without restarting the timer on every GPS fix
  const stateRef = useRef({ destination, route, progress, latitude, longitude, units, language, speechLang, voiceEnabled, onRefresh });
  useEffect(() => {
    stateRef.current = { destination, route, progress, latitude, longitude, units, language, speechLang, voiceEnabled, onRefresh };
  });

  const navigating = destination !== null;

  useEffect(() => {
    if (!navigating) {
      dismissedRef.current = [];
      return;
    }

    const check = async () => {
      const s = stateRef.current;
      if (!s.destination || !s.route || !s.progress || s.latitude === null || s.longitude === null) return;
      if (s.progress.remainingDistance < MIN_REMAINING_METERS) return;

      const params = new URLSearchParams({
        originLng: String(s.longitude),
        originLat: String(s.latitude),
        destLng: String(s.destination.lng),
        destLat: String(s.destination.lat),
        language: s.language,
        units: s.units,
      });
      let candidates: RouteData[];
      try {
        const response = await fetch(`/api/directions?${params}`);
        if (!response.ok) return;
        candidates = ((await response.json()) as RoutesResponse).routes;
      } catch {
        return; // offline: try again next time
      }

      // Compare against what's left of the current route
      const ahead = s.route.geometry.coordinates.slice(s.progress.segmentIndex);
      const { same, faster } = pickFasterRoute(candidates, ahead, s.progress.remainingDuration, dismissedRef.current);
      if (same) s.onRefresh(same);
      if (!faster) return;

      setOffer(faster);
      if (s.voiceEnabled) speak(phrases(s.language).fasterRoute(Math.round(faster.savingSeconds / 60)), s.speechLang);
    };

    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [navigating]);

  // Unanswered offers go away by themselves: the driver shouldn't have to tap anything
  useEffect(() => {
    if (!offer) return;
    const timer = setTimeout(() => {
      dismissedRef.current.push(offer.route.geometry.coordinates);
      setOffer(null);
    }, OFFER_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [offer]);

  const dismiss = useCallback(() => {
    if (offer) dismissedRef.current.push(offer.route.geometry.coordinates);
    setOffer(null);
  }, [offer]);

  const accept = useCallback(() => {
    const taken = offer?.route ?? null;
    setOffer(null);
    return taken;
  }, [offer]);

  return { offer: navigating ? offer : null, accept, dismiss };
}
