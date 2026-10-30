"use client";

import { formatShortDistance, limitInUnits } from "@/lib/units";
import type { CameraWarning } from "@/hooks/useCameraAlerts";
import type { UnitSystem } from "@/lib/units";
import type { NavLanguage } from "@/lib/navLanguage";
import { uiText } from "@/lib/uiText";

interface CameraWarningBannerProps {
  warning: CameraWarning;
  units: UnitSystem;
  language: NavLanguage;
}

export function CameraWarningBanner({ warning, units, language }: CameraWarningBannerProps) {
  const ui = uiText(language);
  const typeLabels: Record<string, string> = {
    speed_camera: ui.speedCamera,
    red_light_camera: ui.redLightCamera,
    average_speed_camera: ui.averageSpeedCamera,
  };
  return (
    <div
      className="flex items-center gap-4 pl-4 pr-5 py-3 rounded-2xl shadow-2xl border border-red-300/40 bg-red-600/95 text-white"
      role="alert"
    >
      <span className="text-4xl leading-none" aria-hidden>📷</span>
      <div className="flex flex-col">
        <span className="text-3xl font-bold tabular-nums leading-tight">
          {formatShortDistance(warning.distance, units)}
        </span>
        <span className="text-base font-semibold leading-tight">
          {typeLabels[warning.camera.type] ?? ui.camera}
          {warning.camera.ref ? ` · ${warning.camera.ref}` : ""}
        </span>
      </div>
      {warning.limitKmh !== null && (
        <div className="ml-2 flex h-16 w-16 items-center justify-center rounded-full border-[6px] border-red-500 bg-white text-black shadow-lg">
          <span className="text-2xl font-black tabular-nums">{limitInUnits(warning.limitKmh, units)}</span>
        </div>
      )}
    </div>
  );
}
