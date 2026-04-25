import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  buildAuthUrl,
  generatePkce,
  generateState,
  loadClient,
  registerClient,
  saveClient,
} from "@/lib/oauth/peec";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const redirectUri = `${url.origin}/api/auth/peec/callback`;

  let client = loadClient();
  if (!client || !client.redirect_uris.includes(redirectUri)) {
    client = await registerClient(redirectUri);
    saveClient(client);
  }

  const { verifier, challenge } = generatePkce();
  const state = generateState();

  const authUrl = buildAuthUrl({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    state,
  });

  const cookieStore = await cookies();
  cookieStore.set(`peec_pkce_${state}`, verifier, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(authUrl, 302);
}
