import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toAlert, voteReport } from "@/lib/policeReports";

const voteSchema = z.object({
  vote: z.enum(["up", "down"]),
  deviceId: z.string().min(8).max(64),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const parsed = voteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid vote" }, { status: 400 });
  }

  const { report, status } = await voteReport(id, parsed.data.vote, parsed.data.deviceId);

  if (status === "not_found") {
    return NextResponse.json({ error: "Report not found or expired" }, { status: 404 });
  }

  return NextResponse.json({
    status,
    // null when the report was removed by this vote
    alert: report ? toAlert(report) : null,
  });
}
