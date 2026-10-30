"use client";

import { maneuverArrow } from "@/lib/navigation";
import { formatDistance, formatShortDistance } from "@/lib/units";
import type { RouteProgress } from "@/lib/navigation";
import type { UnitSystem } from "@/lib/units";
import type { NavLanguage } from "@/lib/navLanguage";
import { uiText } from "@/lib/uiText";

interface ManeuverBannerProps {
  progress: RouteProgress;
  destinationName: string;
  onEnd: () => void;
  units: UnitSystem;
  isDarkMode: boolean;
  language: NavLanguage;
}

function formatArrivalTime(secondsFromNow: number): string {
  const arrival = new Date(Date.now() + secondsFromNow * 1000);
  return arrival.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Large, glanceable next-maneuver card for the car screen. Also the only trip card while
// navigating: remaining distance, ETA, destination and the button to end the route.
export function ManeuverBanner({ progress, destinationName, onEnd, units, isDarkMode, language }: ManeuverBannerProps) {
  const ui = uiText(language);
  const step = progress.nextStep;
  if (!step) return null;

  return (
    <div
      className={`
        flex flex-shrink-0 flex-col rounded-2xl shadow-2xl border overflow-hidden w-[440px] max-w-[calc(100vw-2rem)]
        ${isDarkMode ? "bg-[#0f5132]/95 border-white/10" : "bg-[#146c43]/95 border-black/10"} text-white
      `}
      aria-live="polite"
    >
      <div className="flex items-center gap-4 px-5 py-4">
        <span className="text-6xl leading-none w-16 text-center" aria-hidden>
          {maneuverArrow(step)}
        </span>
        <div className="flex flex-col min-w-0">
          <span className="text-4xl font-bold tabular-nums leading-tight">
            {formatShortDistance(progress.distanceToManeuver, units)}
          </span>
          <span className="text-xl font-medium leading-snug line-clamp-2">
            {step.instruction}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 pl-5 pr-2 py-1.5 bg-black/25 text-base font-semibold tabular-nums">
        <span>{formatDistance(progress.remainingDistance, units)}</span>
        <span>{ui.eta} {formatArrivalTime(progress.remainingDuration)}</span>
        <span className="flex-1 min-w-0 truncate text-sm font-medium text-white/75">{destinationName}</span>
        <button
          onClick={onEnd}
          className="h-11 px-4 rounded-lg bg-white/15 text-sm font-bold active:bg-white/30"
          aria-label={ui.endRoute}
        >
          {ui.end}
        </button>
      </div>
    </div>
  );
}
