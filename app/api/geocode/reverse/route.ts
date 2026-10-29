import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { reverseGeocode } from "@/lib/mapboxSearch";
import { NAV_LANGUAGES } from "@/lib/navLanguage";

const querySchema = z.object({
  lng: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  language: z.enum(NAV_LANGUAGES.map((l) => l.code) as [string, ...string[]]).default("en"),
});

// GET /api/geocode/reverse?lng=&lat= : a readable name for a map point
export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing coordinates" }, { status: 400 });
  }
  const { lng, lat, language } = parsed.data;

  try {
    const placeName = (await reverseGeocode(lng, lat, language)) ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    return NextResponse.json({ placeName }, { headers: { "Cache-Control": "public, max-age=86400" } });
  } catch (error) {
    console.error("Reverse geocoding error:", error);
    return NextResponse.json({ error: "Reverse geocoding request failed" }, { status: 502 });
  }
}
