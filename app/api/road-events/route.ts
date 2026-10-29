import { NextResponse } from "next/server";
import { listRoadEvents } from "@/lib/roadEvents";

// GET /api/road-events : every active DGT incident in Spain (~1k, small enough to send whole;
// the client decides which ones are on its route)
export async function GET() {
  try {
    return NextResponse.json(await listRoadEvents(), {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  } catch (error) {
    console.error("Road events error:", error);
    return NextResponse.json({ error: "Road events unavailable" }, { status: 502 });
  }
}
