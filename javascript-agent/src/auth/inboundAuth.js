import { createRemoteJWKSet, jwtVerify } from "jose";
import { verifySignature } from "../utils/signature.js";
import { AgentError } from "../utils/agentError.js";
import { getAgentDid, getAuthMode, requireEnv } from "../config/runtime.js";

let jwksResolver = null;

function getJwksResolver() {
  if (!jwksResolver) {
    const jwksUrl = requireEnv(
      "PLATFORM_JWKS_URL",
      "PLATFORM_JWKS_URL is required for advanced auth mode",
    );
    jwksResolver = createRemoteJWKSet(new URL(jwksUrl));
  }
  return jwksResolver;
}

export async function verifyInboundAuth({ headers, rawBody, taskId, correlationId }) {
  // Inbound verification supports both platform auth families.
  const mode = getAuthMode();
  if (mode === "simple") {
    const agentSecret = requireEnv(
      "AGENT_SECRET",
      "AGENT_SECRET is required for simple auth mode",
    );

    const signature = headers["x-platform-signature"];
    const timestamp = headers["x-platform-timestamp"];
    if (typeof signature !== "string" || typeof timestamp !== "string") {
      throw new AgentError("AUTH_INVALID", "Missing simple auth headers", false, 401);
    }

    if (!verifySignature(rawBody, signature, timestamp, agentSecret)) {
      throw new AgentError("AUTH_INVALID", "Invalid platform signature", false, 401);
    }
    return;
  }

  const auth = headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    throw new AgentError("AUTH_INVALID", "Missing bearer token", false, 401);
  }
  const token = auth.slice("Bearer ".length).trim();

  const agentDid = getAgentDid();

  let payload;
  try {
    const verified = await jwtVerify(token, getJwksResolver(), {
      audience: agentDid,
      ...(process.env.PLATFORM_JWT_ISSUER
        ? { issuer: process.env.PLATFORM_JWT_ISSUER }
        : {}),
    });
    payload = verified.payload;
  } catch {
    throw new AgentError("AUTH_INVALID", "Invalid platform bearer token", false, 401);
  }

  if (typeof payload.task_id === "string" && payload.task_id !== taskId) {
    throw new AgentError("AUTH_INVALID", "JWT task binding mismatch", false, 401);
  }
  if (
    typeof payload.correlation_id === "string" &&
    payload.correlation_id !== correlationId
  ) {
    throw new AgentError("AUTH_INVALID", "JWT correlation binding mismatch", false, 401);
  }
}
