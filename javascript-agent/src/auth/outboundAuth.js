import crypto from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { AgentError } from "../utils/agentError.js";
import { getAgentDid, getAuthMode, requireEnv } from "../config/runtime.js";

let privateKeyPromise = null;

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function encodeAuthEnvelope(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

// Canonical string contract expected by platform advanced verifier.
function buildCanonicalString({ method, path, timestampMs, targetAgentDid, body }) {
  return [
    method.toUpperCase(),
    path,
    timestampMs,
    targetAgentDid ?? "",
    `sha256:${sha256Hex(body)}`,
  ].join("\n");
}

// Private key import is cached for repeated signing.
async function getPrivateKey(alg) {
  if (!privateKeyPromise) {
    const privatePem = requireEnv(
      "AGENT_PRIVATE_KEY_PEM",
      "AGENT_PRIVATE_KEY_PEM is required for advanced auth mode",
    );
    privateKeyPromise = importPKCS8(privatePem, alg);
  }
  return privateKeyPromise;
}

/**
 * Core envelope builder shared by both outbound and MCP session auth.
 *
 * Simple mode produces: { auth_mode, agent_did, agent_secret }
 * Advanced mode produces: { auth_mode, agent_did, timestamp, signature, algorithm, ...sessionFields }
 *
 * MCP session auth passes sessionFields to bind the credential to the specific
 * request that established the session (session_method, session_path, etc.).
 * Regular outbound auth omits sessionFields.
 */
async function buildEnvelope({ method, path, body, targetAgentDid, sessionFields }) {
  const agentDid = getAgentDid();

  if (getAuthMode() === "simple") {
    const apiKey = process.env.AGENT_SECRET ?? process.env.AGENT_API_KEY;
    if (!apiKey) {
      throw new AgentError(
        "CONFIG_INVALID",
        "AGENT_SECRET or AGENT_API_KEY is required for simple auth mode",
        false,
        500,
      );
    }
    return {
      Authorization: `Bearer ${encodeAuthEnvelope({
        auth_mode: "simple",
        agent_did: agentDid,
        agent_secret: apiKey,
      })}`,
    };
  }

  const alg = process.env.AGENT_SIGNATURE_ALGORITHM ?? "RS256";
  const timestampMs = Date.now().toString();
  const canonical = buildCanonicalString({ method, path, timestampMs, targetAgentDid, body });
  const nowSec = Math.floor(Date.now() / 1000);
  const signature = await new SignJWT({ data: canonical, canonical })
    .setProtectedHeader({
      alg,
      ...(process.env.AGENT_KEY_ID ? { kid: process.env.AGENT_KEY_ID } : {}),
    })
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + 60)
    .sign(await getPrivateKey(alg));

  return {
    Authorization: `Bearer ${encodeAuthEnvelope({
      auth_mode: "advanced",
      agent_did: agentDid,
      timestamp: timestampMs,
      signature,
      algorithm: alg,
      ...sessionFields,
    })}`,
  };
}

/**
 * Outbound auth headers for platform API calls (`/api/v1/a2a/send`).
 * Also used for direct MCP tool auth injection.
 */
export async function buildOutboundAuthHeaders({ method, path, body, targetAgentDid }) {
  return buildEnvelope({ method, path, body, targetAgentDid });
}

/**
 * MCP session auth headers.
 * Same as outbound auth but the advanced envelope includes session_* fields
 * that bind the credential to the request that established the MCP session.
 * The platform stores this session server-side; the agent refreshes it every
 * MCP_SESSION_TTL_MS and retries once on 401.
 */
export async function buildMcpSessionAuthHeaders({ method, path, body, targetAgentDid }) {
  return buildEnvelope({
    method,
    path,
    body,
    targetAgentDid,
    sessionFields: {
      session_method: method.toUpperCase(),
      session_path: path,
      session_body_hash: sha256Hex(body),
      session_target_agent_did: targetAgentDid ?? "",
    },
  });
}
