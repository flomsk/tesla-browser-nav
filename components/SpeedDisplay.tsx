"use client";

import { limitInUnits, speedInUnits } from "@/lib/units";
import type { UnitSystem } from "@/lib/units";

interface SpeedDisplayProps {
  speedMetersPerSecond: number | null;
  speedLimitKmh: number | null;
  units: UnitSystem;
  isDarkMode: boolean;
}

// Tolerance before flagging as speeding (GPS speed is a little noisy)
const SPEEDING_TOLERANCE_KMH = 3;

export function SpeedDisplay({ speedMetersPerSecond, speedLimitKmh, units, isDarkMode }: SpeedDisplayProps) {
  const currentSpeed = speedMetersPerSecond === null ? null : Math.max(0, speedInUnits(speedMetersPerSecond, units));
  const isSpeeding =
    speedMetersPerSecond !== null &&
    speedLimitKmh !== null &&
    speedMetersPerSecond * 3.6 > speedLimitKmh + SPEEDING_TOLERANCE_KMH;

  return (
    <div className="flex items-end gap-2" aria-label="Driving speed">
      <div
        className={`
          flex h-[96px] w-[96px] flex-col items-center justify-center rounded-2xl border backdrop-blur-xl shadow-lg transition-colors
          ${isSpeeding
            ? "border-red-400/50 bg-red-600/90 text-white"
            : isDarkMode
              ? "border-white/10 bg-[#1a1a1a]/80 text-white"
              : "border-black/10 bg-white/80 text-black"}
        `}
      >
        <span className="text-5xl font-bold tabular-nums leading-none">{currentSpeed ?? "—"}</span>
        <span className={`mt-1 text-xs font-semibold uppercase tracking-wider ${isSpeeding ? "text-white/80" : isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
          {units === "metric" ? "km/h" : "mph"}
        </span>
      </div>

      {speedLimitKmh !== null && (
        <div
          className="flex h-[80px] w-[80px] items-center justify-center rounded-full border-[7px] border-red-500 bg-white text-black shadow-lg"
          aria-label={`Speed limit ${limitInUnits(speedLimitKmh, units)}`}
        >
          <span className="text-3xl font-black tabular-nums leading-none">{limitInUnits(speedLimitKmh, units)}</span>
        </div>
      )}
    </div>
  );
}
