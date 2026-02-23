import { createRemoteJWKSet, jwtVerify } from "jose";
import { AgentError } from "../utils/agentError.js";
import { verifySignature } from "../utils/signature.js";

let jwksResolver = null;

function getAuthMode() {
  const mode = (process.env.AGENT_AUTH_MODE ?? "simple").toLowerCase();
  if (mode !== "simple" && mode !== "advanced") {
    throw new AgentError(
      "CONFIG_INVALID",
      "AGENT_AUTH_MODE must be either simple or advanced",
      false,
      500,
    );
  }
  return mode;
}

function getJwksResolver() {
  if (!jwksResolver) {
    if (!process.env.PLATFORM_JWKS_URL) {
      throw new AgentError(
        "CONFIG_INVALID",
        "PLATFORM_JWKS_URL is required for advanced auth mode",
        false,
        500,
      );
    }
    jwksResolver = createRemoteJWKSet(new URL(process.env.PLATFORM_JWKS_URL));
  }
  return jwksResolver;
}

export async function verifyInboundAuth({ headers, rawBody, taskId, correlationId }) {
  const mode = getAuthMode();
  if (mode === "simple") {
    if (!process.env.AGENT_SECRET) {
      throw new AgentError(
        "CONFIG_INVALID",
        "AGENT_SECRET is required for simple auth mode",
        false,
        500,
      );
    }

    const signature = headers["x-platform-signature"];
    const timestamp = headers["x-platform-timestamp"];
    if (typeof signature !== "string" || typeof timestamp !== "string") {
      throw new AgentError("AUTH_INVALID", "Missing simple auth headers", false, 401);
    }

    if (!verifySignature(rawBody, signature, timestamp, process.env.AGENT_SECRET)) {
      throw new AgentError("AUTH_INVALID", "Invalid platform signature", false, 401);
    }
    return;
  }

  const auth = headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    throw new AgentError("AUTH_INVALID", "Missing bearer token", false, 401);
  }
  const token = auth.slice("Bearer ".length).trim();

  if (!process.env.AGENT_DID) {
    throw new AgentError("CONFIG_INVALID", "AGENT_DID is required", false, 500);
  }

  let payload;
  try {
    const verified = await jwtVerify(token, getJwksResolver(), {
      audience: process.env.AGENT_DID,
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
