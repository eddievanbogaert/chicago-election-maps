import { NextRequest, NextResponse } from "next/server";
import { listContests } from "@/lib/data-source";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const electionId = searchParams.get("electionId");
  const mode = searchParams.get("mode");
  const wardParam = searchParams.get("ward");

  if (!electionId || (mode !== "mayor" && mode !== "council")) {
    return NextResponse.json(
      { error: "electionId and mode=mayor|council are required" },
      { status: 400 },
    );
  }

  const ward = wardParam ? Number(wardParam) : null;
  const contests = await listContests(electionId, mode, ward);
  return NextResponse.json({ contests });
}
