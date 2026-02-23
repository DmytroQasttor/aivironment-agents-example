import type { IncomingHttpHeaders } from "node:http";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { verifySignature } from "../utils/signature";
import { AgentError } from "../utils/agentError";

type AuthMode = "simple" | "advanced";

let jwksResolver: ReturnType<typeof createRemoteJWKSet> | null = null;

function getAuthMode(): AuthMode {
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

function getBearerToken(headers: IncomingHttpHeaders): string {
  const authorization = headers.authorization;
  if (!authorization || !authorization.startsWith("Bearer ")) {
    throw new AgentError("AUTH_INVALID", "Missing bearer token", false, 401);
  }
  return authorization.slice("Bearer ".length).trim();
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

export async function verifyInboundAuth(params: {
  headers: IncomingHttpHeaders;
  rawBody: Buffer;
  taskId: string;
  correlationId: string;
}) {
  const mode = getAuthMode();

  if (mode === "simple") {
    const sig = params.headers["x-platform-signature"];
    const ts = params.headers["x-platform-timestamp"];

    if (typeof sig !== "string" || typeof ts !== "string") {
      throw new AgentError(
        "AUTH_INVALID",
        "Missing simple auth headers",
        false,
        401,
      );
    }

    if (!process.env.AGENT_SECRET) {
      throw new AgentError(
        "CONFIG_INVALID",
        "AGENT_SECRET is required for simple auth mode",
        false,
        500,
      );
    }

    const ok = verifySignature(params.rawBody, sig, ts, process.env.AGENT_SECRET);
    if (!ok) {
      throw new AgentError("AUTH_INVALID", "Invalid signature", false, 401);
    }
    return;
  }

  const token = getBearerToken(params.headers);
  const audience = process.env.AGENT_DID;
  if (!audience) {
    throw new AgentError(
      "CONFIG_INVALID",
      "AGENT_DID is required for advanced auth mode",
      false,
      500,
    );
  }

  const issuer = process.env.PLATFORM_JWT_ISSUER;
  let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
  try {
    const verified = await jwtVerify(token, getJwksResolver(), {
      audience,
      ...(issuer ? { issuer } : {}),
    });
    payload = verified.payload;
  } catch {
    throw new AgentError("AUTH_INVALID", "Invalid platform bearer token", false, 401);
  }

  const taskIdClaim = payload.task_id;
  if (typeof taskIdClaim === "string" && taskIdClaim !== params.taskId) {
    throw new AgentError(
      "AUTH_INVALID",
      "Token task_id claim does not match request task_id",
      false,
      401,
    );
  }

  const correlationClaim = payload.correlation_id;
  if (
    typeof correlationClaim === "string" &&
    correlationClaim !== params.correlationId
  ) {
    throw new AgentError(
      "AUTH_INVALID",
      "Token correlation_id claim does not match request context",
      false,
      401,
    );
  }
}
