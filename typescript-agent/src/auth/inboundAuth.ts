import type { IncomingHttpHeaders } from "node:http";
import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { AgentError } from "../utils/agentError";

let jwksResolver: ReturnType<typeof createRemoteJWKSet> | null = null;

// Extracts bearer token or throws auth error used by handler normalization.
function getBearerToken(headers: IncomingHttpHeaders): string {
  const authorization = headers.authorization;
  if (!authorization || !authorization.startsWith("Bearer ")) {
    throw new AgentError("AUTH_INVALID", "Missing bearer token", false, 401);
  }
  return authorization.slice("Bearer ".length).trim();
}

// Lazily initialized JWKS resolver; reused across requests.
function getJwksResolver() {
  if (!jwksResolver) {
    if (!process.env.PLATFORM_JWKS_URL) {
      throw new AgentError(
        "CONFIG_INVALID",
        "PLATFORM_JWKS_URL is required for inbound platform JWT verification",
        false,
        500,
      );
    }
    jwksResolver = createRemoteJWKSet(new URL(process.env.PLATFORM_JWKS_URL));
  }
  return jwksResolver;
}

// Canonical JSON helper used for inbound body_hash parity with platform signer.
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

// Preferred body hash path: parse -> deep-sort keys -> stringify -> sha256.
// Fallback to raw bytes hash if body is not valid JSON.
function canonicalBodyHash(rawBody: Buffer) {
  try {
    const parsed = JSON.parse(rawBody.toString("utf8")) as unknown;
    const canonical = JSON.stringify(sortKeysDeep(parsed));
    return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
  } catch {
    return crypto.createHash("sha256").update(rawBody).digest("hex");
  }
}

/**
 * Verifies platform->agent inbound auth.
 * Current protocol expects JWT bearer for both simple and advanced target agents.
 * Additional claim checks are applied when those claims are present.
 */
export async function verifyInboundAuth(params: {
  headers: IncomingHttpHeaders;
  rawBody: Buffer;
  taskId: string;
  correlationId: string;
}) {
  const token = params.headers.authorization?.startsWith("Bearer ")
    ? getBearerToken(params.headers)
    : null;
  const audience = process.env.AGENT_DID;
  if (!audience) {
    throw new AgentError(
      "CONFIG_INVALID",
      "AGENT_DID is required for inbound platform auth verification",
      false,
      500,
    );
  }
  const method = "POST";
  const path = "/a2a";
  const bodyHash = canonicalBodyHash(params.rawBody);

  if (token) {
    let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
    try {
      const verified = await jwtVerify(token, getJwksResolver(), {
        audience,
        issuer: process.env.PLATFORM_JWT_ISSUER ?? "federated-agent-platform",
      });
      payload = verified.payload;
    } catch {
      throw new AgentError("AUTH_INVALID", "Invalid platform bearer token", false, 401);
    }

    const taskIdClaim = payload.task_id;
    if (typeof taskIdClaim !== "string" || !taskIdClaim) {
      throw new AgentError(
        "AUTH_INVALID",
        "Token task_id claim is required",
        false,
        401,
      );
    }
    if (taskIdClaim !== params.taskId) {
      throw new AgentError(
        "AUTH_INVALID",
        "Token task_id claim does not match request task_id",
        false,
        401,
      );
    }

    const methodClaim = payload.method;
    if (typeof methodClaim === "string" && methodClaim.toUpperCase() !== method) {
      throw new AgentError("AUTH_INVALID", "Token method claim mismatch", false, 401);
    }

    const pathClaim = payload.path;
    if (typeof pathClaim === "string" && pathClaim !== path) {
      throw new AgentError("AUTH_INVALID", "Token path claim mismatch", false, 401);
    }

    const bodyHashClaim = payload.body_hash;
    if (
      typeof bodyHashClaim === "string" &&
      bodyHashClaim !== bodyHash &&
      bodyHashClaim !== `sha256:${bodyHash}`
    ) {
      throw new AgentError("AUTH_INVALID", "Token body_hash claim mismatch", false, 401);
    }

    const sourceAgentClaim = payload.source_agent;
    const sourceAgentHeader = params.headers["x-source-agent-id"];
    const sourceAgentHeaderValue = Array.isArray(sourceAgentHeader)
      ? sourceAgentHeader[0]
      : sourceAgentHeader;
    if (
      typeof sourceAgentClaim === "string" &&
      typeof sourceAgentHeaderValue === "string" &&
      sourceAgentClaim !== sourceAgentHeaderValue
    ) {
      throw new AgentError(
        "AUTH_INVALID",
        "Token source_agent claim mismatch",
        false,
        401,
      );
    }
    return;
  }

  throw new AgentError(
    "AUTH_INVALID",
    "Missing platform bearer token",
    false,
    401,
  );
}
