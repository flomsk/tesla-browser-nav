"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import posthog from "posthog-js";
import { PLACE_CATEGORIES, parseCategoryQuery, placeCategoryInfo } from "@/lib/places";
import type { Bounds } from "@/lib/bounds";
import { haversine } from "@/lib/navigation";
import { formatDistance } from "@/lib/units";
import type { UnitSystem } from "@/lib/units";
import type { NavLanguage } from "@/lib/navLanguage";
import { uiText } from "@/lib/uiText";
import type { FuelType, Place, PlaceCategory } from "@/types/poi";

interface NavigateSearchProps {
  isDarkMode?: boolean;
  userLocation: { latitude: number; longitude: number } | null;
  // Route still ahead of the driver while navigating: category searches then look along it
  routeAhead: [number, number][] | null;
  // What the driver sees on the map; searches look there when it is far from the car
  getSearchView?: () => { center: [number, number]; bounds: Bounds } | null;
  language: NavLanguage;
  fuelType: FuelType;
  units: UnitSystem;
  onSelectPlace: (place: Place) => void;
  onResultsChange?: (places: Place[]) => void;
  onOpenChange?: (isOpen: boolean) => void;
}

const SEARCH_DEBOUNCE_MS = 350;
// The map counts as panned away from the car beyond this distance
const MIN_PANNED_SEARCH_METERS = 3000;

// One entry point for everything: type an address or a category ("supercharger", "café"), or tap
// a category chip. Results are shown as a list and as temporary pins on the map.
export function NavigateSearch({
  isDarkMode = false,
  userLocation,
  routeAhead,
  getSearchView,
  language,
  fuelType,
  units,
  onSelectPlace,
  onResultsChange,
  onOpenChange,
}: NavigateSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<PlaceCategory | null>(null);
  const [results, setResults] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const requestIdRef = useRef(0);
  const alongRoute = routeAhead !== null && routeAhead.length >= 2;
  const ui = uiText(language);

  const showResults = useCallback((places: Place[]) => {
    setResults(places);
    onResultsChange?.(places);
  }, [onResultsChange]);

  const close = useCallback(() => {
    requestIdRef.current++; // ignore searches still in flight
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setIsOpen(false);
    setQuery("");
    setActiveCategory(null);
    setSearched(false);
    setLoading(false);
    showResults([]);
  }, [showResults]);

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  // Close on tap outside the panel (taps on result pins on the map count as outside too)
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen, close]);

  const runSearch = useCallback(async (
    request: { category: PlaceCategory; teslaOnly?: boolean; place?: string | null } | { text: string }
  ) => {
    if (!userLocation) return;
    const requestId = ++requestIdRef.current;
    const near: [number, number] = [userLocation.longitude, userLocation.latitude];
    // Map panned far from the car (e.g. looking at Madrid from Alicante): search what is on screen
    const viewed = getSearchView?.() ?? null;
    const panned =
      viewed && haversine(near[1], near[0], viewed.center[1], viewed.center[0]) > MIN_PANNED_SEARCH_METERS
        ? viewed
        : null;
    // Along the route the road decides where to look; the view only narrows it to the stretch on screen
    let center = alongRoute ? undefined : panned?.center;
    let view = panned?.bounds;
    setLoading(true);
    try {
      let response: Response;
      let lookAlongRoute = alongRoute;
      if ("category" in request && request.place) {
        // "supercharger madrid": find the place first, then search around it instead of along the route
        const geo = await fetch(
          `/api/geocode?${new URLSearchParams({
            q: request.place,
            lng: String((center ?? panned?.center ?? near)[0]),
            lat: String((center ?? panned?.center ?? near)[1]),
            language,
          })}`
        );
        const found: Place | undefined = geo.ok ? (await geo.json()).places?.[0] : undefined;
        if (requestId !== requestIdRef.current) return;
        if (found) {
          center = [found.lon, found.lat];
          view = undefined; // the named place decides where to look, not what is on screen
          lookAlongRoute = false;
        } else {
          showResults([]);
          setSearched(true);
          return;
        }
      }
      if ("category" in request) {
        response = await fetch("/api/places", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: request.category,
            teslaOnly: request.teslaOnly ?? false,
            near,
            center,
            view,
            route: lookAlongRoute ? routeAhead : undefined,
            fuelType,
            language,
          }),
        });
      } else {
        const params = new URLSearchParams({
          q: request.text,
          lng: String((center ?? panned?.center ?? near)[0]),
          lat: String((center ?? panned?.center ?? near)[1]),
          language,
        });
        response = await fetch(`/api/geocode?${params}`);
      }
      const data = await response.json();
      if (requestId !== requestIdRef.current) return; // a newer search started meanwhile
      showResults(response.ok ? data.places ?? [] : []);
      setSearched(true);
    } catch {
      if (requestId === requestIdRef.current) {
        showResults([]);
        setSearched(true);
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [userLocation, alongRoute, routeAhead, fuelType, language, showResults, getSearchView]);

  const handleCategory = (category: PlaceCategory) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setQuery("");
    setActiveCategory(category);
    posthog.capture("place_category_searched", { category, along_route: alongRoute });
    runSearch({ category });
  };

  const handleInputChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const text = value.trim();
    if (text.length < 2) {
      requestIdRef.current++;
      setActiveCategory(null);
      setSearched(false);
      setLoading(false);
      showResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      const category = parseCategoryQuery(text);
      setActiveCategory(category?.category ?? null);
      runSearch(category ?? { text });
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleSelect = (place: Place) => {
    posthog.capture("destination_selected", { category: place.category, along_route: alongRoute });
    onSelectPlace(place);
    close();
  };

  const panelStyles = isDarkMode
    ? "bg-[#1a1a1a]/95 text-white border-white/10"
    : "bg-white/95 text-black border-black/10";
  const divider = isDarkMode ? "border-white/10" : "border-black/10";
  const subtext = isDarkMode ? "text-gray-400" : "text-gray-500";
  const chipIdle = isDarkMode ? "bg-white/10 text-white" : "bg-black/5 text-black";

  if (!isOpen) {
    return (
      <button
        onClick={() => {
          setIsOpen(true);
          posthog.capture("navigate_search_opened", { along_route: alongRoute });
        }}
        className={`
          flex items-center gap-3 px-5 h-14 rounded-xl backdrop-blur-xl shadow-lg border
          ${panelStyles} transition-transform active:scale-[0.98]
        `}
      >
        <SearchIcon className="w-6 h-6 opacity-70" />
        <span className="text-lg font-medium">{alongRoute ? ui.alongTheRoute : ui.whereTo}</span>
      </button>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`flex flex-col min-h-0 w-[440px] max-w-[calc(100vw-2rem)] rounded-2xl backdrop-blur-xl shadow-xl border overflow-hidden ${panelStyles}`}
    >
      {/* Input */}
      <div className="flex flex-shrink-0 items-center gap-3 px-5 h-16">
        <SearchIcon className={`w-6 h-6 flex-shrink-0 ${isDarkMode ? "text-blue-400" : "text-blue-500"}`} />
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) handleSelect(results[0]);
            if (e.key === "Escape") close();
          }}
          placeholder={alongRoute ? ui.searchAlongPlaceholder : ui.searchPlaceholder}
          className={`flex-1 min-w-0 bg-transparent text-lg font-medium outline-none ${isDarkMode ? "placeholder:text-gray-500" : "placeholder:text-gray-400"}`}
        />
        {loading && <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin opacity-50" />}
        <button onClick={close} className="p-2 -mr-2 opacity-60" aria-label={ui.closeSearch}>
          <CloseIcon className="w-6 h-6" />
        </button>
      </div>

      {/* Category chips */}
      <div className="flex flex-shrink-0 gap-2 px-4 pb-4 overflow-x-auto">
        {PLACE_CATEGORIES.map((c) => (
          <button
            key={c.code}
            onClick={() => handleCategory(c.code)}
            className={`
              flex items-center gap-1.5 h-12 px-4 rounded-full text-base font-semibold whitespace-nowrap transition-colors
              ${activeCategory === c.code ? "bg-blue-500 text-white" : chipIdle}
            `}
          >
            <span aria-hidden>{c.icon}</span>
            {ui.categories[c.code]}
          </button>
        ))}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className={`min-h-0 overflow-y-auto border-t ${divider}`}>
          {results.map((place) => (
            <PlaceRow
              key={place.id}
              place={place}
              units={units}
              isDarkMode={isDarkMode}
              onSelect={() => handleSelect(place)}
            />
          ))}
        </div>
      )}

      {searched && !loading && results.length === 0 && (
        <div className={`px-5 py-4 text-base border-t ${subtext} ${divider}`}>
          {alongRoute && activeCategory ? ui.nothingFoundAlong : ui.nothingFound}
        </div>
      )}
    </div>
  );
}

