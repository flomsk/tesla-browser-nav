"use client";

import { formatShortDistance, limitInUnits } from "@/lib/units";
import type { CameraWarning } from "@/hooks/useCameraAlerts";
import type { UnitSystem } from "@/lib/units";

interface CameraWarningBannerProps {
  warning: CameraWarning;
  units: UnitSystem;
}

const TYPE_LABELS: Record<string, string> = {
  speed_camera: "Speed camera",
  red_light_camera: "Red light camera",
  average_speed_camera: "Average speed section",
};

export function CameraWarningBanner({ warning, units }: CameraWarningBannerProps) {
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
          {TYPE_LABELS[warning.camera.type] ?? "Camera"}
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
