// Fuel types published by the Spanish Ministry for the Ecological Transition (Geoportal Gasolineras)
export type FuelType = "g95" | "g98" | "diesel" | "dieselPremium" | "lpg";

export interface FuelStation {
  id: string;
  brand: string;
  lat: number;
  lon: number;
  address: string;
  town: string;
  hours: string;
  prices: Partial<Record<FuelType, number>>; // EUR per litre
}

export interface FuelStationsResponse {
  stations: FuelStation[];
  updatedAt: string | null; // as published by the ministry, Europe/Madrid time
}

export interface ChargerConnector {
  type: string;
  powerKw: number | null;
  quantity: number;
}

export interface ChargingStation {
  id: string;
  name: string;
  operator: string | null;
  lat: number;
  lon: number;
  address: string;
  maxPowerKw: number | null;
  points: number | null;
  connectors: ChargerConnector[];
  isTesla: boolean;
  isOperational: boolean | null;
  usage: string | null;
}

export interface ChargingStationsResponse {
  stations: ChargingStation[];
}
