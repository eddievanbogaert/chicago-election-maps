import { NextRequest, NextResponse } from "next/server";
import { getMap } from "@/lib/data-source";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const contestId = request.nextUrl.searchParams.get("contestId");
  if (!contestId) {
    return NextResponse.json({ error: "contestId is required" }, { status: 400 });
  }
  const payload = await getMap(contestId);
  if (!payload) {
    return NextResponse.json({ error: "Contest not found" }, { status: 404 });
  }
  return NextResponse.json(payload);
}
