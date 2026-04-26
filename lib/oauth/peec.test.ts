import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildAuthUrl,
  generatePkce,
  generateState,
  PEEC_AUTH_URL,
  PEEC_RESOURCE,
} from "./peec";

describe("generatePkce", () => {
  it("returns a verifier and challenge", () => {
    const { verifier, challenge } = generatePkce();
    expect(verifier).toBeTypeOf("string");
    expect(challenge).toBeTypeOf("string");
  });

  it("produces a verifier of at least 43 chars (RFC 7636 minimum)", () => {
    const { verifier } = generatePkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });

  it("uses base64url alphabet (no +, /, or = padding)", () => {
    const { verifier, challenge } = generatePkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("challenge equals base64url(SHA256(verifier))", () => {
    const { verifier, challenge } = generatePkce();
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
  });

  it("returns a different verifier each call (high entropy)", () => {
    const a = generatePkce();
    const b = generatePkce();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });
});

describe("generateState", () => {
  it("returns a base64url string", () => {
    const state = generateState();
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is unique across calls", () => {
    expect(generateState()).not.toBe(generateState());
  });
});

describe("buildAuthUrl", () => {
  const params = {
    client_id: "test-client",
    redirect_uri: "http://localhost:3000/api/auth/peec/callback",
    code_challenge: "test-challenge",
    state: "test-state",
  };

  it("builds against the Peec authorize URL", () => {
    const url = new URL(buildAuthUrl(params));
    expect(`${url.origin}${url.pathname}`).toBe(PEEC_AUTH_URL);
  });

  it("includes required OAuth 2.1 PKCE params", () => {
    const url = new URL(buildAuthUrl(params));
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("test-client");
    expect(url.searchParams.get("redirect_uri")).toBe(params.redirect_uri);
    expect(url.searchParams.get("code_challenge")).toBe("test-challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("test-state");
  });

  it("includes the resource indicator pointing at the MCP server", () => {
    const url = new URL(buildAuthUrl(params));
    expect(url.searchParams.get("resource")).toBe(PEEC_RESOURCE);
  });

  it("URL-encodes redirect URIs that contain special characters", () => {
    const encoded = buildAuthUrl({
      ...params,
      redirect_uri: "http://localhost:3000/cb?x=1&y=2",
    });
    const url = new URL(encoded);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/cb?x=1&y=2",
    );
  });
});
