import { NextResponse } from "next/server";

import { loadToken } from "@/lib/oauth/peec";

export const dynamic = "force-dynamic";

export async function GET() {
  const token = loadToken();
  if (!token) {
    return NextResponse.json({ connected: false });
  }
  const expired =
    token.expires_at !== undefined && Date.now() > token.expires_at;
  return NextResponse.json({
    connected: !expired,
    expires_at: token.expires_at ?? null,
    obtained_at: token.obtained_at,
    scope: token.scope ?? null,
    has_refresh: !!token.refresh_token,
  });
}