function PlaceRow({
  place, units, isDarkMode, onSelect,
}: {
  place: Place;
  units: UnitSystem;
  isDarkMode: boolean;
  onSelect: () => void;
}) {
  const icon = place.category === "address" ? "📍" : place.isTesla ? "T" : placeCategoryInfo(place.category).icon;
  const subtext = isDarkMode ? "text-gray-400" : "text-gray-500";

  return (
    <button
      onClick={onSelect}
      className={`
        w-full min-h-16 px-5 py-3 flex items-center gap-4 text-left
        border-b last:border-b-0 ${isDarkMode ? "border-white/5 active:bg-white/10" : "border-black/5 active:bg-black/5"}
      `}
    >
      <span
        className={`w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center text-lg font-bold ${place.isTesla ? "bg-[#e31937] text-white" : isDarkMode ? "bg-white/10" : "bg-black/5"}`}
        aria-hidden
      >
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-base font-semibold truncate">{place.name}</span>
        {place.address && <span className={`block text-sm truncate ${subtext}`}>{place.address}</span>}
      </span>
      <span className="flex flex-col items-end flex-shrink-0">
        {place.badge && <span className="text-base font-bold tabular-nums">{place.badge}</span>}
        {place.distance !== null && (
          <span className={`text-sm tabular-nums ${subtext}`}>
            {formatDistance(place.distance, units)}{place.detour !== null ? " ahead" : ""}
          </span>
        )}
      </span>
    </button>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
      <circle cx="11" cy="11" r="7" />
      <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
