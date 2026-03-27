import { createSecretKey } from "node:crypto";
import { EncryptJWT } from "jose";
import { buildOutboundAuthHeaders } from "../auth/outboundAuth";
import { AgentError } from "../utils/agentError";

type AuthMode = "simple" | "advanced";

interface MptAuthSpec {
  method?: string;
  path?: string;
  body?: string;
  targetAgentDid?: string;
}

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

function requireAgentDid() {
  const agentDid = process.env.AGENT_DID;
  if (!agentDid) {
    throw new AgentError("CONFIG_INVALID", "AGENT_DID is required", false, 500);
  }
  return agentDid;
}

function requireJweKey() {
  const rawKey = process.env.MCP_AGENT_AUTH_JWE_KEY;
  if (!rawKey) {
    throw new AgentError(
      "CONFIG_INVALID",
      "MCP_AGENT_AUTH_JWE_KEY is required for MCP governance auth",
      false,
      500,
    );
  }
  if (Buffer.byteLength(rawKey, "utf8") !== 32) {
    throw new AgentError(
      "CONFIG_INVALID",
      "MCP_AGENT_AUTH_JWE_KEY must be exactly 32 UTF-8 bytes for A256KW",
      false,
      500,
    );
  }
  return createSecretKey(Buffer.from(rawKey, "utf8"));
}

function requireAgentSecret() {
  const agentSecret = process.env.AGENT_SECRET ?? process.env.AGENT_API_KEY;
  if (!agentSecret) {
    throw new AgentError(
      "CONFIG_INVALID",
      "AGENT_SECRET or AGENT_API_KEY is required for simple MCP auth mode",
      false,
      500,
    );
  }
  return agentSecret;
}

export async function buildMcpAuthorizationHeader(spec: MptAuthSpec): Promise<string> {
  const authMode = getAuthMode();
  const agentDid = requireAgentDid();
  const mcpUrl = process.env.MCP_HTTP_URL ?? "https://example.com/mcp/stream";
  const resolvedSpec = {
    method: spec.method ?? "POST",
    path: spec.path ?? new URL(mcpUrl).pathname,
    body: spec.body ?? "",
    targetAgentDid: spec.targetAgentDid,
  };
  const claims: Record<string, string> = {
    iss: "aiv-governance-mcp-auth",
    aud: "agent-governance-mcp",
    auth_type: authMode,
    agent_did: agentDid,
  };

  if (authMode === "simple") {
    claims.agent_secret = requireAgentSecret();
  } else {
    const authHeaders = await buildOutboundAuthHeaders({
      method: resolvedSpec.method,
      path: resolvedSpec.path,
      body: resolvedSpec.body,
      targetAgentDid: resolvedSpec.targetAgentDid,
    });
    claims.timestamp_header = authHeaders["X-Timestamp"] ?? "";
    claims.signature_header = authHeaders["X-Signature"] ?? "";
    claims.algorithm_header = authHeaders["X-Signature-Algorithm"] ?? "RS256";
  }

  const token = await new EncryptJWT(claims)
    .setProtectedHeader({ alg: "A256KW", enc: "A256GCM", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .encrypt(requireJweKey());

  return `Bearer ${token}`;
}
