"use client";

import { maneuverArrow } from "@/lib/navigation";
import { formatDistance, formatShortDistance } from "@/lib/units";
import type { RouteProgress } from "@/lib/navigation";
import type { UnitSystem } from "@/lib/units";

interface ManeuverBannerProps {
  progress: RouteProgress;
  units: UnitSystem;
  isDarkMode: boolean;
}

function formatArrivalTime(secondsFromNow: number): string {
  const arrival = new Date(Date.now() + secondsFromNow * 1000);
  return arrival.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Large, glanceable next-maneuver card for the car screen
export function ManeuverBanner({ progress, units, isDarkMode }: ManeuverBannerProps) {
  const step = progress.nextStep;
  if (!step) return null;

  return (
    <div
      className={`
        flex flex-col rounded-2xl shadow-2xl border overflow-hidden w-[440px] max-w-[calc(100vw-2rem)]
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
      <div className="flex justify-between px-5 py-2 bg-black/25 text-base font-semibold tabular-nums">
        <span>{formatDistance(progress.remainingDistance, units)}</span>
        <span>ETA {formatArrivalTime(progress.remainingDuration)}</span>
      </div>
    </div>
  );
}
