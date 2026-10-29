// Languages for turn-by-turn instructions and voice (Mapbox Directions supports all of these)
export const NAV_LANGUAGES = [
  { code: "en", label: "English", speechLang: "en-US" },
  { code: "es", label: "Español", speechLang: "es-ES" },
  { code: "ru", label: "Русский", speechLang: "ru-RU" },
] as const;

export type NavLanguage = (typeof NAV_LANGUAGES)[number]["code"];

export const NAV_LANGUAGE_STORAGE_KEY = "tbn-nav-language";

export function isNavLanguage(value: string | null): value is NavLanguage {
  return NAV_LANGUAGES.some((l) => l.code === value);
}

// Pick the browser language if we support it, otherwise Spanish (the app targets Spain)
export function defaultNavLanguage(): NavLanguage {
  if (typeof navigator !== "undefined") {
    const browser = navigator.language.slice(0, 2);
    if (isNavLanguage(browser)) return browser;
  }
  return "es";
}

export function speechLangFor(language: NavLanguage): string {
  return NAV_LANGUAGES.find((l) => l.code === language)!.speechLang;
}

// Phrases we speak ourselves (Mapbox provides the route announcements)
const PHRASES = {
  en: {
    camera: (distance: string) => `Speed camera in ${distance}`,
    averageSpeed: (distance: string) => `Average speed section in ${distance}`,
    redLight: (distance: string) => `Red light camera in ${distance}`,
    limit: (limit: string) => `, limit ${limit}`,
    police: "Police reported ahead",
    rerouting: "Rerouting",
    ready: "Voice guidance on",
    eventAhead: (label: string, distance: string) => `${label} in ${distance}`,
    events: {
      accident: "Accident", closure: "Road closed", vehicleFire: "Vehicle on fire",
      stoppedVehicle: "Stopped vehicle", obstacle: "Obstacle on the road", rockfall: "Rockfall",
      flooding: "Flooding", badSurface: "Damaged road", lowVisibility: "Low visibility",
      slowTraffic: "Slow traffic", laneClosed: "Lane closed", roadworks: "Roadworks",
    },
  },
  es: {
    camera: (distance: string) => `Radar a ${distance}`,
    averageSpeed: (distance: string) => `Tramo de velocidad media a ${distance}`,
    redLight: (distance: string) => `Cámara de semáforo a ${distance}`,
    limit: (limit: string) => `, límite ${limit}`,
    police: "Policía avisada más adelante",
    rerouting: "Recalculando la ruta",
    ready: "Guía por voz activada",
    eventAhead: (label: string, distance: string) => `${label} a ${distance}`,
    events: {
      accident: "Accidente", closure: "Carretera cortada", vehicleFire: "Vehículo en llamas",
      stoppedVehicle: "Vehículo detenido", obstacle: "Obstáculo en la calzada", rockfall: "Desprendimientos",
      flooding: "Inundación", badSurface: "Firme en mal estado", lowVisibility: "Visibilidad reducida",
      slowTraffic: "Tráfico lento", laneClosed: "Carril cortado", roadworks: "Obras",
    },
  },
  ru: {
    camera: (distance: string) => `Камера через ${distance}`,
    averageSpeed: (distance: string) => `Участок контроля средней скорости через ${distance}`,
    redLight: (distance: string) => `Камера на светофоре через ${distance}`,
    limit: (limit: string) => `, ограничение ${limit}`,
    police: "Впереди отмечена полиция",
    rerouting: "Перестраиваю маршрут",
    ready: "Голосовые подсказки включены",
    eventAhead: (label: string, distance: string) => `${label} через ${distance}`,
    events: {
      accident: "Авария", closure: "Дорога перекрыта", vehicleFire: "Горит машина",
      stoppedVehicle: "Стоящая машина", obstacle: "Препятствие на дороге", rockfall: "Камнепад",
      flooding: "Подтопление", badSurface: "Плохое покрытие", lowVisibility: "Плохая видимость",
      slowTraffic: "Затор", laneClosed: "Полоса перекрыта", roadworks: "Дорожные работы",
    },
  },
} satisfies Record<NavLanguage, unknown>;

export function phrases(language: NavLanguage) {
  return PHRASES[language];
}

// Spoken distance, rounded the way a driver would say it ("500 metros", "1 kilómetro")
export function spokenDistance(meters: number, language: NavLanguage, units: "metric" | "imperial"): string {
  if (units === "imperial") {
    const feet = meters * 3.28084;
    if (feet < 1000) {
      const rounded = Math.round(feet / 100) * 100;
      return { en: `${rounded} feet`, es: `${rounded} pies`, ru: `${rounded} футов` }[language];
    }
    const miles = Math.round((meters / 1609.34) * 10) / 10;
    return { en: `${miles} miles`, es: `${miles} millas`, ru: `${miles} мили` }[language];
  }

  if (meters < 1000) {
    const rounded = Math.max(50, Math.round(meters / 50) * 50);
    return { en: `${rounded} meters`, es: `${rounded} metros`, ru: `${rounded} ${ruPlural(rounded, "метр", "метра", "метров")}` }[language];
  }
  const km = Math.round(meters / 100) / 10;
  const ruKm = Number.isInteger(km) ? ruPlural(km, "километр", "километра", "километров") : "километра";
  return { en: `${km} kilometers`, es: `${km} kilómetros`, ru: `${km} ${ruKm}` }[language];
}

function ruPlural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
