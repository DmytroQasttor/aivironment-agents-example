import crypto from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { AgentError } from "../utils/agentError.js";
import { getAgentDid, getAuthMode, requireEnv } from "../config/runtime.js";

let privateKeyPromise = null;

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function buildCanonicalString({ method, path, timestampMs, targetAgentDid, body }) {
  return [
    method.toUpperCase(),
    path,
    timestampMs,
    targetAgentDid ?? "",
    `sha256:${sha256Hex(body)}`,
  ].join("\n");
}

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

export async function buildOutboundAuthHeaders({
  method,
  path,
  body,
  targetAgentDid,
}) {
  // Outbound auth mirrors platform contract used by MCP/a2a calls.
  const agentDid = getAgentDid();

  if (getAuthMode() === "simple") {
    const apiKey = requireEnv(
      "AGENT_API_KEY",
      "AGENT_API_KEY is required for simple auth mode",
    );
    return {
      Authorization: `Bearer ${apiKey}`,
      "X-Agent-ID": agentDid,
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
  const nowSec = Math.floor(Date.now() / 1000);
  const signature = await new SignJWT({ canonical })
    .setProtectedHeader({
      alg,
      ...(process.env.AGENT_KEY_ID ? { kid: process.env.AGENT_KEY_ID } : {}),
    })
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + 60)
    .sign(await getPrivateKey(alg));

  return {
    "X-Agent-ID": agentDid,
    "X-Timestamp": timestampMs,
    "X-Signature": signature,
    "X-Signature-Algorithm": alg,
  };
}
