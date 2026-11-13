import { NextRequest, NextResponse } from "next/server";
import { getDemographics } from "@/lib/data-source";
import type { DemographicMetric } from "@/lib/types";

export const dynamic = "force-dynamic";

const METRICS = new Set<DemographicMetric>([
  "medianIncome",
  "medianAge",
  "pctBachelorPlus",
  "pctHispanic",
  "pctBlack",
  "pctWhite",
  "pctAsian",
  "totalPop",
]);

export async function GET(request: NextRequest) {
  const metric = (request.nextUrl.searchParams.get("metric") ||
    "medianIncome") as DemographicMetric;
  if (!METRICS.has(metric)) {
    return NextResponse.json({ error: "Invalid metric" }, { status: 400 });
  }
  const payload = await getDemographics(metric);
  return NextResponse.json(payload);
}
