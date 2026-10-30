import type { FuelType, PlaceCategory } from "@/types/poi";

export const FUEL_TYPES: { code: FuelType; label: string; short: string }[] = [
  { code: "g95", label: "Gasolina 95", short: "95" },
  { code: "g98", label: "Gasolina 98", short: "98" },
  { code: "diesel", label: "Diésel", short: "Diésel" },
  { code: "dieselPremium", label: "Diésel Premium", short: "Diésel+" },
  { code: "lpg", label: "GLP / Autogas", short: "GLP" },
];

export const DEFAULT_FUEL_TYPE: FuelType = "g95";
export const FUEL_TYPE_STORAGE_KEY = "tbn-fuel-type";

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

// Chips under the search box, in display order
export const PLACE_CATEGORIES: { code: PlaceCategory; label: string; icon: string; color: string }[] = [
  { code: "charging", label: "Charging", icon: "⚡", color: "#2563eb" },
  { code: "cafe", label: "Café", icon: "☕", color: "#92400e" },
  { code: "food", label: "Food", icon: "🍴", color: "#ea580c" },
  { code: "fuel", label: "Fuel", icon: "⛽", color: "#16a34a" },
  { code: "parking", label: "Parking", icon: "🅿️", color: "#4f46e5" },
];

export function placeCategoryInfo(code: PlaceCategory) {
  return PLACE_CATEGORIES.find((c) => c.code === code)!;
}

// Typed queries that mean "show me the category" rather than an address (en / es / ru)
const CATEGORY_KEYWORDS: { category: PlaceCategory; teslaOnly?: boolean; words: string[] }[] = [
  { category: "charging", teslaOnly: true, words: ["supercharger", "supercargador", "tesla", "суперчарджер"] },
  { category: "charging", words: ["charger", "charging", "ev", "cargador", "cargadores", "carga", "electrolinera", "зарядка", "зарядки", "зарядная"] },
  { category: "fuel", words: ["fuel", "gas", "petrol", "gas station", "gasolinera", "gasolina", "diesel", "diésel", "азс", "заправка", "бензин"] },
  { category: "cafe", words: ["cafe", "café", "coffee", "cafetería", "cafeteria", "кафе", "кофе"] },
  { category: "food", words: ["food", "restaurant", "restaurante", "comida", "comer", "еда", "ресторан", "поесть"] },
  { category: "parking", words: ["parking", "aparcamiento", "aparcar", "парковка", "паркинг"] },
];

export function detectCategory(query: string): { category: PlaceCategory; teslaOnly: boolean } | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  for (const entry of CATEGORY_KEYWORDS) {
    if (entry.words.some((w) => q === w || q === `${w}s` || (w.length > 4 && q.startsWith(w)))) {
      return { category: entry.category, teslaOnly: entry.teslaOnly ?? false };
    }
  }
  return null;
}

// Words that join a category to a place: "supercharger in Madrid", "gasolinera cerca de Alicante"
const PLACE_CONNECTORS = new Set([
  "in", "near", "around", "at", "by", "close", "to", "nearby",
  "en", "cerca", "de", "del", "por", "alrededor", "junto", "a",
  "в", "около", "возле", "у", "рядом", "с", "под", "по",
]);

// Short or common words that may be part of a street or place name ("Calle Carga"): they only count
// as a category when a connector word separates them from the place
const AMBIGUOUS_KEYWORDS = new Set(["ev", "gas", "carga", "food", "comer", "comida", "еда", "кофе", "fuel"]);

export interface CategoryQuery {
  category: PlaceCategory;
  teslaOnly: boolean;
  place: string | null; // where to look, null = around the map / driver
}

// "supercharger madrid" -> charging (Tesla only) around "madrid". Plain category words give place null.
export function parseCategoryQuery(query: string): CategoryQuery | null {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // One word ("supercharger", "restaurantes"): plain category, prefixes allowed
  if (tokens.length < 2) {
    const plain = detectCategory(query);
    return plain ? { ...plain, place: null } : null;
  }

  let best: { entry: (typeof CATEGORY_KEYWORDS)[number]; start: number; len: number } | null = null;
  for (const entry of CATEGORY_KEYWORDS) {
    for (const word of entry.words) {
      const wordTokens = word.split(" ");
      for (const start of [0, tokens.length - wordTokens.length]) {
        if (start < 0 || wordTokens.some((w, i) => tokens[start + i] !== w && tokens[start + i] !== `${w}s`)) continue;
        if (!best || wordTokens.length > best.len) best = { entry, start, len: wordTokens.length };
      }
    }
  }
  if (!best) return null;

  const rest = [...tokens.slice(0, best.start), ...tokens.slice(best.start + best.len)];
  // Drop connectors at the edge next to the category word: "in madrid", "cerca de alicante"
  const edgeIsLeading = best.start === 0;
  let hadConnector = false;
  while (rest.length > 0 && PLACE_CONNECTORS.has(edgeIsLeading ? rest[0] : rest[rest.length - 1])) {
    hadConnector = true;
    if (edgeIsLeading) rest.shift();
    else rest.pop();
  }
  const keyword = tokens.slice(best.start, best.start + best.len).join(" ");
  const category = { category: best.entry.category, teslaOnly: best.entry.teslaOnly ?? false };
  if (rest.length === 0) return { ...category, place: null }; // multi-word keyword alone: "gas station"
  if (!hadConnector && (AMBIGUOUS_KEYWORDS.has(keyword) || AMBIGUOUS_KEYWORDS.has(keyword.replace(/s$/, "")))) return null;

  return { ...category, place: rest.join(" ") };
}
