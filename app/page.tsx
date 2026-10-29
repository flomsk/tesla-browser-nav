"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Map, type MapRef } from "@/components/Map";
import { SettingsModal } from "@/components/SettingsModal";
import { NavigateSearch } from "@/components/NavigateSearch";
import { RouteSelector } from "@/components/RouteSelector";
import { useGeolocation } from "@/hooks/useGeolocation";
import { usePoliceReports } from "@/hooks/usePoliceReports";
import { useSpeedCameras } from "@/hooks/useSpeedCameras";
import { useCameraAlerts } from "@/hooks/useCameraAlerts";
import { useRoadEvents } from "@/hooks/useRoadEvents";
import { useRoadEventAlerts } from "@/hooks/useRoadEventAlerts";
import { shownWithoutRoute, toMapAlert } from "@/lib/roadEventAlerts";
import { RoadEventBanner } from "@/components/RoadEventBanner";
import { useTrafficAlerts } from "@/hooks/useTrafficAlerts";
import { useFasterRoute } from "@/hooks/useFasterRoute";
import { TrafficJamBanner } from "@/components/TrafficJamBanner";
import { FasterRouteCard } from "@/components/FasterRouteCard";
import { DEFAULT_FUEL_TYPE, FUEL_TYPE_STORAGE_KEY, isFuelType } from "@/lib/places";
import { routeAhead } from "@/lib/navigation";
import type { FuelType, Place } from "@/types/poi";
import { useTurnByTurn } from "@/hooks/useTurnByTurn";
import { ManeuverBanner } from "@/components/ManeuverBanner";
import { CameraWarningBanner } from "@/components/CameraWarningBanner";
import { SpeedDisplay } from "@/components/SpeedDisplay";
import { StartTripScreen } from "@/components/StartTripScreen";
import {
  NAV_LANGUAGE_STORAGE_KEY,
  defaultNavLanguage,
  isNavLanguage,
  phrases,
  speechLangFor,
} from "@/lib/navLanguage";
import type { NavLanguage } from "@/lib/navLanguage";
import { isSpeechSupported, speak, unlockAudio } from "@/lib/voice";
import {
  DEFAULT_UNIT_SYSTEM,
  UNIT_SYSTEM_STORAGE_KEY,
  closestPoliceAlertDistance,
  formatDistance,
} from "@/lib/units";
import type { UnitSystem } from "@/lib/units";
import type { MapBounds } from "@/types/waze";
import type { RouteData, RoutesResponse } from "@/types/route";
import Image from "next/image";
import { APP_NAME } from "@/lib/brand";
import posthog from "posthog-js";
import { ShieldExclamationIcon, ExclamationTriangleIcon, NoSymbolIcon } from "@heroicons/react/24/solid";

// Consistent button styles for light/dark mode - more transparent with blur
const getButtonStyles = (darkMode: boolean) => 
  darkMode 
    ? "bg-[#1a1a1a]/50 text-white border-white/10" 
    : "bg-white/50 text-black border-black/10";

const getContainerStyles = (darkMode: boolean) =>
  darkMode
    ? "bg-[#1a1a1a]/50 text-white border-white/10"
    : "bg-white/50 text-black border-black/10";

