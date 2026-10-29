export type SpeedCameraType = "speed_camera" | "red_light_camera" | "average_speed_camera";

// dgt = Dirección General de Tráfico, sct = Servei Català de Trànsit, osm = OpenStreetMap
export type SpeedCameraSource = "dgt" | "sct" | "osm";

export interface SpeedCamera {
  id: string;
  type: SpeedCameraType;
  location: {
    lat: number;
    lon: number;
  };
  maxspeed?: string; // km/h, e.g. "120"
  direction?: string; // e.g., "forward", "backward", "both" or a bearing in degrees
  name?: string;
  ref?: string; // road reference, e.g. "A-2"
  source: SpeedCameraSource;
}

// Shape of public/data/cameras-es.json (see scripts/build-cameras-es.mjs)
export interface SpeedCameraDataset {
  generatedAt: string;
  counts: Record<string, number>;
  cameras: SpeedCamera[];
}
