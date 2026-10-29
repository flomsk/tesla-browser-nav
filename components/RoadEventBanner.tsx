"use client";

import { phrases } from "@/lib/navLanguage";
import { formatShortDistance } from "@/lib/units";
import type { RoadEventWarning } from "@/lib/roadEventAlerts";
import type { NavLanguage } from "@/lib/navLanguage";
import type { UnitSystem } from "@/lib/units";
import type { RoadEventKind } from "@/types/roadEvent";

interface RoadEventBannerProps {
  warning: RoadEventWarning;
  units: UnitSystem;
  language: NavLanguage;
}

const ICONS: Record<RoadEventKind, string> = {
  accident: "💥", closure: "⛔", vehicleFire: "🔥", stoppedVehicle: "🚗", obstacle: "⚠️",
  rockfall: "🪨", flooding: "🌊", badSurface: "⚠️", lowVisibility: "🌫️", slowTraffic: "🐢",
  laneClosed: "🚧", roadworks: "🚧",
};

// Red for things that stop or endanger you, amber for slowdowns and works
const SEVERE = new Set<RoadEventKind>(["closure", "accident", "vehicleFire", "obstacle", "rockfall", "flooding"]);

export function RoadEventBanner({ warning, units, language }: RoadEventBannerProps) {
  const { event } = warning;
  const where = [event.road, event.km !== null ? `km ${event.km}` : null].filter(Boolean).join(" · ");

  return (
    <div
      className={`
        flex items-center gap-4 pl-4 pr-5 py-3 rounded-2xl shadow-2xl border text-white
        ${SEVERE.has(event.kind) ? "bg-red-600/95 border-red-300/40" : "bg-amber-500/95 border-amber-200/40"}
      `}
      role="alert"
    >
      <span className="text-4xl leading-none" aria-hidden>{ICONS[event.kind]}</span>
      <div className="flex flex-col">
        <span className="text-3xl font-bold tabular-nums leading-tight">
          {formatShortDistance(warning.distance, units)}
        </span>
        <span className="text-base font-semibold leading-tight">
          {phrases(language).events[event.kind]}
          {where ? ` · ${where}` : ""}
        </span>
      </div>
    </div>
  );
}
