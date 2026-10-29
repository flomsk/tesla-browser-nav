import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { forwardSearch } from "@/lib/mapboxSearch";
import { haversine } from "@/lib/navigation";
import { NAV_LANGUAGES } from "@/lib/navLanguage";
import type { Place } from "@/types/poi";

const querySchema = z.object({
  q: z.string().trim().min(2).max(200),
  lng: z.coerce.number().min(-180).max(180).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  language: z.enum(NAV_LANGUAGES.map((l) => l.code) as [string, ...string[]]).default("en"),
});

// GET /api/geocode?q=...&lng=&lat=&language= : addresses and named places, nearest first
export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing or invalid search query" }, { status: 400 });
  }
  const { q, lng, lat, language } = parsed.data;
  const near: [number, number] | null = lng !== undefined && lat !== undefined ? [lng, lat] : null;

  try {
    const features = await forwardSearch(q, near, language);
    const places: Place[] = features.map((f) => ({
      id: f.id,
      category: "address",
      name: f.name,
      address: f.address,
      lat: f.lat,
      lon: f.lon,
      distance: near ? haversine(near[1], near[0], f.lat, f.lon) : null,
      detour: null,
      badge: null,
      price: null,
      isTesla: /tesla/i.test(f.name),
    }));
    return NextResponse.json({ places });
  } catch (error) {
    console.error("Geocoding error:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 502 });
  }
}
