import type { FuelType } from "@/types/poi";

export const FUEL_TYPES: { code: FuelType; label: string; short: string }[] = [
  { code: "g95", label: "Gasolina 95", short: "95" },
  { code: "g98", label: "Gasolina 98", short: "98" },
  { code: "diesel", label: "Diésel", short: "Diésel" },
  { code: "dieselPremium", label: "Diésel Premium", short: "Diésel+" },
  { code: "lpg", label: "GLP / Autogas", short: "GLP" },
];

export const DEFAULT_FUEL_TYPE: FuelType = "g95";
export const FUEL_TYPE_STORAGE_KEY = "tbn-fuel-type";
export const SHOW_FUEL_STORAGE_KEY = "tbn-show-fuel";
export const SHOW_CHARGERS_STORAGE_KEY = "tbn-show-chargers";

export function isFuelType(value: unknown): value is FuelType {
  return FUEL_TYPES.some((f) => f.code === value);
}

export function fuelLabel(type: FuelType): string {
  return FUEL_TYPES.find((f) => f.code === type)?.label ?? type;
}

// Fast chargers (DC) start around 50 kW
export const FAST_CHARGER_KW = 50;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
