import type { IncomingHttpHeaders } from "node:http";
import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { AgentError } from "../utils/agentError";

let jwksResolver: ReturnType<typeof createRemoteJWKSet> | null = null;

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
        "PLATFORM_JWKS_URL is required for inbound platform JWT verification",
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
  const bodyHash = crypto
    .createHash("sha256")
    .update(params.rawBody)
    .digest("hex");

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
