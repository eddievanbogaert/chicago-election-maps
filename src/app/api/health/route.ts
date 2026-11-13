import { NextResponse } from "next/server";
import { hasBigQueryCredentials } from "@/lib/bigquery";
import { activeBackend } from "@/lib/data-source";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    backend: activeBackend(),
    bigQueryConfigured: hasBigQueryCredentials(),
  });
}
