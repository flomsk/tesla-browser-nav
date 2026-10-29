"use client";

import { formatDistance } from "@/lib/units";
import type { FasterRouteOffer } from "@/hooks/useFasterRoute";
import type { UnitSystem } from "@/lib/units";

interface FasterRouteCardProps {
  offer: FasterRouteOffer;
  units: UnitSystem;
  onAccept: () => void;
  onDismiss: () => void;
}

// Waze-style "faster route" prompt: one big button to take it; ignoring it keeps the current route
export function FasterRouteCard({ offer, units, onAccept, onDismiss }: FasterRouteCardProps) {
  const minutes = Math.round(offer.savingSeconds / 60);

  return (
    <div className="flex flex-shrink-0 flex-col gap-3 w-[440px] max-w-[calc(100vw-2rem)] p-4 rounded-2xl shadow-2xl border border-blue-300/30 bg-blue-600/95 text-white">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-2xl font-bold">Faster route · −{minutes} min</span>
        <span className="text-sm text-white/80 truncate">
          {offer.route.summary} · {formatDistance(offer.route.distance, units)}
        </span>
      </div>
      <div className="flex gap-3">
        <button onClick={onAccept} className="flex-1 h-14 rounded-xl bg-white text-blue-700 text-lg font-bold active:scale-[0.98]">
          Take it
        </button>
        <button onClick={onDismiss} className="h-14 px-6 rounded-xl bg-white/15 text-lg font-semibold active:bg-white/25">
          Keep
        </button>
      </div>
    </div>
  );
}
