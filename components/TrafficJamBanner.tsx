"use client";

import { phrases } from "@/lib/navLanguage";
import { formatShortDistance } from "@/lib/units";
import type { JamWarning } from "@/lib/traffic";
import type { NavLanguage } from "@/lib/navLanguage";
import type { UnitSystem } from "@/lib/units";
import { uiText } from "@/lib/uiText";

interface TrafficJamBannerProps {
  warning: JamWarning;
  units: UnitSystem;
  language: NavLanguage;
}

export function TrafficJamBanner({ warning, units, language }: TrafficJamBannerProps) {
  const { jam } = warning;
  const minutes = Math.max(1, Math.round(jam.delaySeconds / 60));

  return (
    <div
      className={`
        flex items-center gap-4 pl-4 pr-5 py-3 rounded-2xl shadow-2xl border text-white
        ${jam.severe ? "bg-red-800/95 border-red-300/40" : "bg-red-600/95 border-red-300/40"}
      `}
      role="alert"
    >
      <span className="text-4xl leading-none" aria-hidden>🚗</span>
      <div className="flex flex-col">
        <span className="text-3xl font-bold tabular-nums leading-tight">
          {formatShortDistance(warning.distance, units)}
        </span>
        <span className="text-base font-semibold leading-tight tabular-nums">
          {phrases(language).jamLabel} · {formatShortDistance(jam.endAlong - jam.startAlong, units)} · +{minutes} {uiText(language).min}
        </span>
      </div>
    </div>
  );
}
