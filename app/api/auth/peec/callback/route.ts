import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { exchangeCode, loadClient, saveToken } from "@/lib/oauth/peec";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (error) {
    return new NextResponse(
      `Peec OAuth failed: ${error}${errorDescription ? ` — ${errorDescription}` : ""}`,
      { status: 400 },
    );
  }
  if (!code || !state) {
    return new NextResponse("Missing code or state from Peec callback", {
      status: 400,
    });
  }

  const cookieStore = await cookies();
  const cookie = cookieStore.get(`peec_pkce_${state}`);
  if (!cookie) {
    return new NextResponse(
      "Missing PKCE verifier cookie. Restart the auth flow.",
      { status: 400 },
    );
  }

  const client = loadClient();
  if (!client) {
    return new NextResponse(
      "No registered Peec client. Restart the auth flow.",
      { status: 400 },
    );
  }

  const redirectUri = `${url.origin}/api/auth/peec/callback`;
  const token = await exchangeCode({
    client_id: client.client_id,
    code,
    code_verifier: cookie.value,
    redirect_uri: redirectUri,
  });
  saveToken(token);

  cookieStore.delete(`peec_pkce_${state}`);

  return NextResponse.redirect(`${url.origin}/?peec=connected`, 302);
}
