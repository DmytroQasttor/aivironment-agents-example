import { createRemoteJWKSet, jwtVerify } from "jose";
import crypto from "node:crypto";
import { AgentError } from "../utils/agentError.js";
import { getAgentDid, requireEnv } from "../config/runtime.js";

let jwksResolver = null;

// Lazily cached JWKS resolver used to verify platform JWTs.
function getJwksResolver() {
  if (!jwksResolver) {
    const jwksUrl = requireEnv(
      "PLATFORM_JWKS_URL",
      "PLATFORM_JWKS_URL is required for inbound platform JWT verification",
    );
    jwksResolver = createRemoteJWKSet(new URL(jwksUrl));
  }
  return jwksResolver;
}

// Canonicalizer aligns JSON body hashing with platform verifier behavior.
function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortKeysDeep(value[key]);
  }
  return sorted;
}

function canonicalBodyHash(rawBody) {
  try {
    const parsed = JSON.parse(rawBody.toString("utf8"));
    const canonical = JSON.stringify(sortKeysDeep(parsed));
    return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
  } catch {
    return crypto.createHash("sha256").update(rawBody).digest("hex");
  }
}

/**
 * Verifies platform -> agent auth envelope.
 * JWT is required and validated against JWKS and expected claims.
 */
export async function verifyInboundAuth({ headers, rawBody, taskId, correlationId }) {
  const agentDid = getAgentDid();
  const auth = headers.authorization;
  const bodyHash = canonicalBodyHash(rawBody);
  if (auth && auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();

    let payload;
    try {
      const verified = await jwtVerify(token, getJwksResolver(), {
        audience: agentDid,
        issuer: process.env.PLATFORM_JWT_ISSUER ?? "federated-agent-platform",
      });
      payload = verified.payload;
    } catch {
      throw new AgentError("AUTH_INVALID", "Invalid platform bearer token", false, 401);
    }

    if (typeof payload.task_id !== "string" || !payload.task_id) {
      throw new AgentError("AUTH_INVALID", "JWT task_id claim is required", false, 401);
    }
    if (payload.task_id !== taskId) {
      throw new AgentError("AUTH_INVALID", "JWT task binding mismatch", false, 401);
    }
    if (typeof payload.method === "string" && payload.method.toUpperCase() !== "POST") {
      throw new AgentError("AUTH_INVALID", "JWT method mismatch", false, 401);
    }
    if (typeof payload.path === "string" && payload.path !== "/a2a") {
      throw new AgentError("AUTH_INVALID", "JWT path mismatch", false, 401);
    }
    if (
      typeof payload.body_hash === "string" &&
      payload.body_hash !== bodyHash &&
      payload.body_hash !== `sha256:${bodyHash}`
    ) {
      throw new AgentError("AUTH_INVALID", "JWT body hash mismatch", false, 401);
    }

    const sourceAgentHeader = headers["x-source-agent-id"];
    if (
      typeof payload.source_agent === "string" &&
      typeof sourceAgentHeader === "string" &&
      payload.source_agent !== sourceAgentHeader
    ) {
      throw new AgentError("AUTH_INVALID", "JWT source_agent mismatch", false, 401);
    }
    return;
  }

  throw new AgentError("AUTH_INVALID", "Missing platform bearer token", false, 401);
}