// Format duration in seconds to human-readable string
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes} min`;
}

// Ask "still there?" when passing within this distance of a police report
const CONFIRM_PROMPT_DISTANCE_M = 150;
const CONFIRM_PROMPT_TIMEOUT_MS = 12000;

export default function Home() {
  // Use lazy initialization to read from localStorage immediately
  // This ensures the map initializes with the correct theme before first render
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== "undefined") {
      const savedTheme = localStorage.getItem("tbn-theme");
      if (savedTheme !== null) {
        return savedTheme === "dark";
      }
      // Fall back to system preference if no saved theme
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return false;
  });
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [followMode, setFollowMode] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("tbn-follow-mode");
      return saved === "true";
    }
    return false;
  });
  const [isCentered, setIsCentered] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showWazeAlerts, setShowWazeAlerts] = useState(true);
  const [showSpeedCameras, setShowSpeedCameras] = useState(true);
  const [fuelType, setFuelType] = useState<FuelType>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(FUEL_TYPE_STORAGE_KEY);
      if (isFuelType(saved)) return saved;
    }
    return DEFAULT_FUEL_TYPE;
  });
  const [showTraffic, setShowTraffic] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("tbn-traffic");
      return saved !== null ? saved === "true" : true;
    }
    return true;
  });
  const [useSatellite, setUseSatellite] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("tbn-satellite");
      return saved === "true";
    }
    return false;
  });
  const [use3DMode, setUse3DMode] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("tbn-3d-mode");
      return saved === "true";
    }
    return false;
  });
  const [showAvatarPulse, setShowAvatarPulse] = useState(true);
  const mapRef = useRef<MapRef>(null);

  const [destination, setDestination] = useState<{ lng: number; lat: number; name: string } | null>(null);
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [routeLoading, setRouteLoading] = useState(false);
  
  // Computed: currently selected route (for backward compatibility)
  const route = routes.length > 0 ? routes[selectedRouteIndex] : null;
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<Place[]>([]);
  const [contextMenu, setContextMenu] = useState<{ lng: number; lat: number; screenX: number; screenY: number; placeName?: string } | null>(null);
  const [contextMenuLoading, setContextMenuLoading] = useState(false);
  // Preview location - shown on map when user searches but hasn't started navigation yet
  const [previewLocation, setPreviewLocation] = useState<{ lng: number; lat: number; name: string } | null>(null);
  // Mobile detection
  
  const [units, setUnits] = useState<UnitSystem>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(UNIT_SYSTEM_STORAGE_KEY);
      if (saved === "metric" || saved === "imperial") return saved;
    }
    return DEFAULT_UNIT_SYSTEM;
  });

  // Language for route instructions and voice
  const [navLanguage, setNavLanguage] = useState<NavLanguage>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(NAV_LANGUAGE_STORAGE_KEY);
      if (isNavLanguage(saved)) return saved;
    }
    return defaultNavLanguage();
  });
  const speechLang = speechLangFor(navLanguage);
  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("tbn-voice") !== "false";
    }
    return true;
  });
  // Browsers only allow sound after a tap, so every session starts with the "Start driving" screen
  const [tripStarted, setTripStarted] = useState(false);

  // Police alert settings - use lazy init to read from localStorage immediately
  const [policeAlertDistance, setPoliceAlertDistance] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("tbn-police-distance");
      return saved !== null ? parseInt(saved, 10) : 500;
    }
    return 500; // meters, 0 = off
  });
  const [policeAlertSound, setPoliceAlertSound] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("tbn-police-sound");
      return saved === "true";
    }
    return false; // off by default
  });
  const [policeAlertToast, setPoliceAlertToast] = useState<{ show: boolean; expanding: boolean } | null>(null);
  const alertedPoliceIdsRef = useRef<Set<string>>(new Set());
  const alertAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastAlertTimeRef = useRef<number>(0);
  const ALERT_COOLDOWN_MS = 5000; // 5 seconds between alerts
  // Time-based warmup: suppress alerts for first N seconds after page load
  // This prevents alerts for cops that are already nearby when you open the app
  const pageLoadTimeRef = useRef<number>(Date.now());
  const WARMUP_PERIOD_MS = 10000; // 10 seconds warmup - silently mark nearby cops as seen

  // Dev mode - route simulation
  const [isDevMode, setIsDevMode] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulatedPosition, setSimulatedPosition] = useState<{ lat: number; lng: number; heading: number } | null>(null);
  const simulationIndexRef = useRef(0);
  const simulationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const { latitude: realLatitude, longitude: realLongitude, heading, effectiveHeading: realEffectiveHeading, speed: realSpeed, loading: geoLoading, error: geoError } = useGeolocation();
  
  // Use simulated position if simulating, otherwise use real position
  const latitude = isSimulating && simulatedPosition ? simulatedPosition.lat : realLatitude;
  const longitude = isSimulating && simulatedPosition ? simulatedPosition.lng : realLongitude;
  const effectiveHeading = isSimulating && simulatedPosition ? simulatedPosition.heading : realEffectiveHeading;
  // Simulated speed: ~25 m/s highway driving for testing, otherwise use real speed
  const speed = isSimulating ? 25 : realSpeed;
  const { alerts, loading: alertsLoading, reportPolice, voteOnReport } = usePoliceReports({ bounds });

  // Police reporting + "still there?" confirmations
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  const [confirmPrompt, setConfirmPrompt] = useState<{ id: string } | null>(null);
  const promptedPoliceIdsRef = useRef<Set<string>>(new Set());
  const ownReportIdsRef = useRef<Set<string>>(new Set());
  const confirmPromptTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Camera icons only from street level: zoomed out they bury the map. Warnings use allCameras.
  const { cameras, allCameras } = useSpeedCameras({ bounds, enabled: showSpeedCameras, minZoomLevel: 13 });
  const handleFuelTypeChange = useCallback((value: FuelType) => {
    setFuelType(value);
    localStorage.setItem(FUEL_TYPE_STORAGE_KEY, value);
  }, []);

  const cameraWarning = useCameraAlerts({
    cameras: allCameras,
    latitude,
    longitude,
    heading: effectiveHeading,
    speed,
    enabled: showSpeedCameras,
    units,
    language: navLanguage,
    speechLang,
    voiceEnabled,
  });

  const navProgress = useTurnByTurn({
    route,
    active: destination !== null,
    latitude,
    longitude,
    voiceEnabled,
    speechLang,
  });

  // DGT incidents: warnings for the ones on the route ahead (or ahead in our heading when
  // not navigating), pins on the map
  const roadEvents = useRoadEvents(true);
  const { warning: roadEventWarning, routeEvents } = useRoadEventAlerts({
    events: roadEvents,
    route: destination ? route : null,
    progress: navProgress,
    latitude,
    longitude,
    heading: effectiveHeading,
    speed,
    units,
    language: navLanguage,
    speechLang,
    voiceEnabled,
  });
  const roadEventAlerts = useMemo(() => {
    const labels = phrases(navLanguage).events;
    if (destination) {
      // Navigating: only what is still ahead on the route
      const along = navProgress?.distanceAlong ?? 0;
      return routeEvents.filter((r) => r.along >= along - 30).map((r) => toMapAlert(r.event, labels[r.event.kind]));
    }
    // Otherwise only clear-cut hazards in view, and not when zoomed out to a whole region
    if (!bounds || (bounds.zoom !== undefined && bounds.zoom < 9)) return [];
    return roadEvents
      .filter((e) => shownWithoutRoute(e)
        && e.start.lat >= bounds.south && e.start.lat <= bounds.north
        && e.start.lon >= bounds.west && e.start.lon <= bounds.east)
      .map((e) => toMapAlert(e, labels[e.kind]));
  }, [destination, navProgress?.distanceAlong, routeEvents, roadEvents, bounds, navLanguage]);

  // Live traffic while navigating: the next jam on the route, and every few minutes a fresh
  // calculation that either updates the current route's traffic or offers a faster way
  const jamWarning = useTrafficAlerts({
    route: destination ? route : null,
    progress: navProgress,
    units,
    language: navLanguage,
    speechLang,
    voiceEnabled,
  });
  const replaceRoute = useCallback((next: RouteData) => {
    setRoutes([next]);
    setSelectedRouteIndex(0);
  }, []);
  const { offer: fasterRoute, accept: acceptFasterRoute, dismiss: dismissFasterRoute } = useFasterRoute({
    destination,
    route: destination ? route : null,
    progress: navProgress,
    latitude,
    longitude,
    units,
    language: navLanguage,
    speechLang,
    voiceEnabled,
    onRefresh: replaceRoute,
  });
  const handleTakeFasterRoute = useCallback(() => {
    const next = acceptFasterRoute();
    if (next) replaceRoute(next);
  }, [acceptFasterRoute, replaceRoute]);

  // While driving only the chosen route is drawn (plus an offered faster one); alternatives
  // are for the preview. Memoised: the map redraws its route layers whenever this array changes.
  const mapRoutes = useMemo(() => {
    if (!destination || !route) return routes;
    return fasterRoute ? [route, fasterRoute.route] : [route];
  }, [destination, route, routes, fasterRoute]);

  // While navigating, category searches look along the road ahead instead of around the car
  const searchRouteAhead = useMemo(
    () => (route && navProgress && latitude && longitude ? routeAhead(route, navProgress, latitude, longitude) : null),
    [route, navProgress, latitude, longitude]
  );

  // Speedometer limit: an upcoming camera's limit wins, otherwise the route's limit for this segment
  const currentSpeedLimitKmh = cameraWarning?.limitKmh ?? navProgress?.speedLimitKmh ?? null;

  const handleStartTrip = useCallback(() => {
    unlockAudio([alertAudioRef.current]);
    if (voiceEnabled) speak(phrases(navLanguage).ready, speechLang);
    setTripStarted(true);
  }, [voiceEnabled, navLanguage, speechLang]);

  const handleNavLanguageChange = useCallback((value: NavLanguage) => {
    setNavLanguage(value);
    localStorage.setItem(NAV_LANGUAGE_STORAGE_KEY, value);
  }, []);

  const handleToggleVoice = useCallback((value: boolean) => {
    setVoiceEnabled(value);
    localStorage.setItem("tbn-voice", value.toString());
    if (!value && isSpeechSupported()) window.speechSynthesis.cancel();
  }, []);

  // Track last route origin to detect significant movement
  const lastRouteOriginRef = useRef<{ lat: number; lng: number } | null>(null);
  const routeUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastRerouteTimeRef = useRef<number>(0);
  const OFF_ROUTE_THRESHOLD = 50; // meters - reroute if user is this far from route
  const REROUTE_COOLDOWN = 5000; // ms - minimum time between reroutes to avoid spam

  // Calculate distance between two coordinates in meters (Haversine formula)
  const getDistanceInMeters = useCallback((lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }, []);

  // Calculate distance from a point to a line segment (for off-route detection)
  const getDistanceToSegment = useCallback((
    pointLat: number, pointLng: number,
    segStartLat: number, segStartLng: number,
    segEndLat: number, segEndLng: number
  ): number => {
    // Convert to a local coordinate system (meters) for simpler math
    const toMeters = (lat: number, lng: number, refLat: number, refLng: number) => {
      const latDiff = (lat - refLat) * 111320; // ~111km per degree latitude
      const lngDiff = (lng - refLng) * 111320 * Math.cos(refLat * Math.PI / 180);
      return { x: lngDiff, y: latDiff };
    };
    
    const p = toMeters(pointLat, pointLng, segStartLat, segStartLng);
    const a = { x: 0, y: 0 }; // segment start is origin
    const b = toMeters(segEndLat, segEndLng, segStartLat, segStartLng);
    
    // Vector from a to b
    const ab = { x: b.x - a.x, y: b.y - a.y };
    // Vector from a to p
    const ap = { x: p.x - a.x, y: p.y - a.y };
    
    // Project point onto line, clamped to segment
    const abLengthSq = ab.x * ab.x + ab.y * ab.y;
    if (abLengthSq === 0) {
      // Segment is a point
      return Math.sqrt(ap.x * ap.x + ap.y * ap.y);
    }
    
    let t = (ap.x * ab.x + ap.y * ab.y) / abLengthSq;
    t = Math.max(0, Math.min(1, t)); // Clamp to [0, 1]
    
    // Closest point on segment
    const closest = { x: a.x + t * ab.x, y: a.y + t * ab.y };
    
    // Distance from point to closest point
    const dx = p.x - closest.x;
    const dy = p.y - closest.y;
    return Math.sqrt(dx * dx + dy * dy);
  }, []);

  // Calculate minimum distance from a point to the entire route polyline
  const getDistanceToRoute = useCallback((lat: number, lng: number, routeCoords: [number, number][]): number => {
    if (routeCoords.length < 2) return Infinity;
    
    let minDistance = Infinity;
    
    for (let i = 0; i < routeCoords.length - 1; i++) {
      const [startLng, startLat] = routeCoords[i];
      const [endLng, endLat] = routeCoords[i + 1];
      
      const distance = getDistanceToSegment(lat, lng, startLat, startLng, endLat, endLng);
      if (distance < minDistance) {
        minDistance = distance;
      }
    }
    
    return minDistance;
  }, [getDistanceToSegment]);

  // Fetch route when destination is set
  const fetchRoute = useCallback(async (destLng: number, destLat: number, isUpdate = false) => {
    if (!latitude || !longitude) return;
    
    // Only show loading indicator for initial route, not updates
    if (!isUpdate) {
      setRouteLoading(true);
    }
    
    try {
      const response = await fetch(
        `/api/directions?originLng=${longitude}&originLat=${latitude}&destLng=${destLng}&destLat=${destLat}&language=${navLanguage}&units=${units}`
      );
      
      if (response.ok) {
        const data: RoutesResponse = await response.json();
        setRoutes(data.routes);
        
        // Reset to fastest route on initial fetch, keep selection on updates
        if (!isUpdate) {
          setSelectedRouteIndex(0);
        }
        
        // Update last origin
        lastRouteOriginRef.current = { lat: latitude, lng: longitude };
        
        if (!isUpdate && data.routes.length > 0) {
          posthog.capture("route_calculated", {
            distance_meters: data.routes[0].distance,
            duration_seconds: data.routes[0].duration,
            alternatives_count: data.routes.length,
          });
        }
      } else {
        console.error("Failed to fetch route");
        if (!isUpdate) {
          setRoutes([]);
          setSelectedRouteIndex(0);
        }
      }
    } catch (error) {
      console.error("Route fetch error:", error);
      if (!isUpdate) {
        setRoutes([]);
        setSelectedRouteIndex(0);
      }
    } finally {
      if (!isUpdate) {
        setRouteLoading(false);
      }
    }
  }, [latitude, longitude, navLanguage, units]);

  // Recalculate route when user deviates from the planned route (off-route detection)
  useEffect(() => {
    if (!destination || !latitude || !longitude || !route) return;
    
    // Check if we're off-route by measuring distance to the route line
    const distanceToRoute = getDistanceToRoute(latitude, longitude, route.geometry.coordinates);
    
    // If user is too far from the route, they've deviated - trigger reroute
    if (distanceToRoute > OFF_ROUTE_THRESHOLD) {
      const now = Date.now();
      
      // Respect cooldown to avoid rerouting spam
      if (now - lastRerouteTimeRef.current < REROUTE_COOLDOWN) {
        return;
      }
      
      // Clear any pending update
      if (routeUpdateTimeoutRef.current) {
        clearTimeout(routeUpdateTimeoutRef.current);
      }
      
      // Small debounce to ensure user has actually deviated (not just GPS jitter)
      routeUpdateTimeoutRef.current = setTimeout(() => {
        console.log(`Off-route detected: ${Math.round(distanceToRoute)}m from route. Rerouting...`);
        lastRerouteTimeRef.current = Date.now();
        lastRouteOriginRef.current = { lat: latitude, lng: longitude };
        fetchRoute(destination.lng, destination.lat, true);
        
        posthog.capture("auto_rerouted", {
          distance_from_route_meters: Math.round(distanceToRoute),
        });
      }, 1000);
    }
    
    return () => {
      if (routeUpdateTimeoutRef.current) {
        clearTimeout(routeUpdateTimeoutRef.current);
      }
    };
  }, [latitude, longitude, destination, route, fetchRoute, getDistanceToRoute]);

  // Handle destination selection from search - preview and fetch routes
  const handleSelectDestination = useCallback((lng: number, lat: number, placeName: string) => {
    setPreviewLocation({ lng, lat, name: placeName });
    setContextMenu(null);
    
    // Fetch routes for the preview location
    if (latitude && longitude) {
      fetchRoute(lng, lat);
    }
    
    // Center map on the searched location
    if (mapRef.current) {
      mapRef.current.flyToDestination(lng, lat);
    }
    posthog.capture("location_previewed", {
      place_name: placeName,
    });
  }, [latitude, longitude, fetchRoute]);

  // Actually start navigation from preview location
  const handleStartNavigation = useCallback(() => {
    if (!previewLocation || routes.length === 0) return;
    
    setDestination(previewLocation);
    setPreviewLocation(null);
    // Follow the car from the start (the preview left the map showing the whole route)
    mapRef.current?.enableAutoCentering();
    // Set last origin to current position for off-route detection
    if (latitude && longitude) {
      lastRouteOriginRef.current = { lat: latitude, lng: longitude };
    }
    
    posthog.capture("navigation_started_from_preview", {
      place_name: previewLocation.name,
      selected_route_index: selectedRouteIndex,
      routes_available: routes.length,
    });
  }, [previewLocation, routes, selectedRouteIndex, latitude, longitude]);

  // Cancel preview and return to user location
  const handleCancelPreview = useCallback(() => {
    setPreviewLocation(null);
    setRoutes([]);
    setSelectedRouteIndex(0);
    // Return to user's location
    if (latitude && longitude && mapRef.current) {
      mapRef.current.recenter(longitude, latitude);
    }
  }, [latitude, longitude]);

  // Clear destination
  const handleClearDestination = useCallback(() => {
    if (isSpeechSupported()) window.speechSynthesis.cancel();
    setDestination(null);
    setRoutes([]);
    setSelectedRouteIndex(0);
    setPreviewLocation(null);
    lastRouteOriginRef.current = null;
    if (routeUpdateTimeoutRef.current) {
      clearTimeout(routeUpdateTimeoutRef.current);
    }
    if (latitude && longitude && mapRef.current) {
      mapRef.current.recenter(longitude, latitude);
    }
  }, [latitude, longitude]);

  // A search result (list row or map pin). While navigating it becomes the new destination right
  // away, so guidance continues; otherwise it opens the usual route preview.
  const handleSelectPlace = useCallback((place: Place) => {
    setSearchResults([]);
    if (destination) {
      setDestination({ lng: place.lon, lat: place.lat, name: place.name });
      setSelectedRouteIndex(0);
      fetchRoute(place.lon, place.lat, true);
      mapRef.current?.enableAutoCentering();
      return;
    }
    handleSelectDestination(place.lon, place.lat, place.name);
  }, [destination, fetchRoute, handleSelectDestination]);

  // Handle long press on map
  const handleMapLongPress = useCallback(async (lng: number, lat: number, screenX: number, screenY: number) => {
    setContextMenuLoading(true);
    setContextMenu({ lng, lat, screenX, screenY });

    // Reverse geocode to get place name
    try {
      const response = await fetch(
        `/api/geocode/reverse?lng=${lng}&lat=${lat}&language=${navLanguage}`
      );
      if (response.ok) {
        const data = await response.json();
        setContextMenu({ lng, lat, screenX, screenY, placeName: data.placeName });
      }
    } catch (error) {
      console.error("Reverse geocode error:", error);
    } finally {
      setContextMenuLoading(false);
    }
  }, [navLanguage]);

  // Select long-pressed location for preview (same flow as search)
  const handleNavigateToContextMenu = useCallback(() => {
    if (contextMenu) {
      const name = contextMenu.placeName || `${contextMenu.lat.toFixed(4)}, ${contextMenu.lng.toFixed(4)}`;
      
      // Set as preview location (user can then choose to navigate)
      setPreviewLocation({ lng: contextMenu.lng, lat: contextMenu.lat, name });
      setContextMenu(null);

      // Fetch routes for the preview location (Navigate stays disabled without them)
      if (latitude && longitude) {
        fetchRoute(contextMenu.lng, contextMenu.lat);
      }

      // Center map on the selected location
      if (mapRef.current) {
        mapRef.current.recenter(contextMenu.lng, contextMenu.lat);
      }

      posthog.capture("location_selected_from_long_press", {
        place_name: name,
        coordinates: { lng: contextMenu.lng, lat: contextMenu.lat },
      });
    }
  }, [contextMenu, latitude, longitude, fetchRoute]);

  // Close context menu
  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Initialize audio element on mount
  // Note: Other settings are loaded via lazy useState initialization above
  useEffect(() => {
    if (typeof window !== "undefined") {
      // Initialize audio element
      alertAudioRef.current = new Audio("/alert-sound.mp3");
      
      // Apply saved follow mode to map when it's ready
      const savedFollowMode = localStorage.getItem("tbn-follow-mode");
      if (savedFollowMode === "true") {
        setTimeout(() => {
          if (mapRef.current) {
            mapRef.current.setFollowMode(true);
          }
        }, 100);
      }
    }
  }, []);

  // Detect dev mode from URL parameter
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setIsDevMode(params.get("dev") === "true");
    }
  }, []);

  // Save satellite preference to localStorage
  const handleToggleSatellite = useCallback((value: boolean) => {
    setUseSatellite(value);
    if (typeof window !== "undefined") {
      localStorage.setItem("tbn-satellite", value.toString());
    }
  }, []);

  // Save 3D mode preference to localStorage and auto-enable follow mode
  const handleToggle3DMode = useCallback((value: boolean) => {
    setUse3DMode(value);
    if (typeof window !== "undefined") {
      localStorage.setItem("tbn-3d-mode", value.toString());
    }
    // Auto-enable follow mode when 3D is enabled for the best experience
    if (value && !followMode) {
      setFollowMode(true);
      if (mapRef.current) {
        mapRef.current.setFollowMode(true);
      }
      if (typeof window !== "undefined") {
        localStorage.setItem("tbn-follow-mode", "true");
      }
    }
  }, [followMode]);

  // Save traffic preference to localStorage
  const handleToggleTraffic = useCallback((value: boolean) => {
    setShowTraffic(value);
    if (typeof window !== "undefined") {
      localStorage.setItem("tbn-traffic", value.toString());
    }
  }, []);

  // Save police alert distance to localStorage
  const handlePoliceAlertDistanceChange = useCallback((value: number) => {
    setPoliceAlertDistance(value);
    if (typeof window !== "undefined") {
      localStorage.setItem("tbn-police-distance", value.toString());
    }
    // Clear alerted IDs when changing distance so alerts can re-trigger
    alertedPoliceIdsRef.current.clear();
  }, []);

  // Switching units also snaps the police alert distance to the nearest preset of the new system
  const handleUnitsChange = useCallback((value: UnitSystem) => {
    setUnits(value);
    if (typeof window !== "undefined") {
      localStorage.setItem(UNIT_SYSTEM_STORAGE_KEY, value);
    }
    handlePoliceAlertDistanceChange(closestPoliceAlertDistance(policeAlertDistance, value));
  }, [policeAlertDistance, handlePoliceAlertDistanceChange]);

  // Save police alert sound preference to localStorage
  const handleTogglePoliceAlertSound = useCallback((value: boolean) => {
    setPoliceAlertSound(value);
    if (typeof window !== "undefined") {
      localStorage.setItem("tbn-police-sound", value.toString());
    }
  }, []);


  // Calculate bearing between two points
  const calculateBearing = useCallback((lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const toDeg = (rad: number) => (rad * 180) / Math.PI;
    const dLng = toRad(lng2 - lng1);
    const lat1Rad = toRad(lat1);
    const lat2Rad = toRad(lat2);
    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
    let bearing = toDeg(Math.atan2(y, x));
    return (bearing + 360) % 360;
  }, []);

  // Start route simulation (dev mode only)
  const startSimulation = useCallback(() => {
    if (!route || !route.geometry.coordinates.length) return;
    
    // Reset simulation state
    simulationIndexRef.current = 0;
    setIsSimulating(true);
    
    // Clear any alerted police so they can re-trigger during simulation
    alertedPoliceIdsRef.current.clear();
    // Reset warmup timer so nearby alerts at sim start are silently marked as seen
    pageLoadTimeRef.current = Date.now();
    // Also reset the cooldown
    lastAlertTimeRef.current = 0;
    
    const coordinates = route.geometry.coordinates;
    const SIMULATION_SPEED = 200; // ms between position updates
    
    // Start at the first coordinate
    const [startLng, startLat] = coordinates[0];
    const nextCoord = coordinates[1] || coordinates[0];
    const initialHeading = calculateBearing(startLat, startLng, nextCoord[1], nextCoord[0]);
    setSimulatedPosition({ lat: startLat, lng: startLng, heading: initialHeading });
    
    // Enable auto-centering so the map follows the simulation
    // Use enableAutoCentering instead of recenter to avoid flyTo animation conflicts
    if (mapRef.current) {
      mapRef.current.enableAutoCentering();
    }
    
    simulationIntervalRef.current = setInterval(() => {
      simulationIndexRef.current += 1;
      const index = simulationIndexRef.current;
      
      if (index >= coordinates.length) {
        // End of route
        stopSimulation();
        return;
      }
      
      const [lng, lat] = coordinates[index];
      const nextCoord = coordinates[index + 1] || coordinates[index];
      const heading = calculateBearing(lat, lng, nextCoord[1], nextCoord[0]);
      
      setSimulatedPosition({ lat, lng, heading });
    }, SIMULATION_SPEED);
    
    posthog.capture("dev_simulation_started");
  }, [route, calculateBearing]);

  // Stop route simulation
  const stopSimulation = useCallback(() => {
    if (simulationIntervalRef.current) {
      clearInterval(simulationIntervalRef.current);
      simulationIntervalRef.current = null;
    }
    setIsSimulating(false);
    setSimulatedPosition(null);
    simulationIndexRef.current = 0;
    
    // Recenter on real position when stopping
    if (realLatitude && realLongitude && mapRef.current) {
      mapRef.current.recenter(realLongitude, realLatitude);
    }
    
    posthog.capture("dev_simulation_stopped");
  }, [realLatitude, realLongitude]);

  // Cleanup simulation on unmount
  useEffect(() => {
    return () => {
      if (simulationIntervalRef.current) {
        clearInterval(simulationIntervalRef.current);
      }
    };
  }, []);

  // Check if an alert is ahead of us (within ±90° of our heading)
  const isAlertAhead = useCallback((alertLat: number, alertLng: number, userHeading: number | null): boolean => {
    // If no heading available, assume it's ahead (better to alert than miss)
    if (userHeading === null) return true;
    
    // Calculate bearing from user to alert
    const bearingToAlert = calculateBearing(latitude!, longitude!, alertLat, alertLng);
    
    // Calculate the angle difference between heading and bearing to alert
    let angleDiff = bearingToAlert - userHeading;
    
    // Normalize to -180 to 180 range
    while (angleDiff > 180) angleDiff -= 360;
    while (angleDiff < -180) angleDiff += 360;
    
    // Alert is "ahead" if within ±90° of our heading
    return Math.abs(angleDiff) <= 90;
  }, [latitude, longitude, calculateBearing]);

  // Police proximity detection
  useEffect(() => {
    if (!latitude || !longitude || policeAlertDistance === 0 || !showWazeAlerts) return;

    // Filter for police alerts
    const policeAlerts = alerts.filter(alert => alert.type === "POLICE");
    
    // Skip if no alerts to process
    if (policeAlerts.length === 0) return;

    const now = Date.now();
    const timeSincePageLoad = now - pageLoadTimeRef.current;
    const isInWarmupPeriod = timeSincePageLoad < WARMUP_PERIOD_MS;

    // During warmup period: silently mark all nearby alerts as "seen" without triggering
    // This prevents alerts for cops that are already nearby when you open the app
    // or when your GPS position is still stabilizing
    if (isInWarmupPeriod) {
      for (const alert of policeAlerts) {
        const distance = getDistanceInMeters(
          latitude,
          longitude,
          alert.location.y,
          alert.location.x
        );
        
        if (distance <= policeAlertDistance) {
          // Silently mark as seen (no alert triggered)
          alertedPoliceIdsRef.current.add(alert.uuid);
        }
      }
      return; // Skip normal alert processing during warmup
    }

    // Check if we're still in cooldown period
    if (now - lastAlertTimeRef.current < ALERT_COOLDOWN_MS) {
      return; // Still in cooldown, don't trigger any new alerts
    }
    
    // Check each police alert for proximity
    for (const alert of policeAlerts) {
      // Skip if we already alerted for this one
      if (alertedPoliceIdsRef.current.has(alert.uuid)) continue;
      
      const distance = getDistanceInMeters(
        latitude,
        longitude,
        alert.location.y, // lat
        alert.location.x  // lng
      );
      
      if (distance <= policeAlertDistance) {
        // Only alert if the police is AHEAD of us, not behind
        if (!isAlertAhead(alert.location.y, alert.location.x, effectiveHeading)) {
          // Mark as "seen" so we don't keep checking it, but don't alert
          alertedPoliceIdsRef.current.add(alert.uuid);
          continue;
        }
        
        // Mark as alerted and set cooldown
        alertedPoliceIdsRef.current.add(alert.uuid);
        lastAlertTimeRef.current = now;
        
        // Show toast notification
        setPoliceAlertToast({ show: true, expanding: false });
        
        // Start expansion animation after a brief moment
        setTimeout(() => {
          setPoliceAlertToast({ show: true, expanding: true });
        }, 50);
        
        // Play sound if enabled
        if (policeAlertSound && alertAudioRef.current) {
          alertAudioRef.current.currentTime = 0;
          alertAudioRef.current.play().catch(err => {
            console.log("Audio play failed:", err);
          });
        }
        
        // Track the alert
        posthog.capture("police_alert_triggered", {
          distance_meters: Math.round(distance),
          alert_distance_setting: policeAlertDistance,
          sound_enabled: policeAlertSound,
        });
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
          setPoliceAlertToast(null);
        }, 5000);
        
        // Only show one alert at a time
        break;
      }
    }
  }, [latitude, longitude, alerts, policeAlertDistance, policeAlertSound, showWazeAlerts, getDistanceInMeters, effectiveHeading, isAlertAhead]);

  // When passing close to a police report, ask whether it's still there
  useEffect(() => {
    if (!latitude || !longitude || !showWazeAlerts || confirmPrompt) return;

    const nearby = alerts.find(
      (alert) =>
        alert.type === "POLICE" &&
        !promptedPoliceIdsRef.current.has(alert.uuid) &&
        !ownReportIdsRef.current.has(alert.uuid) &&
        getDistanceInMeters(latitude, longitude, alert.location.y, alert.location.x) <= CONFIRM_PROMPT_DISTANCE_M
    );
    if (!nearby) return;

    promptedPoliceIdsRef.current.add(nearby.uuid);
    setConfirmPrompt({ id: nearby.uuid });
    confirmPromptTimerRef.current = setTimeout(() => setConfirmPrompt(null), CONFIRM_PROMPT_TIMEOUT_MS);
  }, [latitude, longitude, alerts, showWazeAlerts, confirmPrompt, getDistanceInMeters]);

  useEffect(() => {
    return () => {
      if (confirmPromptTimerRef.current) clearTimeout(confirmPromptTimerRef.current);
    };
  }, []);

  const flashReportStatus = useCallback((message: string) => {
    setReportStatus(message);
    setTimeout(() => setReportStatus(null), 3000);
  }, []);

  const handleReportPolice = useCallback(async () => {
    if (!latitude || !longitude) {
      flashReportStatus("No GPS position yet");
      return;
    }
    const id = await reportPolice(latitude, longitude);
    if (id) {
      ownReportIdsRef.current.add(id);
      // Don't alert ourselves about our own report
      alertedPoliceIdsRef.current.add(id);
      flashReportStatus("Police reported");
      posthog.capture("police_reported");
    } else {
      flashReportStatus("Report failed — offline?");
    }
  }, [latitude, longitude, reportPolice, flashReportStatus]);

  const handleConfirmVote = useCallback(async (vote: "up" | "down") => {
    if (!confirmPrompt) return;
    if (confirmPromptTimerRef.current) clearTimeout(confirmPromptTimerRef.current);
    setConfirmPrompt(null);
    const ok = await voteOnReport(confirmPrompt.id, vote);
    flashReportStatus(ok ? "Thanks!" : "Vote failed — offline?");
  }, [confirmPrompt, voteOnReport, flashReportStatus]);

  // Listen for system dark mode preference changes
  // Only update if user hasn't explicitly set a preference
  useEffect(() => {
    if (typeof window !== "undefined") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent) => {
        // Only apply system preference if user hasn't explicitly set one
        const savedTheme = localStorage.getItem("tbn-theme");
        if (savedTheme === null) {
          setIsDarkMode(e.matches);
        }
      };
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    }
  }, []);

  const handleBoundsChange = useCallback((newBounds: MapBounds) => {
    setBounds(newBounds);
  }, []);

  // Callback from Map when centering state changes (user pans away or recenters)
  const handleCenteredChange = useCallback((centered: boolean) => {
    setIsCentered(centered);
  }, []);

  const handleRecenter = useCallback(() => {
    if (latitude && longitude && mapRef.current) {
      mapRef.current.recenter(longitude, latitude);
      // Map component will call onCenteredChange(true)

      // Track recenter event
      posthog.capture("map_recentered", {
        latitude,
        longitude,
        follow_mode: followMode,
      });
    }
  }, [latitude, longitude, followMode]);

  const toggleDarkMode = useCallback(() => {
    setIsDarkMode((prev) => {
      const newValue = !prev;

      // Persist to localStorage
      if (typeof window !== "undefined") {
        localStorage.setItem("tbn-theme", newValue ? "dark" : "light");
      }

      // Track dark mode toggle
      posthog.capture("dark_mode_toggled", {
        dark_mode_enabled: newValue,
      });

      return newValue;
    });
  }, []);

  const toggleFollowMode = useCallback(() => {
    setFollowMode((prev) => {
      const newValue = !prev;
      if (mapRef.current) {
        mapRef.current.setFollowMode(newValue);
      }

      // Save to localStorage
      if (typeof window !== "undefined") {
        localStorage.setItem("tbn-follow-mode", newValue.toString());
      }

      // Track follow mode toggle
      posthog.capture("follow_mode_toggled", {
        follow_mode_enabled: newValue,
      });

      return newValue;
    });
  }, []);

  const handleZoomIn = useCallback(() => {
    mapRef.current?.zoomIn();

    // Track zoom in event
    posthog.capture("map_zoomed_in");
  }, []);

  const handleZoomOut = useCallback(() => {
    mapRef.current?.zoomOut();

    // Track zoom out event
    posthog.capture("map_zoomed_out");
  }, []);

  // Filter alerts to show only key types (if enabled)
  const filteredAlerts = useMemo(
    () => (showWazeAlerts
      ? alerts.filter((alert) => ["POLICE", "ACCIDENT", "HAZARD", "ROAD_CLOSED"].includes(alert.type))
      : []),
    [showWazeAlerts, alerts]
  );

  // Police reports plus DGT incidents, one set of pins on the map
  const mapAlerts = useMemo(() => [...filteredAlerts, ...roadEventAlerts], [filteredAlerts, roadEventAlerts]);

  // Count by type for display
  const alertCounts = {
    police: mapAlerts.filter((a) => a.type === "POLICE").length,
    accidents: mapAlerts.filter((a) => a.type === "ACCIDENT").length,
    hazards: mapAlerts.filter((a) => a.type === "HAZARD").length,
    closures: mapAlerts.filter((a) => a.type === "ROAD_CLOSED").length,
  };

  // Show refocus button when not centered (regardless of rotation mode)
  const showRefocusButton = !isCentered && latitude && longitude;

  // Use dark theme for UI when satellite mode is on
  const effectiveDarkMode = isDarkMode || useSatellite;

  // Compass colors based on theme
  const compassCircleColor = effectiveDarkMode ? "#6b7280" : "#9ca3af";
  const compassNeedleColor = followMode ? "#3b82f6" : (effectiveDarkMode ? "#d1d5db" : "#374151");
  const compassCenterFill = effectiveDarkMode ? "#1a1a1a" : "white";
  const compassCenterStroke = effectiveDarkMode ? "#9ca3af" : "#374151";

  // Show full-screen loading until we have location
  if (!latitude || !longitude) {
    return (
      <main className="relative w-full h-full bg-[#0a0a0a] flex items-center justify-center">
        {/* Let the driver tap "Start" while GPS is still acquiring */}
        {!tripStarted && (
          <StartTripScreen
            language={navLanguage}
            onLanguageChange={handleNavLanguageChange}
            voiceEnabled={voiceEnabled}
            onToggleVoice={handleToggleVoice}
            onStart={handleStartTrip}
          />
        )}
        <div className="flex flex-col items-center gap-6">
          {/* App logo/title */}
          <div className="flex items-center gap-3">
            <Image
              src="/maps-avatar.jpg"
              alt={APP_NAME}
              width={48}
              height={48}
              className="rounded-lg"
            />
            <div className="flex flex-col">
              <span className="text-2xl font-bold text-white tracking-wide">{APP_NAME}</span>
              <span className="text-xs text-gray-500">v0.3.0</span>
            </div>
          </div>
          
          {/* Loading indicator */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 border-4 border-white/10 border-t-blue-500 rounded-full animate-spin" />
              <div className="absolute inset-0 w-12 h-12 border-4 border-transparent border-t-blue-400/30 rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
            </div>
            <span className="text-gray-400 text-sm font-medium">
              {geoError ? geoError : "Finding your location..."}
            </span>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="relative w-full h-full">
      {/* Map */}
      <Map
        ref={mapRef}
        center={[longitude, latitude]}
        zoom={14}
        isDarkMode={effectiveDarkMode}
        alerts={mapAlerts}
        speedCameras={showSpeedCameras ? cameras : []}
        places={searchResults}
        onSelectPlace={handleSelectPlace}
        units={units}
        onBoundsChange={handleBoundsChange}
        onCenteredChange={handleCenteredChange}
        onLongPress={handleMapLongPress}
        pinLocation={contextMenu ? { lng: contextMenu.lng, lat: contextMenu.lat } : previewLocation ? { lng: previewLocation.lng, lat: previewLocation.lat } : null}
        routes={mapRoutes}
        selectedRouteIndex={destination ? 0 : selectedRouteIndex}
        fitRoutes={!destination}
        userLocation={{ latitude, longitude, heading, effectiveHeading, speed }}
        followMode={followMode}
        showTraffic={showTraffic}
        useSatellite={useSatellite}
        showAvatarPulse={showAvatarPulse}
        showAlertRadius={isDevMode && policeAlertDistance > 0}
        alertRadiusMeters={policeAlertDistance}
        use3DMode={use3DMode}
      />

      {/* Context Menu - Shows on long press */}
      {contextMenu && (() => {
        // Smart positioning: show below pin if in upper half, above pin if in lower half
        const isUpperHalf = contextMenu.screenY < window.innerHeight / 2;
        const menuHeight = 180; // approximate menu height
        const pinOffset = 40; // space between pin and menu
        
        // Calculate horizontal position (keep menu on screen)
        const menuWidth = 280;
        let leftPos = contextMenu.screenX;
        // Clamp to keep menu on screen horizontally
        leftPos = Math.max(menuWidth / 2 + 16, Math.min(leftPos, window.innerWidth - menuWidth / 2 - 16));
        
        return (
        <div className="absolute inset-0 z-40" onClick={handleCloseContextMenu}>
          <div 
            className="absolute -translate-x-1/2"
            style={{ 
              left: leftPos,
              ...(isUpperHalf 
                ? { top: contextMenu.screenY + pinOffset }
                : { top: contextMenu.screenY - pinOffset - menuHeight }
              ),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`
                rounded-2xl backdrop-blur-xl shadow-2xl border overflow-hidden
                ${effectiveDarkMode ? "bg-[#1a1a1a]/95 text-white border-white/10" : "bg-white/95 text-black border-black/10"}
                min-w-[280px]
              `}
            >
              {/* Location info */}
              <div className="px-5 py-4 border-b border-inherit">
                <div className={`text-xs uppercase tracking-wider mb-1 ${effectiveDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                  Selected Location
                </div>
                <div className="text-sm font-medium">
                  {contextMenuLoading ? (
                    <span className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin opacity-50" />
                      Finding address...
                    </span>
                  ) : (
                    contextMenu.placeName || `${contextMenu.lat.toFixed(4)}, ${contextMenu.lng.toFixed(4)}`
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="p-2">
                <button
                  onClick={handleNavigateToContextMenu}
                  className={`
                    w-full flex items-center gap-3 px-4 py-3 rounded-xl
                    ${effectiveDarkMode ? "hover:bg-white/10" : "hover:bg-black/5"}
                    transition-colors text-left
                  `}
                >
                  <NavigateToIcon className={`w-5 h-5 ${effectiveDarkMode ? "text-blue-400" : "text-blue-500"}`} />
                  <span className="font-medium">Select location</span>
                </button>
                <button
                  onClick={handleCloseContextMenu}
                  className={`
                    w-full flex items-center gap-3 px-4 py-3 rounded-xl
                    ${effectiveDarkMode ? "hover:bg-white/10 text-gray-400" : "hover:bg-black/5 text-gray-500"}
                    transition-colors text-left
                  `}
                >
                  <CloseNavIcon className="w-5 h-5" />
                  <span className="font-medium">Cancel</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Top Left - Turn-by-turn banner while navigating, otherwise search */}
      {/* Capped above the speedometer so a long result list never covers it */}
      <div className="absolute top-4 left-4 z-30 flex flex-col gap-3 max-h-[calc(100vh-15rem)]">
        {navProgress && destination && (
          <ManeuverBanner
            progress={navProgress}
            destinationName={destination.name}
            onEnd={handleClearDestination}
            units={units}
            isDarkMode={effectiveDarkMode}
          />
        )}

        {fasterRoute && (
          <FasterRouteCard
            offer={fasterRoute}
            units={units}
            onAccept={handleTakeFasterRoute}
            onDismiss={dismissFasterRoute}
          />
        )}

        <NavigateSearch
          isDarkMode={effectiveDarkMode}
          userLocation={latitude && longitude ? { latitude, longitude } : null}
          routeAhead={destination ? searchRouteAhead : null}
          language={navLanguage}
          fuelType={fuelType}
          units={units}
          onSelectPlace={handleSelectPlace}
          onResultsChange={setSearchResults}
          onOpenChange={setIsSearchOpen}
        />

        {/* Preview Card - Shows when a location is searched but not navigating yet */}
        {previewLocation && !destination && !isSearchOpen && (
          <div
            className={`
              rounded-2xl backdrop-blur-xl overflow-hidden
              ${getContainerStyles(effectiveDarkMode)}
              shadow-lg border max-w-[400px]
            `}
          >
            {/* Location info */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-inherit">
              <LocationSearchIcon className={`w-5 h-5 flex-shrink-0 ${effectiveDarkMode ? "text-blue-400" : "text-blue-500"}`} />
              <div className="flex-1 min-w-0">
                <div className={`text-xs uppercase tracking-wider ${effectiveDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                  Search Result
                </div>
                <div className="text-sm font-medium truncate">{previewLocation.name}</div>
              </div>
            </div>

            {/* Route Selection - Shows when routes are loaded */}
            {routes.length > 0 && (
              <div className="py-2 border-b border-inherit">
                <RouteSelector
                  routes={routes}
                  selectedIndex={selectedRouteIndex}
                  onSelectRoute={setSelectedRouteIndex}
                  isDarkMode={effectiveDarkMode}
                  units={units}
                />
              </div>
            )}
            
            {/* Loading indicator */}
            {routeLoading && routes.length === 0 && (
              <div className="flex items-center gap-2 px-4 py-3 border-b border-inherit">
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin opacity-50" />
                <span className={`text-sm ${effectiveDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                  Finding routes...
                </span>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 p-3">
              <button
                onClick={handleStartNavigation}
                disabled={routes.length === 0}
                className={`
                  flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                  bg-blue-500 text-white font-medium
                  transition-all hover:bg-blue-600 active:scale-[0.98]
                  disabled:opacity-50 disabled:cursor-not-allowed
                `}
              >
                <NavigateToIcon className="w-4 h-4" />
                {routes.length > 1 ? "Start Selected Route" : "Navigate"}
              </button>
              <button
                onClick={handleCancelPreview}
                className={`
                  px-4 py-2.5 rounded-xl font-medium
                  ${effectiveDarkMode ? "bg-white/10 hover:bg-white/20" : "bg-black/5 hover:bg-black/10"}
                  transition-all active:scale-[0.98]
                `}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        
        {/* Destination card - only until turn-by-turn has a route to show (the banner takes over) */}
        {destination && !navProgress && !isSearchOpen && (
          <div
            className={`
              rounded-2xl backdrop-blur-xl overflow-hidden
              ${getContainerStyles(effectiveDarkMode)}
              shadow-lg border max-w-[360px]
            `}
          >
            {/* Route info */}
            {route && (
              <div className="flex items-center gap-4 px-4 py-3 border-b border-inherit">
                <div className="flex items-center gap-2">
                  <ClockIcon className={`w-5 h-5 ${effectiveDarkMode ? "text-blue-400" : "text-blue-500"}`} />
                  <span className="text-lg font-semibold">
                    {formatDuration(route.duration)}
                  </span>
                </div>
                <div className={`text-sm ${effectiveDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                  {formatDistance(route.distance, units)}
                </div>
              </div>
            )}
            {routeLoading && (
              <div className="flex items-center gap-2 px-4 py-3 border-b border-inherit">
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin opacity-50" />
                <span className={`text-sm ${effectiveDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                  Calculating route...
                </span>
              </div>
            )}
            
            {/* Destination info */}
            <div className="flex items-center gap-3 px-4 py-3">
              <NavigateToIcon className={`w-5 h-5 flex-shrink-0 ${effectiveDarkMode ? "text-blue-400" : "text-blue-500"}`} />
              <div className="flex-1 min-w-0">
                <div className={`text-xs uppercase tracking-wider ${effectiveDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                  Navigating to
                </div>
                <div className="text-sm font-medium truncate">{destination.name}</div>
              </div>
              <button
                onClick={handleClearDestination}
                className={`
                  p-2 rounded-lg transition-colors
                  ${effectiveDarkMode ? "hover:bg-white/10" : "hover:bg-black/5"}
                `}
                aria-label="Clear destination"
              >
                <CloseNavIcon className="w-5 h-5 opacity-60" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Top Right - Compass + Alert Summary (stacked) */}
      <div className="absolute top-4 right-4 z-30 flex flex-col items-end gap-3">
        {/* Compass/Orientation Toggle */}
        <button
          onClick={toggleFollowMode}
          className={`
            w-[72px] h-[72px] rounded-xl backdrop-blur-xl flex items-center justify-center
            ${getButtonStyles(effectiveDarkMode)}
            shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
          `}
          aria-label={followMode ? "Lock north up" : "Follow heading"}
        >
          <div className="relative w-11 h-11">
            {/* Compass icon */}
            <svg viewBox="0 0 24 24" className="w-full h-full">
              {/* Outer circle */}
              <circle cx="12" cy="12" r="10" fill="none" stroke={compassCircleColor} strokeWidth="1" />
              {/* N marker */}
              <text x="12" y="5" textAnchor="middle" fontSize="5" fill="#f59e0b" fontWeight="bold">N</text>
              {/* Arrow/needle */}
              <path
                d="M12 6 L14 12 L12 18 L10 12 Z"
                fill={compassNeedleColor}
                className="transition-colors duration-200"
              />
              {/* Center dot */}
              <circle cx="12" cy="12" r="1.5" fill={compassCenterFill} stroke={compassCenterStroke} strokeWidth="0.5" />
            </svg>
            {/* Active indicator */}
            {followMode && (
              <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-blue-500 rounded-full border-2 border-white" />
            )}
          </div>
        </button>

        {/* Alert Summary - Stacked vertically, same width as compass */}
        {(alertCounts.police + alertCounts.accidents + alertCounts.hazards + alertCounts.closures > 0 || alertsLoading) && (
          <div
            className={`
              w-[72px] flex flex-col items-center gap-1.5 py-3 rounded-xl backdrop-blur-xl
              ${getContainerStyles(effectiveDarkMode)}
              shadow-lg border relative
            `}
          >
            {/* Waze loading indicator - shows when fetching new data */}
            {alertsLoading && (
              <div className="absolute -top-2 -right-2 z-10">
                <div className="relative">
                  <WazeIcon className="w-6 h-6 text-cyan-400 animate-pulse" />
                  <div className="absolute inset-0 w-6 h-6 rounded-full bg-cyan-400/30 animate-ping" />
                </div>
              </div>
            )}
            {alertCounts.police > 0 && (
              <span className="flex items-center gap-1.5 text-base">
                <ShieldExclamationIcon className="w-5 h-5 text-blue-500" />
                <span className="font-semibold">{alertCounts.police}</span>
              </span>
            )}
            {alertCounts.accidents > 0 && (
              <span className="flex items-center gap-1.5 text-base">
                <ExclamationTriangleIcon className="w-5 h-5 text-red-500" />
                <span className="font-semibold">{alertCounts.accidents}</span>
              </span>
            )}
            {alertCounts.hazards > 0 && (
              <span className="flex items-center gap-1.5 text-base">
                <ExclamationTriangleIcon className="w-5 h-5 text-amber-500" />
                <span className="font-semibold">{alertCounts.hazards}</span>
              </span>
            )}
            {alertCounts.closures > 0 && (
              <span className="flex items-center gap-1.5 text-base">
                <NoSymbolIcon className="w-5 h-5 text-gray-500" />
                <span className="font-semibold">{alertCounts.closures}</span>
              </span>
            )}
            {/* Show placeholder when loading with no alerts yet */}
            {alertsLoading && filteredAlerts.length === 0 && (
              <span className={`text-xs ${effectiveDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                Loading...
              </span>
            )}
          </div>
        )}
      </div>

      {/* Top Center - Speed camera and road incident warnings */}
      {(cameraWarning || roadEventWarning || jamWarning) && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-3">
          {cameraWarning && <CameraWarningBanner warning={cameraWarning} units={units} />}
          {roadEventWarning && <RoadEventBanner warning={roadEventWarning} units={units} language={navLanguage} />}
          {jamWarning && <TrafficJamBanner warning={jamWarning} units={units} language={navLanguage} />}
        </div>
      )}

      {/* Speedometer - above the bottom-left controls, closest to the driver */}
      <div className="absolute bottom-28 left-4 z-30">
        <SpeedDisplay
          speedMetersPerSecond={speed}
          speedLimitKmh={currentSpeedLimitKmh}
          units={units}
          isDarkMode={effectiveDarkMode}
        />
      </div>

      {/* Bottom Left - User Location + Settings */}
      <div className="absolute bottom-6 left-4 z-30 flex items-center gap-3">
        {/* Settings Button */}
        <button
          onClick={() => {
            setShowSettings(true);
            // Track settings opened event
            posthog.capture("settings_opened");
          }}
          className={`
            w-16 h-16 rounded-xl backdrop-blur-xl flex items-center justify-center
            ${getButtonStyles(effectiveDarkMode)}
            shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
          `}
          aria-label="Settings"
        >
          <SettingsIcon className="w-7 h-7" />
        </button>

        {/* Report Police Button */}
        <button
          onClick={handleReportPolice}
          className="px-5 h-16 rounded-xl backdrop-blur-xl flex items-center justify-center gap-2 bg-blue-600/85 text-white border-blue-400/30 shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95"
          aria-label="Report police here"
        >
          <PoliceAlertIcon className="w-7 h-7" />
          <span className="text-base font-bold">Police</span>
        </button>

        {/* Voice mute toggle */}
        <button
          onClick={() => handleToggleVoice(!voiceEnabled)}
          className={`
            w-16 h-16 rounded-xl backdrop-blur-xl flex items-center justify-center
            ${getButtonStyles(effectiveDarkMode)}
            shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
          `}
          aria-label={voiceEnabled ? "Mute voice guidance" : "Unmute voice guidance"}
          aria-pressed={voiceEnabled}
        >
          <span className="text-3xl leading-none">{voiceEnabled ? "🔊" : "🔇"}</span>
        </button>
      </div>

      {/* Start screen - unlocks audio with the first tap */}
      {!tripStarted && (
        <StartTripScreen
          language={navLanguage}
          onLanguageChange={handleNavLanguageChange}
          voiceEnabled={voiceEnabled}
          onToggleVoice={handleToggleVoice}
          onStart={handleStartTrip}
        />
      )}

      {/* Police "still there?" prompt */}
      {confirmPrompt && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-40">
          <div
            className={`
              flex items-center gap-4 pl-5 pr-3 py-3 rounded-2xl backdrop-blur-xl shadow-2xl border
              ${getContainerStyles(effectiveDarkMode)}
            `}
          >
            <PoliceAlertIcon className="w-8 h-8 text-blue-500" />
            <span className="text-lg font-semibold">Police still there?</span>
            <button
              onClick={() => handleConfirmVote("up")}
              className="h-14 px-6 rounded-xl bg-blue-600 text-white text-lg font-bold active:scale-95 transition-transform"
            >
              Yes
            </button>
            <button
              onClick={() => handleConfirmVote("down")}
              className="h-14 px-6 rounded-xl bg-gray-500/80 text-white text-lg font-bold active:scale-95 transition-transform"
            >
              Not there
            </button>
          </div>
        </div>
      )}

      {/* Report / vote feedback */}
      {reportStatus && !confirmPrompt && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-40">
          <div
            className={`
              px-5 py-3 rounded-xl backdrop-blur-xl shadow-lg border text-base font-semibold
              ${getContainerStyles(effectiveDarkMode)}
            `}
          >
            {reportStatus}
          </div>
        </div>
      )}

      {/* Bottom Right - Control Buttons */}
      <div className="absolute bottom-6 right-4 z-30 flex gap-3">
        {/* Dev Mode - Police Alert Test Button */}
        {isDevMode && (
          <button
            onClick={() => {
              setPoliceAlertToast({ show: true, expanding: true });
              // Play sound if enabled
              if (policeAlertSound && alertAudioRef.current) {
                alertAudioRef.current.currentTime = 0;
                alertAudioRef.current.play().catch(err => console.log("Audio play failed:", err));
              }
              // Auto-hide after 5 seconds
              setTimeout(() => setPoliceAlertToast(null), 5000);
            }}
            className="px-4 h-16 rounded-xl backdrop-blur-xl flex items-center justify-center gap-2 bg-blue-500/80 text-white border-blue-400/30 shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95"
            aria-label="Test police alert"
          >
            <PoliceAlertIcon className="w-5 h-5" />
            <span className="text-sm font-bold">Test Alert</span>
          </button>
        )}

        {/* Dev Mode Badge */}
        {isDevMode && !route && (
          <div className="px-4 h-16 rounded-xl backdrop-blur-xl flex items-center justify-center bg-purple-500/80 text-white border-purple-400/30 shadow-lg border">
            <span className="text-sm font-bold uppercase tracking-wider">Dev Mode</span>
          </div>
        )}

        {/* Dev Mode - Simulation Controls */}
        {isDevMode && route && (
          <button
            onClick={isSimulating ? stopSimulation : startSimulation}
            className={`
              px-6 h-16 rounded-xl backdrop-blur-xl flex items-center justify-center gap-2
              ${isSimulating 
                ? "bg-red-500/80 text-white border-red-400/30" 
                : "bg-green-500/80 text-white border-green-400/30"
              }
              shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
            `}
            aria-label={isSimulating ? "Stop simulation" : "Start simulation"}
          >
            {isSimulating ? (
              <>
                <StopIcon className="w-6 h-6" />
                <span className="text-lg font-medium">Stop</span>
              </>
            ) : (
              <>
                <PlayIcon className="w-6 h-6" />
                <span className="text-lg font-medium">Simulate</span>
              </>
            )}
          </button>
        )}

        {/* Refocus Button - Only shows when not centered */}
        {showRefocusButton && (
          <button
            onClick={handleRecenter}
            className={`
              px-6 h-16 rounded-xl backdrop-blur-xl flex items-center justify-center gap-2
              bg-blue-500/80 text-white border-blue-400/30
              shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
            `}
            aria-label="Recenter on location"
          >
            <CrosshairIcon className="w-6 h-6" />
            <span className="text-lg font-medium">Recenter</span>
          </button>
        )}

        {/* Zoom Out */}
        <button
          onClick={handleZoomOut}
          className={`
            w-16 h-16 rounded-xl backdrop-blur-xl flex items-center justify-center
            ${getButtonStyles(effectiveDarkMode)}
            shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
          `}
          aria-label="Zoom out"
        >
          <MinusIcon className="w-7 h-7" />
        </button>

        {/* Zoom In */}
        <button
          onClick={handleZoomIn}
          className={`
            w-16 h-16 rounded-xl backdrop-blur-xl flex items-center justify-center
            ${getButtonStyles(effectiveDarkMode)}
            shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
          `}
          aria-label="Zoom in"
        >
          <PlusIcon className="w-7 h-7" />
        </button>

        {/* Dark Mode Toggle - Hidden in satellite mode since satellite always uses dark UI */}
        {!useSatellite && (
          <button
            onClick={toggleDarkMode}
            className={`
              w-16 h-16 rounded-xl backdrop-blur-xl flex items-center justify-center
              ${getButtonStyles(effectiveDarkMode)}
              shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
            `}
            aria-label="Toggle dark mode"
          >
            {isDarkMode ? (
              <SunIcon className="w-7 h-7" />
            ) : (
              <MoonIcon className="w-7 h-7" />
            )}
          </button>
        )}
      </div>



      {/* Police Alert - Full Screen Border Glow Effect */}
      {policeAlertToast?.show && (
        <div className="fixed inset-0 z-50 pointer-events-none overflow-hidden police-alert-container">
          {/* Blue glow layer */}
          <div 
            className="absolute inset-0 police-glow-blue"
            style={{
              background: `
                linear-gradient(to bottom, rgba(59, 130, 246, 0.7), transparent 30%),
                linear-gradient(to top, rgba(59, 130, 246, 0.7), transparent 30%),
                linear-gradient(to right, rgba(59, 130, 246, 0.7), transparent 20%),
                linear-gradient(to left, rgba(59, 130, 246, 0.7), transparent 20%)
              `,
            }}
          />
          
          {/* Red glow layer */}
          <div 
            className="absolute inset-0 police-glow-red"
            style={{
              background: `
                linear-gradient(to bottom, rgba(239, 68, 68, 0.7), transparent 30%),
                linear-gradient(to top, rgba(239, 68, 68, 0.7), transparent 30%),
                linear-gradient(to right, rgba(239, 68, 68, 0.7), transparent 20%),
                linear-gradient(to left, rgba(239, 68, 68, 0.7), transparent 20%)
              `,
            }}
          />
          
          {/* Pull-down notification at top */}
          <div className="absolute top-0 left-0 right-0 flex justify-center police-pulldown">
            <div className="bg-black/90 backdrop-blur-md text-white px-12 py-6 rounded-b-3xl shadow-2xl border-b border-l border-r border-white/20">
              <div className="flex items-center gap-4">
                <PoliceAlertIcon className="w-12 h-12 police-icon" />
                <span className="text-4xl font-bold tracking-wide">POLICE AHEAD</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        isDarkMode={effectiveDarkMode}
        showWazeAlerts={showWazeAlerts}
        onToggleWazeAlerts={setShowWazeAlerts}
        showSpeedCameras={showSpeedCameras}
        onToggleSpeedCameras={setShowSpeedCameras}
        fuelType={fuelType}
        onFuelTypeChange={handleFuelTypeChange}
        showTraffic={showTraffic}
        onToggleTraffic={handleToggleTraffic}
        useSatellite={useSatellite}
        onToggleSatellite={handleToggleSatellite}
        showAvatarPulse={showAvatarPulse}
        onToggleAvatarPulse={setShowAvatarPulse}
        policeAlertDistance={policeAlertDistance}
        onPoliceAlertDistanceChange={handlePoliceAlertDistanceChange}
        policeAlertSound={policeAlertSound}
        onTogglePoliceAlertSound={handleTogglePoliceAlertSound}
        use3DMode={use3DMode}
        onToggle3DMode={handleToggle3DMode}
        units={units}
        onUnitsChange={handleUnitsChange}
        navLanguage={navLanguage}
        onNavLanguageChange={handleNavLanguageChange}
        voiceEnabled={voiceEnabled}
        onToggleVoice={handleToggleVoice}
      />



      {/* Global styles for police alert animations */}
      <style jsx global>{`
        .police-alert-container {
          animation: container-fade 3s ease-out forwards;
        }
        
        @keyframes container-fade {
          0%, 85% {
            opacity: 1;
          }
          100% {
            opacity: 0;
          }
        }
        
        .police-glow-blue {
          animation: flash-blue 0.5s ease-in-out infinite;
        }
        
        .police-glow-red {
          animation: flash-red 0.5s ease-in-out infinite;
        }
        
        @keyframes flash-blue {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0;
          }
        }
        
        @keyframes flash-red {
          0%, 100% {
            opacity: 0;
          }
          50% {
            opacity: 1;
          }
        }
        
        .police-pulldown {
          animation: pulldown-appear 0.4s ease-out, pulldown-glow 0.5s ease-in-out infinite;
        }
        
        @keyframes pulldown-appear {
          from {
            opacity: 0;
            transform: translateY(-100%);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @keyframes pulldown-glow {
          0%, 100% {
            filter: drop-shadow(0 0 30px rgba(59, 130, 246, 0.8));
          }
          50% {
            filter: drop-shadow(0 0 30px rgba(239, 68, 68, 0.8));
          }
        }
        
        .police-icon {
          animation: icon-color 0.5s ease-in-out infinite;
        }
        
        @keyframes icon-color {
          0%, 100% {
            color: rgb(96, 165, 250);
          }
          50% {
            color: rgb(248, 113, 113);
          }
        }
      `}</style>

    </main>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}

function MinusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
    </svg>
  );
}

function CrosshairIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4m0 12v4m10-10h-4M6 12H2" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function CloseNavIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function NavigateToIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/>
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function PoliceAlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z"/>
    </svg>
  );
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 6h12v12H6z"/>
    </svg>
  );
}

function LocationSearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path fillRule="evenodd" d="M11.54 22.351l.07.04.028.016a.76.76 0 00.723 0l.028-.015.071-.041a16.975 16.975 0 001.144-.742 19.58 19.58 0 002.683-2.282c1.944-1.99 3.963-4.98 3.963-8.827a8.25 8.25 0 00-16.5 0c0 3.846 2.02 6.837 3.963 8.827a19.58 19.58 0 002.682 2.282 16.975 16.975 0 001.145.742zM12 13.5a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </svg>
  );
}




function WazeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12c0 1.54.36 3 1 4.31V20l3.13-1.57c1.57.72 3.33 1.07 5.15.95 4.84-.31 8.72-4.19 9.03-9.03.34-5.31-3.87-9.65-9.18-9.35h-.13zm-2 13c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm4 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm2-5H8c0-2.21 1.79-4 4-4s4 1.79 4 4z"/>
    </svg>
  );
}

