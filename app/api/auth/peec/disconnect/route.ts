import { NextResponse } from "next/server";

import { clearToken } from "@/lib/oauth/peec";

export const dynamic = "force-dynamic";

export async function POST() {
  const removed = clearToken();
  return NextResponse.json({ removed });
}
