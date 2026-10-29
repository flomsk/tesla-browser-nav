import { NextRequest, NextResponse } from "next/server";
import { boundsSchema, boundsSpanDegrees } from "@/lib/bounds";
import { listFuelStations } from "@/lib/fuelPrices";

// Roughly 100 km across: larger areas would return thousands of stations
const MAX_SPAN_DEGREES = 1;

export async function GET(request: NextRequest) {
  const parsed = boundsSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing or invalid bounds parameters" }, { status: 400 });
  }
  if (boundsSpanDegrees(parsed.data) > MAX_SPAN_DEGREES) {
    return NextResponse.json({ error: "Area too large, zoom in" }, { status: 400 });
  }

  try {
    return NextResponse.json(await listFuelStations(parsed.data));
  } catch (error) {
    console.error("Fuel prices error:", error);
    return NextResponse.json({ error: "Fuel prices unavailable" }, { status: 502 });
  }
}
