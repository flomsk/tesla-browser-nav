import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { boundsSchema } from "@/lib/bounds";
import { createReport, listReports, toAlert } from "@/lib/policeReports";

// Simple in-memory rate limiting per IP for new reports
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX = 6; // Max 6 reports per 10 minutes per IP

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }

  record.count++;
  return true;
}

export async function GET(request: NextRequest) {
  const parsed = boundsSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing or invalid bounds parameters" }, { status: 400 });
  }

  const { left, right, bottom, top } = parsed.data;
  const reports = await listReports({ west: left, east: right, south: bottom, north: top });

  return NextResponse.json(
    { alerts: reports.map(toAlert) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const reportSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  deviceId: z.string().min(8).max(64),
});

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Too many reports. Please try again later." }, { status: 429 });
  }

  const parsed = reportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid report" }, { status: 400 });
  }

  const { lat, lon, deviceId } = parsed.data;
  const { report, merged } = await createReport(lat, lon, deviceId);

  return NextResponse.json({ alert: toAlert(report), merged }, { status: merged ? 200 : 201 });
}
