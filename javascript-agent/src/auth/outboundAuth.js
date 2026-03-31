import crypto from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { AgentError } from "../utils/agentError.js";
import { getAgentDid, getAuthMode, requireEnv } from "../config/runtime.js";

let privateKeyPromise = null;

function isMcpDebugEnabled() {
  return process.env.MCP_DEBUG === "1" || process.env.MCP_DEBUG === "true";
}

function logMcpDebug(message, data) {
  if (!isMcpDebugEnabled()) {
    return;
  }
  if (data) {
    console.log("[mcp-debug]", message, JSON.stringify(data));
    return;
  }
  console.log("[mcp-debug]", message);
}

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

// Builds outbound headers for both /a2a/send and MCP tool auth injection.
export async function buildOutboundAuthHeaders({
  method,
  path,
  body,
  targetAgentDid,
}) {
  // Outbound auth mirrors platform contract used by MCP/a2a calls.
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
  const canonical = buildCanonicalString({
    method,
    path,
    timestampMs,
    targetAgentDid,
    body,
  });
  logMcpDebug("advanced auth canonical", {
    method: method.toUpperCase(),
    path,
    timestamp: timestampMs,
    target_agent_did: targetAgentDid ?? null,
    body,
    body_hash: sha256Hex(body),
    canonical,
  });
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
    })}`,
  };
}
