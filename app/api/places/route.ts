import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { searchPlaces } from "@/lib/placeSearch";
import { FUEL_TYPES } from "@/lib/places";
import { NAV_LANGUAGES } from "@/lib/navLanguage";

const lngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

const querySchema = z.object({
  category: z.enum(["charging", "fuel", "cafe", "food", "parking"]),
  near: lngLat,
  center: lngLat.optional(),
  route: z.array(lngLat).min(2).max(150).optional(),
  teslaOnly: z.boolean().optional(),
  fuelType: z.enum(FUEL_TYPES.map((f) => f.code) as [string, ...string[]]).default("g95"),
  language: z.enum(NAV_LANGUAGES.map((l) => l.code) as [string, ...string[]]).default("en"),
});

// POST because the along-route variant carries the route ahead of the driver
export async function POST(request: NextRequest) {
  const parsed = querySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid search request" }, { status: 400 });
  }

  try {
    const places = await searchPlaces({
      ...parsed.data,
      fuelType: parsed.data.fuelType as (typeof FUEL_TYPES)[number]["code"],
    });
    return NextResponse.json({ places });
  } catch (error) {
    console.error("Place search error:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 502 });
  }
}
