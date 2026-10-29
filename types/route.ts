export interface VoiceInstruction {
  distanceAlongGeometry: number; // meters before the end of the step at which to speak
  announcement: string;
}

export interface RouteStep {
  instruction: string;
  distance: number;
  duration: number;
  name: string;
  maneuver: {
    type: string;
    modifier?: string;
    bearing_after?: number;
    location: [number, number]; // [lng, lat]
  };
  voiceInstructions: VoiceInstruction[];
}

export interface RouteData {
  id: string;
  geometry: {
    coordinates: [number, number][];
    type: string;
  };
  distance: number; // meters
  duration: number; // seconds
  steps: RouteStep[];
  summary: string; // e.g., "via A-2"
  // Speed limit in km/h for each geometry segment (coordinates[i] -> coordinates[i + 1]), null if unknown
  maxspeeds: (number | null)[];
}

export interface RoutesResponse {
  routes: RouteData[];
  selectedIndex: number;
}
