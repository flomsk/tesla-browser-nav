import { NextRequest, NextResponse } from "next/server";
import { boundsSchema, boundsSpanDegrees } from "@/lib/bounds";
import { isChargingDataConfigured, listChargingStations } from "@/lib/chargingStations";

const MAX_SPAN_DEGREES = 1;

export async function GET(request: NextRequest) {
  const parsed = boundsSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing or invalid bounds parameters" }, { status: 400 });
  }
  if (boundsSpanDegrees(parsed.data) > MAX_SPAN_DEGREES) {
    return NextResponse.json({ error: "Area too large, zoom in" }, { status: 400 });
  }
  if (!isChargingDataConfigured()) {
    return NextResponse.json({ error: "Charging stations not configured" }, { status: 503 });
  }

  try {
    return NextResponse.json({ stations: await listChargingStations(parsed.data) });
  } catch (error) {
    console.error("Charging stations error:", error);
    return NextResponse.json({ error: "Charging stations unavailable" }, { status: 502 });
  }
}
