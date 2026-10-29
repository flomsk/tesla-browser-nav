export type UnitSystem = "metric" | "imperial";

export const DEFAULT_UNIT_SYSTEM: UnitSystem = "metric";
export const UNIT_SYSTEM_STORAGE_KEY = "teslanav-units";

const METERS_PER_MILE = 1609.34;
const KMH_PER_MPH = 1.609344;

// Route distances, e.g. "12 km" / "3.4 mi"
export function formatDistance(meters: number, units: UnitSystem): string {
  const value = units === "metric" ? meters / 1000 : meters / METERS_PER_MILE;
  const suffix = units === "metric" ? "km" : "mi";
  return value >= 10 ? `${Math.round(value)} ${suffix}` : `${value.toFixed(1)} ${suffix}`;
}

// Distance to the next maneuver / camera, e.g. "300 m", "1.2 km", "500 ft", "0.8 mi"
export function formatShortDistance(meters: number, units: UnitSystem): string {
  if (units === "metric") {
    if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  }
  const feet = meters * 3.28084;
  if (feet < 1000) return `${Math.max(50, Math.round(feet / 50) * 50)} ft`;
  return `${(meters / METERS_PER_MILE).toFixed(1)} mi`;
}

// Current speed from m/s in the selected units
export function speedInUnits(metersPerSecond: number, units: UnitSystem): number {
  return Math.round(metersPerSecond * (units === "metric" ? 3.6 : 2.236936));
}

// A km/h limit in the selected units (rounded to the nearest 5 for mph)
export function limitInUnits(kmh: number, units: UnitSystem): number {
  return units === "metric" ? kmh : Math.round(kmh / KMH_PER_MPH / 5) * 5;
}

// Parse a camera maxspeed tag ("120", "50 mph") into km/h
export function maxspeedToKmh(maxspeed: string | undefined): number | null {
  const match = maxspeed?.match(/^(\d+)\s*(mph)?$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  return match[2] ? Math.round(value * KMH_PER_MPH) : value;
}

// Speed limits are stored in km/h (Spanish data sources); OSM may also use "50 mph"
export function formatSpeedLimit(maxspeed: string, units: UnitSystem): string {
  const match = maxspeed.match(/^(\d+)\s*(mph)?$/);
  if (!match) return maxspeed;

  const value = parseInt(match[1], 10);
  const kmh = match[2] ? value * KMH_PER_MPH : value;
  return units === "metric" ? `${Math.round(kmh)} km/h` : `${Math.round(kmh / KMH_PER_MPH)} mph`;
}

// Police alert distance presets (values in meters)
export function policeAlertDistanceOptions(units: UnitSystem): { value: number; label: string }[] {
  return units === "metric"
    ? [
        { value: 0, label: "Off" },
        { value: 250, label: "250 m" },
        { value: 500, label: "500 m" },
        { value: 1000, label: "1 km" },
        { value: 2000, label: "2 km" },
      ]
    : [
        { value: 0, label: "Off" },
        { value: 402, label: "¼ mi" },
        { value: 805, label: "½ mi" },
        { value: 1609, label: "1 mi" },
        { value: 3219, label: "2 mi" },
      ];
}

// Map a distance to the closest preset of the given unit system (used when switching units)
export function closestPoliceAlertDistance(meters: number, units: UnitSystem): number {
  if (meters === 0) return 0;
  const options = policeAlertDistanceOptions(units).filter((option) => option.value > 0);
  return options.reduce((best, option) =>
    Math.abs(option.value - meters) < Math.abs(best.value - meters) ? option : best
  ).value;
}
