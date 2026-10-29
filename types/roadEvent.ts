// What happened, simplified from DGT's DATEX II causes into what a driver needs to hear
export type RoadEventKind =
  | "accident"
  | "closure" // road or carriageway closed
  | "vehicleFire"
  | "stoppedVehicle"
  | "obstacle" // object, spillage on the road
  | "rockfall"
  | "flooding"
  | "badSurface"
  | "lowVisibility" // fog, smoke
  | "slowTraffic"
  | "laneClosed"
  | "roadworks";

// Compass direction of the affected carriageway (TPEG), "unknown" when DGT doesn't say
export type TravelDirection =
  | "northBound" | "northEastBound" | "eastBound" | "southEastBound"
  | "southBound" | "southWestBound" | "westBound" | "northWestBound" | "unknown";

export interface RoadEvent {
  id: string;
  kind: RoadEventKind;
  severity: "low" | "medium" | "high" | "highest" | null;
  road: string | null; // "A-6"
  km: number | null; // kilometre point where it starts
  direction: TravelDirection;
  // Start of the affected stretch, and its end for stretches (null for single points)
  start: { lat: number; lon: number };
  end: { lat: number; lon: number } | null;
  startTime: string | null;
  endTime: string | null;
}

export interface RoadEventsResponse {
  events: RoadEvent[];
  updatedAt: string | null;
}
