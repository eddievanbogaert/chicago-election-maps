import { NextResponse } from "next/server";
import { listElections } from "@/lib/data-source";

export const dynamic = "force-dynamic";

export async function GET() {
  const elections = await listElections();
  return NextResponse.json({ elections });
}
