import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export async function GET() {
  try {
    const filePath = join(process.cwd(), "data", "rate_expectations.json");
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    // Return the most recent snapshot (first item)
    const latest = Array.isArray(data) ? data[0] : data;
    return NextResponse.json(latest);
  } catch {
    return NextResponse.json({ error: "rate_expectations.json not found. Run the scraper first." }, { status: 404 });
  }
}
