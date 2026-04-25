import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const PEEC_AUTH_URL = "https://api.peec.ai/authorize";
export const PEEC_TOKEN_URL = "https://api.peec.ai/token";
export const PEEC_REGISTER_URL = "https://api.peec.ai/register";
export const PEEC_RESOURCE = "https://api.peec.ai/mcp";

export type PeecClient = {
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
};

export type PeecToken = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_at?: number;
  obtained_at: number;
};

const DATA_DIR = join(process.cwd(), "data");
const CLIENT_FILE = join(DATA_DIR, "peec_client.json");
const TOKEN_FILE = join(DATA_DIR, "peec_token.json");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function generatePkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function generateState() {
  return randomBytes(16).toString("base64url");
}

export async function registerClient(redirectUri: string): Promise<PeecClient> {
  const res = await fetch(PEEC_REGISTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Daily Founder Brief",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`peec /register ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as PeecClient;
  return data;
}

export function loadClient(): PeecClient | null {
  if (!existsSync(CLIENT_FILE)) return null;
  return JSON.parse(readFileSync(CLIENT_FILE, "utf-8"));
}

export function saveClient(client: PeecClient) {
  ensureDataDir();
  writeFileSync(CLIENT_FILE, JSON.stringify(client, null, 2));
}

export function loadToken(): PeecToken | null {
  if (!existsSync(TOKEN_FILE)) return null;
  return JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
}

export function saveToken(token: PeecToken) {
  ensureDataDir();
  writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2));
}

export function buildAuthUrl(params: {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state: string;
}): string {
  const url = new URL(PEEC_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.client_id);
  url.searchParams.set("redirect_uri", params.redirect_uri);
  url.searchParams.set("code_challenge", params.code_challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);
  url.searchParams.set("resource", PEEC_RESOURCE);
  return url.toString();
}

export async function exchangeCode(params: {
  client_id: string;
  code: string;
  code_verifier: string;
  redirect_uri: string;
}): Promise<PeecToken> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirect_uri,
    client_id: params.client_id,
    code_verifier: params.code_verifier,
  });
  const res = await fetch(PEEC_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`peec /token ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
    scope?: string;
  };
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: data.token_type ?? "Bearer",
    scope: data.scope,
    expires_at: data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined,
    obtained_at: Date.now(),
  };
}

export async function refreshAccessToken(params: {
  client_id: string;
  refresh_token: string;
}): Promise<PeecToken> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refresh_token,
    client_id: params.client_id,
  });
  const res = await fetch(PEEC_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`peec refresh ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
    scope?: string;
  };
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? params.refresh_token,
    token_type: data.token_type ?? "Bearer",
    scope: data.scope,
    expires_at: data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined,
    obtained_at: Date.now(),
  };
}

/**
 * Returns the current access token, refreshing it if expired.
 * Returns null if no token is stored.
 */
export async function getAccessToken(): Promise<string | null> {
  const token = loadToken();
  if (!token) return null;
  if (token.expires_at && Date.now() > token.expires_at - 30_000) {
    if (!token.refresh_token) return null;
    const client = loadClient();
    if (!client) return null;
    try {
      const fresh = await refreshAccessToken({
        client_id: client.client_id,
        refresh_token: token.refresh_token,
      });
      saveToken(fresh);
      return fresh.access_token;
    } catch {
      return null;
    }
  }
  return token.access_token;
}
